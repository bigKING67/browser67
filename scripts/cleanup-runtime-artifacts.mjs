#!/usr/bin/env node
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  DEFAULT_RUN_ROOT,
  runRoot as configuredRunRoot,
} from "../src/run-lifecycle.mjs";
import { createRunStore } from "../src/runtime/runs/store.mjs";
import { createJobStore } from "../src/runtime/jobs/store.mjs";

const DEFAULT_MAX_AGE_DAYS = 30;
const DEFAULT_MAX_TOTAL_MB = 1024;
const DEFAULT_MAX_RUN_COUNT = 500;
const DEFAULT_KEEP_LATEST = 50;
const DEFAULT_ACTIVE_GRACE_MINUTES = 120;
const DEFAULT_MAX_ITEMS = 20;
const BYTES_PER_MB = 1024 * 1024;
const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(SCRIPT_DIR, "..");

function numericEnv(name, fallback) {
  const raw = process.env[name];
  if (raw === undefined || raw === "") {
    return fallback;
  }
  const value = Number(raw);
  if (!Number.isFinite(value) || value < 0) {
    throw new Error(`invalid ${name} value`);
  }
  return value;
}

function integerEnv(name, fallback) {
  return Math.floor(numericEnv(name, fallback));
}

function parseNonNegativeNumber(raw, label) {
  const value = Number(raw);
  if (!Number.isFinite(value) || value < 0) {
    throw new Error(`invalid ${label} value`);
  }
  return value;
}

function parseNonNegativeInteger(raw, label) {
  return Math.floor(parseNonNegativeNumber(raw, label));
}

function parseArgs(argv = []) {
  const parsed = {
    run_root: "",
    write: false,
    dry_run: true,
    json: false,
    max_age_days: numericEnv("TMWD_RUNTIME_CLEANUP_MAX_AGE_DAYS", DEFAULT_MAX_AGE_DAYS),
    max_total_mb: numericEnv("TMWD_RUNTIME_CLEANUP_MAX_TOTAL_MB", DEFAULT_MAX_TOTAL_MB),
    max_run_count: integerEnv("TMWD_RUNTIME_CLEANUP_MAX_RUN_COUNT", DEFAULT_MAX_RUN_COUNT),
    keep_latest: integerEnv("TMWD_RUNTIME_CLEANUP_KEEP_LATEST", DEFAULT_KEEP_LATEST),
    active_grace_minutes: integerEnv(
      "TMWD_RUNTIME_CLEANUP_ACTIVE_GRACE_MINUTES",
      DEFAULT_ACTIVE_GRACE_MINUTES,
    ),
    max_items: DEFAULT_MAX_ITEMS,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index] ?? "";
    if (token === "--run-root") {
      const value = String(argv[index + 1] ?? "").trim();
      if (!value) {
        throw new Error("invalid --run-root value");
      }
      parsed.run_root = value;
      index += 1;
      continue;
    }
    if (token === "--max-age-days") {
      parsed.max_age_days = parseNonNegativeNumber(argv[index + 1], "--max-age-days");
      index += 1;
      continue;
    }
    if (token === "--max-total-mb") {
      parsed.max_total_mb = parseNonNegativeNumber(argv[index + 1], "--max-total-mb");
      index += 1;
      continue;
    }
    if (token === "--max-run-count") {
      parsed.max_run_count = parseNonNegativeInteger(argv[index + 1], "--max-run-count");
      index += 1;
      continue;
    }
    if (token === "--keep-latest") {
      parsed.keep_latest = parseNonNegativeInteger(argv[index + 1], "--keep-latest");
      index += 1;
      continue;
    }
    if (token === "--active-grace-minutes") {
      parsed.active_grace_minutes = parseNonNegativeInteger(argv[index + 1], "--active-grace-minutes");
      index += 1;
      continue;
    }
    if (token === "--max-items") {
      parsed.max_items = parseNonNegativeInteger(argv[index + 1], "--max-items");
      index += 1;
      continue;
    }
    if (token === "--write") {
      parsed.write = true;
      parsed.dry_run = false;
      continue;
    }
    if (token === "--dry-run") {
      parsed.write = false;
      parsed.dry_run = true;
      continue;
    }
    if (token === "--json") {
      parsed.json = true;
      continue;
    }
    if (token === "--help" || token === "-h") {
      parsed.help = true;
      continue;
    }
    if (!token) {
      continue;
    }
    throw new Error(`unknown argument: ${token}`);
  }

  return parsed;
}

function usage() {
  return [
    "Usage: node scripts/cleanup-runtime-artifacts.mjs [options]",
    "",
    "Options:",
    "  --dry-run                       Plan cleanup only (default).",
    "  --write                         Delete planned run directories.",
    "  --run-root <path>               Override BROWSER_STRUCTURED_RUN_ROOT.",
    "  --max-age-days <days>           Delete runs older than this; 0 disables age cleanup.",
    "  --max-total-mb <mb>             Delete oldest runs until under this budget; 0 disables size cleanup.",
    "  --max-run-count <count>         Delete oldest runs until at or below this count; 0 disables count cleanup.",
    "  --keep-latest <count>           Always keep the latest N runs.",
    "  --active-grace-minutes <count>  Keep running runs updated within this window.",
    "  --json                          Emit machine-readable JSON.",
    "",
    "Examples:",
    "  npm run runtime:cleanup:dry-run",
    "  npm run runtime:cleanup -- --write",
  ].join("\n");
}

function resolveCleanupRoot(args = {}) {
  return path.resolve(args.run_root || configuredRunRoot());
}

function isSameOrInside(child, parent) {
  const relative = path.relative(parent, child);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function assertSafeRunRoot(root) {
  const resolved = path.resolve(root);
  const parsed = path.parse(resolved);
  const home = path.resolve(os.homedir());
  const basename = path.basename(resolved).toLowerCase();

  if (!resolved || resolved === parsed.root) {
    throw new Error(`refusing unsafe run root: ${resolved}`);
  }
  if (resolved === home || isSameOrInside(home, resolved)) {
    throw new Error(`refusing run root that contains the user home: ${resolved}`);
  }
  if (resolved === REPO_ROOT || isSameOrInside(REPO_ROOT, resolved) || isSameOrInside(resolved, REPO_ROOT)) {
    throw new Error(`refusing run root inside or above the repository: ${resolved}`);
  }
  if (!basename.includes("runs")) {
    throw new Error(`refusing non-runtime run root without a runs-like basename: ${resolved}`);
  }

  return resolved;
}

function assertSafeRunDir(root, runDir) {
  const resolvedRoot = path.resolve(root);
  const resolvedRunDir = path.resolve(runDir);
  const relative = path.relative(resolvedRoot, resolvedRunDir);
  const parts = relative.split(path.sep).filter(Boolean);
  if (
    !relative
    || relative.startsWith("..")
    || path.isAbsolute(relative)
    || parts.length !== 2
  ) {
    throw new Error(`refusing unsafe run directory deletion: ${resolvedRunDir}`);
  }
  return resolvedRunDir;
}

function parseDateMs(value) {
  const ms = Date.parse(String(value ?? ""));
  return Number.isFinite(ms) ? ms : null;
}

function firstFiniteTimeMs(...values) {
  for (const value of values) {
    const number = Number(value);
    if (Number.isFinite(number) && number > 0) {
      return number;
    }
  }
  return Date.now();
}

async function readJsonIfExists(filePath) {
  try {
    return {
      ok: true,
      value: JSON.parse(await fs.readFile(filePath, "utf8")),
    };
  } catch (error) {
    if (error?.code === "ENOENT") {
      return { ok: false, value: null, missing: true };
    }
    return {
      ok: false,
      value: null,
      error: String(error?.message ?? error),
    };
  }
}

async function directorySizeAndNewestMtime(dir) {
  const state = {
    bytes: 0,
    entries: 0,
    files: 0,
    directories: 0,
    newest_mtime_ms: 0,
  };

  async function visit(current) {
    const entries = await fs.readdir(current, { withFileTypes: true }).catch((error) => {
      if (error?.code === "ENOENT" || error?.code === "EACCES") {
        return [];
      }
      throw error;
    });
    for (const entry of entries) {
      const entryPath = path.join(current, entry.name);
      const info = await fs.lstat(entryPath).catch((error) => {
        if (error?.code === "ENOENT" || error?.code === "EACCES") {
          return null;
        }
        throw error;
      });
      if (!info) {
        continue;
      }
      state.entries += 1;
      state.newest_mtime_ms = Math.max(state.newest_mtime_ms, Number(info.mtimeMs ?? 0));
      if (info.isDirectory()) {
        state.directories += 1;
        await visit(entryPath);
      } else {
        // Directory st_size is platform-specific; retention budgets track logical payload bytes.
        state.bytes += Number(info.size ?? 0);
        state.files += 1;
      }
    }
  }

  await visit(dir);
  return state;
}

async function isRunDirectory(runDir) {
  const entries = await fs.readdir(runDir, { withFileTypes: true }).catch((error) => {
    if (error?.code === "ENOENT" || error?.code === "EACCES") {
      return [];
    }
    throw error;
  });
  const names = new Set(entries.map((entry) => entry.name));
  return names.has("run.json") || names.has("artifacts") || names.has("logs") || names.has("events.ndjson");
}

async function inspectRunDirectory(root, group, runEntry) {
  const runDir = path.join(root, group.name, runEntry.name);
  const runInfo = await fs.lstat(runDir);
  const runJson = await readJsonIfExists(path.join(runDir, "run.json"));
  const size = await directorySizeAndNewestMtime(runDir);
  const run = runJson.value && typeof runJson.value === "object" ? runJson.value : {};
  const createdAtMs = parseDateMs(run.created_at)
    ?? firstFiniteTimeMs(runInfo.birthtimeMs, runInfo.ctimeMs, runInfo.mtimeMs);
  const updatedAtMs = parseDateMs(run.updated_at)
    ?? firstFiniteTimeMs(size.newest_mtime_ms, runInfo.mtimeMs, runInfo.ctimeMs);

  return {
    group: group.name,
    run_id: run.run_id ? String(run.run_id) : runEntry.name,
    path: runDir,
    status: run.status ? String(run.status) : "unknown",
    title: run.title ? String(run.title) : "",
    created_at: new Date(createdAtMs).toISOString(),
    updated_at: new Date(updatedAtMs).toISOString(),
    created_at_ms: createdAtMs,
    updated_at_ms: updatedAtMs,
    bytes: size.bytes,
    entries: size.entries,
    files: size.files,
    directories: size.directories,
    has_run_json: runJson.ok,
    run_json_error: runJson.error,
  };
}

async function collectRuntimeRuns(root) {
  const resolvedRoot = assertSafeRunRoot(root);
  const rootInfo = await fs.lstat(resolvedRoot).catch((error) => {
    if (error?.code === "ENOENT") {
      return null;
    }
    throw error;
  });
  if (!rootInfo) {
    return {
      root: resolvedRoot,
      exists: false,
      runs: [],
      skipped: [],
    };
  }
  if (!rootInfo.isDirectory()) {
    throw new Error(`run root is not a directory: ${resolvedRoot}`);
  }

  const groups = await fs.readdir(resolvedRoot, { withFileTypes: true });
  const runs = [];
  const skipped = [];
  for (const group of groups) {
    const groupPath = path.join(resolvedRoot, group.name);
    if (!group.isDirectory()) {
      skipped.push({ path: groupPath, reason: "not_directory" });
      continue;
    }
    const runEntries = await fs.readdir(groupPath, { withFileTypes: true }).catch((error) => {
      if (error?.code === "ENOENT" || error?.code === "EACCES") {
        skipped.push({ path: groupPath, reason: error.code });
        return [];
      }
      throw error;
    });
    for (const runEntry of runEntries) {
      const runDir = path.join(groupPath, runEntry.name);
      if (!runEntry.isDirectory()) {
        skipped.push({ path: runDir, reason: "not_directory" });
        continue;
      }
      if (!(await isRunDirectory(runDir))) {
        skipped.push({ path: runDir, reason: "not_run_directory" });
        continue;
      }
      runs.push(await inspectRunDirectory(resolvedRoot, group, runEntry));
    }
  }
  return {
    root: resolvedRoot,
    exists: true,
    runs,
    skipped,
  };
}

function summarizeRetention(args = {}) {
  const maxTotalBytes = args.max_total_mb > 0
    ? Math.floor(args.max_total_mb * BYTES_PER_MB)
    : 0;
  return {
    max_age_days: args.max_age_days,
    max_total_mb: args.max_total_mb,
    max_total_bytes: maxTotalBytes,
    max_run_count: args.max_run_count,
    keep_latest: args.keep_latest,
    active_grace_minutes: args.active_grace_minutes,
  };
}

function protectReason(run, keepLatestPaths, activeGraceMs, nowMs) {
  const reasons = [];
  if (
    String(run.status).toLowerCase() === "running"
    && activeGraceMs > 0
    && nowMs - run.updated_at_ms <= activeGraceMs
  ) {
    reasons.push("active_recent_running");
  }
  if (keepLatestPaths.has(run.path)) {
    reasons.push("keep_latest");
  }
  return reasons;
}

function compactRun(run) {
  return {
    group: run.group,
    run_id: run.run_id,
    path: run.path,
    status: run.status,
    updated_at: run.updated_at,
    bytes: run.bytes,
  };
}

function planRuntimeArtifactCleanup(scan, args = {}, nowMs = Date.now()) {
  const retention = summarizeRetention(args);
  const sortedNewest = [...scan.runs].sort((left, right) => (
    right.updated_at_ms - left.updated_at_ms
    || String(right.path).localeCompare(String(left.path))
  ));
  const keepLatestPaths = new Set(sortedNewest.slice(0, args.keep_latest).map((run) => run.path));
  const activeGraceMs = args.active_grace_minutes * 60_000;
  const decisions = new Map();
  const maxAgeMs = args.max_age_days > 0 ? args.max_age_days * 86_400_000 : 0;
  const totalBytes = scan.runs.reduce((sum, run) => sum + run.bytes, 0);

  for (const run of scan.runs) {
    const protected_reasons = protectReason(run, keepLatestPaths, activeGraceMs, nowMs);
    const decision = {
      run,
      action: "keep",
      reasons: [],
      protected_reasons,
    };
    if (protected_reasons.length === 0 && maxAgeMs > 0 && nowMs - run.updated_at_ms > maxAgeMs) {
      decision.action = "delete";
      decision.reasons.push("max_age_days");
    }
    decisions.set(run.path, decision);
  }

  let plannedDeleteBytes = Array.from(decisions.values())
    .filter((decision) => decision.action === "delete")
    .reduce((sum, decision) => sum + decision.run.bytes, 0);
  let remainingBytesAfterPlan = totalBytes - plannedDeleteBytes;
  let remainingCountAfterPlan = scan.runs.length - Array.from(decisions.values())
    .filter((decision) => decision.action === "delete").length;
  if (retention.max_run_count > 0 && remainingCountAfterPlan > retention.max_run_count) {
    const sortedOldest = [...scan.runs].sort((left, right) => (
      left.updated_at_ms - right.updated_at_ms
      || String(left.path).localeCompare(String(right.path))
    ));
    for (const run of sortedOldest) {
      if (remainingCountAfterPlan <= retention.max_run_count) break;
      const decision = decisions.get(run.path);
      if (!decision || decision.action === "delete" || decision.protected_reasons.length > 0) continue;
      decision.action = "delete";
      decision.reasons.push("max_run_count");
      plannedDeleteBytes += run.bytes;
      remainingBytesAfterPlan -= run.bytes;
      remainingCountAfterPlan -= 1;
    }
  }
  const budgetBytes = retention.max_total_bytes;

  if (budgetBytes > 0 && remainingBytesAfterPlan > budgetBytes) {
    const sortedOldest = [...scan.runs].sort((left, right) => (
      left.updated_at_ms - right.updated_at_ms
      || String(left.path).localeCompare(String(right.path))
    ));
    for (const run of sortedOldest) {
      if (remainingBytesAfterPlan <= budgetBytes) {
        break;
      }
      const decision = decisions.get(run.path);
      if (!decision || decision.action === "delete" || decision.protected_reasons.length > 0) {
        continue;
      }
      decision.action = "delete";
      decision.reasons.push("max_total_mb");
      plannedDeleteBytes += run.bytes;
      remainingBytesAfterPlan -= run.bytes;
      remainingCountAfterPlan -= 1;
    }
  }

  const planned = Array.from(decisions.values()).filter((decision) => decision.action === "delete");
  const kept = Array.from(decisions.values()).filter((decision) => decision.action !== "delete");

  return {
    retention,
    total_bytes: totalBytes,
    total_count: scan.runs.length,
    planned_delete_count: planned.length,
    planned_delete_bytes: plannedDeleteBytes,
    remaining_bytes_after_plan: remainingBytesAfterPlan,
    remaining_count_after_plan: remainingCountAfterPlan,
    budget_satisfied_after_plan: budgetBytes <= 0 || remainingBytesAfterPlan <= budgetBytes,
    count_satisfied_after_plan: retention.max_run_count <= 0 || remainingCountAfterPlan <= retention.max_run_count,
    planned,
    kept,
  };
}

async function applyRuntimeArtifactCleanup(root, plan, args = {}) {
  if (args.dry_run) {
    return {
      deleted_count: 0,
      deleted_bytes: 0,
      errors: [],
      compacted_groups: [],
      job_index_rebuilt: false,
    };
  }
  let deletedCount = 0;
  let deletedBytes = 0;
  const errors = [];
  const affectedGroups = new Set();
  for (const decision of plan.planned) {
    const safeRunDir = assertSafeRunDir(root, decision.run.path);
    try {
      await fs.rm(safeRunDir, { recursive: true, force: false });
      deletedCount += 1;
      deletedBytes += decision.run.bytes;
      affectedGroups.add(decision.run.group);
    } catch (error) {
      if (error?.code === "ENOENT") {
        continue;
      }
      errors.push({
        path: safeRunDir,
        error: String(error?.message ?? error),
      });
    }
  }
  const compactedGroups = [];
  const runStore = createRunStore({ root });
  for (const group of affectedGroups) {
    try {
      await runStore.compactGroupIndex(group);
      compactedGroups.push(group);
    } catch (error) {
      errors.push({
        path: path.join(root, group, "index.ndjson"),
        error: `index compaction failed: ${String(error?.message ?? error)}`,
      });
    }
  }
  let jobIndexRebuilt = false;
  if (affectedGroups.size > 0) {
    try {
      await createJobStore({ run_root: root }).rebuild();
      jobIndexRebuilt = true;
    } catch (error) {
      errors.push({
        path: root,
        error: `job index rebuild failed: ${String(error?.message ?? error)}`,
      });
    }
  }
  return {
    deleted_count: deletedCount,
    deleted_bytes: deletedBytes,
    errors,
    compacted_groups: compactedGroups,
    job_index_rebuilt: jobIndexRebuilt,
  };
}

function trimList(list = [], maxItems = DEFAULT_MAX_ITEMS) {
  const limit = Math.max(0, maxItems);
  return {
    items: list.slice(0, limit),
    returned_count: Math.min(list.length, limit),
    truncated: list.length > limit,
  };
}

function formatMb(bytes) {
  return `${(bytes / BYTES_PER_MB).toFixed(2)}MB`;
}

function buildPayload(root, scan, plan, result, args = {}) {
  const planned = trimList(plan.planned.map((decision) => ({
    ...compactRun(decision.run),
    reasons: decision.reasons,
  })), args.max_items);
  const protectedRuns = trimList(plan.kept
    .filter((decision) => decision.protected_reasons.length > 0)
    .map((decision) => ({
      ...compactRun(decision.run),
      protected_reasons: decision.protected_reasons,
    })), args.max_items);
  const skipped = trimList(scan.skipped, args.max_items);
  const ok = result.errors.length === 0;

  return {
    ok,
    check: "runtime-artifact-cleanup",
    dry_run: args.dry_run,
    root,
    default_root: DEFAULT_RUN_ROOT,
    root_exists: scan.exists,
    retention: plan.retention,
    total_count: plan.total_count,
    total_bytes: plan.total_bytes,
    total_mb: Number((plan.total_bytes / BYTES_PER_MB).toFixed(2)),
    planned_delete_count: plan.planned_delete_count,
    planned_delete_bytes: plan.planned_delete_bytes,
    planned_delete_mb: Number((plan.planned_delete_bytes / BYTES_PER_MB).toFixed(2)),
    remaining_bytes_after_plan: plan.remaining_bytes_after_plan,
    remaining_count_after_plan: plan.remaining_count_after_plan,
    budget_satisfied_after_plan: plan.budget_satisfied_after_plan,
    count_satisfied_after_plan: plan.count_satisfied_after_plan,
    deleted_count: result.deleted_count,
    deleted_bytes: result.deleted_bytes,
    compacted_groups: result.compacted_groups,
    job_index_rebuilt: result.job_index_rebuilt,
    planned: planned.items,
    planned_returned_count: planned.returned_count,
    planned_truncated: planned.truncated,
    protected: protectedRuns.items,
    protected_returned_count: protectedRuns.returned_count,
    protected_truncated: protectedRuns.truncated,
    skipped: skipped.items,
    skipped_returned_count: skipped.returned_count,
    skipped_truncated: skipped.truncated,
    errors: result.errors,
    remediation: args.dry_run && plan.planned_delete_count > 0
      ? "Review the dry-run plan, then run `npm run runtime:cleanup -- --write` to delete planned run directories."
      : "No runtime artifact cleanup action is required.",
  };
}

function outputText(payload) {
  const mode = payload.dry_run ? "dry-run" : "deleted";
  process.stdout.write([
    `runtime_artifact_cleanup=${mode}`,
    `root=${payload.root}`,
    `runs=${payload.total_count}`,
    `planned_delete=${payload.planned_delete_count}`,
    `bytes_to_delete=${formatMb(payload.planned_delete_bytes)}`,
    `total=${formatMb(payload.total_bytes)}`,
    `remaining_after_plan=${formatMb(payload.remaining_bytes_after_plan)}`,
    `remaining_runs=${payload.remaining_count_after_plan}`,
  ].join(" "));
  process.stdout.write("\n");
  process.stdout.write([
    "retention",
    `max_age_days=${payload.retention.max_age_days}`,
    `max_total_mb=${payload.retention.max_total_mb}`,
    `max_run_count=${payload.retention.max_run_count}`,
    `keep_latest=${payload.retention.keep_latest}`,
    `active_grace_minutes=${payload.retention.active_grace_minutes}`,
  ].join(" "));
  process.stdout.write("\n");
  if (!payload.budget_satisfied_after_plan) {
    process.stdout.write("warning=budget_not_satisfied_after_plan_due_to_protected_runs\n");
  }
  if (!payload.count_satisfied_after_plan) {
    process.stdout.write("warning=count_not_satisfied_after_plan_due_to_protected_runs\n");
  }
  if (payload.dry_run && payload.planned_delete_count > 0) {
    process.stdout.write("apply_with=npm run runtime:cleanup -- --write\n");
  }
  if (!payload.ok) {
    for (const error of payload.errors) {
      process.stderr.write(`cleanup_error path=${error.path} error=${error.error}\n`);
    }
  }
}

async function cleanupRuntimeArtifacts(args = parseArgs(process.argv.slice(2))) {
  const root = assertSafeRunRoot(resolveCleanupRoot(args));
  const scan = await collectRuntimeRuns(root);
  const plan = planRuntimeArtifactCleanup(scan, args);
  const result = await applyRuntimeArtifactCleanup(root, plan, args);
  return buildPayload(root, scan, plan, result, args);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    process.stdout.write(`${usage()}\n`);
    return 0;
  }
  const payload = await cleanupRuntimeArtifacts(args);
  if (args.json) {
    process.stdout.write(`${JSON.stringify(payload)}\n`);
  } else {
    outputText(payload);
  }
  return payload.ok ? 0 : 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    process.exitCode = await main();
  } catch (error) {
    const message = String(error?.message ?? error);
    if (process.argv.includes("--json")) {
      process.stdout.write(`${JSON.stringify({
        ok: false,
        check: "runtime-artifact-cleanup",
        error: message,
      })}\n`);
    } else {
      process.stderr.write(`runtime artifact cleanup failed: ${message}\n`);
    }
    process.exitCode = 1;
  }
}

export {
  assertSafeRunDir,
  assertSafeRunRoot,
  cleanupRuntimeArtifacts,
  collectRuntimeRuns,
  parseArgs,
  planRuntimeArtifactCleanup,
};
