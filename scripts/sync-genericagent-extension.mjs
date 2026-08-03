#!/usr/bin/env node

import { createHash } from "node:crypto";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
} from "node:fs";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const currentFile = fileURLToPath(import.meta.url);
const __dirname = dirname(currentFile);
const repoRoot = resolve(__dirname, "..");
const defaultSourceDir = resolve(
  repoRoot,
  "..",
  "GenericAgent",
  "assets",
  "tmwd_cdp_bridge",
);
const targetDir = resolve(repoRoot, "extension");
const defaultReviewFile = resolve(repoRoot, "UPSTREAM.review.json");
const managedExtraFiles = new Set(["config.example.js"]);
const managedExtraPrefixes = ["browser67/"];
const ignoredFiles = new Set(["config.js"]);

function parseArgs(argv) {
  const parsed = {
    sourceDir: defaultSourceDir,
    reviewFile: defaultReviewFile,
    check: false,
    strict: false,
    forceReviewedSync: false,
    json: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const token = String(argv[index] ?? "");
    if (token === "--source") {
      const value = String(argv[index + 1] ?? "").trim();
      if (!value || value.startsWith("--")) {
        throw new Error("missing --source value");
      }
      parsed.sourceDir = resolve(value);
      index += 1;
      continue;
    }
    if (token === "--review-file") {
      const value = String(argv[index + 1] ?? "").trim();
      if (!value || value.startsWith("--")) {
        throw new Error("missing --review-file value");
      }
      parsed.reviewFile = resolve(value);
      index += 1;
      continue;
    }
    if (token === "--check") {
      parsed.check = true;
      continue;
    }
    if (token === "--strict") {
      parsed.strict = true;
      continue;
    }
    if (token === "--force-reviewed-sync") {
      parsed.forceReviewedSync = true;
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
    throw new Error(`unknown argument: ${token}`);
  }
  if (parsed.strict && !parsed.check) {
    throw new Error("--strict requires --check");
  }
  if (parsed.forceReviewedSync && parsed.check) {
    throw new Error("--force-reviewed-sync cannot be combined with --check");
  }
  return parsed;
}

function usage() {
  return [
    "Usage: node scripts/sync-genericagent-extension.mjs [--source <dir>] [--review-file <path>] [--check [--strict]] [--force-reviewed-sync] [--json]",
    "",
    "Synchronizes GenericAgent assets/tmwd_cdp_bridge into extension/.",
    "config.js is intentionally ignored because setup-extension writes a runtime TID.",
    "--check accepts drift covered by a direct_sync_allowed=false review ledger; --strict requires byte alignment.",
    "Synchronization refuses reviewed or unreviewed drift unless the ledger allows direct sync or --force-reviewed-sync is explicit.",
  ].join("\n");
}

function listFiles(rootDir) {
  const rows = [];
  function walk(currentDir) {
    for (const entry of readdirSync(currentDir, { withFileTypes: true })) {
      const absolute = resolve(currentDir, entry.name);
      const rel = relative(rootDir, absolute).replaceAll("\\", "/");
      if (entry.isDirectory()) {
        walk(absolute);
        continue;
      }
      if (!entry.isFile()) {
        continue;
      }
      if (ignoredFiles.has(rel)) {
        continue;
      }
      rows.push(rel);
    }
  }
  walk(rootDir);
  return rows.sort();
}

function hashFile(path) {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function isManagedExtra(file) {
  return managedExtraFiles.has(file)
    || managedExtraPrefixes.some((prefix) => file.startsWith(prefix));
}

function compare(sourceDir) {
  if (!existsSync(sourceDir) || !statSync(sourceDir).isDirectory()) {
    throw new Error(`missing GenericAgent extension source: ${sourceDir}`);
  }
  if (!existsSync(targetDir) || !statSync(targetDir).isDirectory()) {
    throw new Error(`missing extension target: ${targetDir}`);
  }
  const sourceFiles = listFiles(sourceDir);
  const targetFiles = listFiles(targetDir).filter((file) => !isManagedExtra(file));
  const sourceSet = new Set(sourceFiles);
  const targetSet = new Set(targetFiles);
  const added = sourceFiles.filter((file) => !targetSet.has(file));
  const removed = targetFiles.filter((file) => !sourceSet.has(file));
  const changed = sourceFiles.filter((file) => (
    targetSet.has(file)
    && hashFile(resolve(sourceDir, file)) !== hashFile(resolve(targetDir, file))
  ));
  return {
    ok: added.length === 0 && removed.length === 0 && changed.length === 0,
    source_dir: sourceDir,
    target_dir: targetDir,
    added,
    removed,
    changed,
    ignored: [...ignoredFiles].sort(),
    managed_extra: [...managedExtraFiles, ...managedExtraPrefixes.map((prefix) => `${prefix}*`)].sort(),
    source_files: sourceFiles.map((file) => ({
      path: file,
      sha256: hashFile(resolve(sourceDir, file)),
    })),
  };
}

function readReviewRecord(reviewFile) {
  if (!existsSync(reviewFile)) {
    return {
      exists: false,
      path: reviewFile,
      value: null,
      error: "review ledger is missing",
    };
  }
  try {
    return {
      exists: true,
      path: reviewFile,
      value: JSON.parse(readFileSync(reviewFile, "utf8")),
      error: null,
    };
  } catch (error) {
    return {
      exists: true,
      path: reviewFile,
      value: null,
      error: String(error?.message ?? error),
    };
  }
}

function driftFiles(diff) {
  return [...new Set([
    ...(diff.added ?? []),
    ...(diff.removed ?? []),
    ...(diff.changed ?? []),
  ])].sort();
}

export function assessExtensionDrift(diff, reviewRecord, options = {}) {
  const strict = options.strict === true;
  const files = driftFiles(diff);
  const directSyncAllowed = reviewRecord?.decision?.direct_sync_allowed;
  const reviewedFiles = new Set(reviewRecord?.extension_review?.changed_files ?? []);
  const decisions = new Map(
    (reviewRecord?.extension_review?.per_file_decision ?? [])
      .map((entry) => [entry?.file, entry]),
  );
  const reviewedHashes = new Map(
    (reviewRecord?.extension_review?.reviewed_source_files ?? [])
      .map((entry) => [entry?.path, entry?.sha256]),
  );
  const sourceHashes = new Map(
    (diff.source_files ?? [])
      .map((entry) => [entry?.path, entry?.sha256]),
  );
  const unresolvedFiles = files.filter((file) => (
    !reviewedFiles.has(file)
    || !decisions.has(file)
    || (((diff.added ?? []).includes(file) || (diff.changed ?? []).includes(file))
      && reviewedHashes.get(file) !== sourceHashes.get(file))
  ));
  const rawAligned = diff.ok === true;
  const reviewedDivergence = !rawAligned
    && files.length > 0
    && directSyncAllowed === false
    && unresolvedFiles.length === 0;
  const status = rawAligned
    ? "aligned"
    : reviewedDivergence
      ? "reviewed_divergence"
      : "unreviewed_drift";
  return {
    ok: rawAligned || (!strict && reviewedDivergence),
    status,
    strict,
    raw_alignment_ok: rawAligned,
    reviewed_divergence: reviewedDivergence,
    direct_sync_allowed: directSyncAllowed === true,
    drift_files: files,
    unresolved_files: unresolvedFiles,
  };
}

export function assessSyncPermission(assessment, options = {}) {
  if (assessment.raw_alignment_ok === true) {
    return { allowed: true, forced: false, reason: "already_aligned" };
  }
  if (options.forceReviewedSync === true) {
    return { allowed: true, forced: true, reason: "explicit_force_reviewed_sync" };
  }
  if (assessment.direct_sync_allowed === true) {
    return { allowed: true, forced: false, reason: "review_ledger_allows_direct_sync" };
  }
  return {
    allowed: false,
    forced: false,
    reason: assessment.reviewed_divergence
      ? "reviewed_divergence_requires_explicit_force"
      : "unreviewed_drift_requires_explicit_force",
  };
}

function assessmentPayload(diff, args) {
  const review = readReviewRecord(args.reviewFile);
  const assessment = assessExtensionDrift(diff, review.value, { strict: args.strict });
  return {
    ...diff,
    ...assessment,
    review: {
      path: review.path,
      exists: review.exists,
      error: review.error,
      reviewed_commit: review.value?.upstream?.reviewed_commit ?? null,
    },
  };
}

function sync(sourceDir, diff) {
  for (const file of [...diff.added, ...diff.changed]) {
    const sourcePath = resolve(sourceDir, file);
    const targetPath = resolve(targetDir, file);
    mkdirSync(dirname(targetPath), { recursive: true });
    copyFileSync(sourcePath, targetPath);
  }
  for (const file of diff.removed) {
    rmSync(resolve(targetDir, file), { force: true });
  }
}

function writeResult(payload, json) {
  if (json) {
    process.stdout.write(`${JSON.stringify(payload)}\n`);
    return;
  }
  process.stdout.write(`GenericAgent extension source: ${payload.source_dir}\n`);
  process.stdout.write(`Target extension dir: ${payload.target_dir}\n`);
  process.stdout.write(`Status: ${payload.status ?? (payload.ok ? "aligned" : "drifted")}\n`);
  if (payload.raw_alignment_ok === false) {
    process.stdout.write(`Raw alignment: drifted\n`);
  }
  if (payload.reviewed_divergence === true) {
    process.stdout.write(`Review disposition: covered by ${payload.review.reviewed_commit}\n`);
  }
  if (payload.unresolved_files?.length > 0) {
    process.stdout.write(`Unreviewed files: ${payload.unresolved_files.join(", ")}\n`);
  }
  if (payload.added.length > 0) process.stdout.write(`Added upstream files: ${payload.added.join(", ")}\n`);
  if (payload.changed.length > 0) process.stdout.write(`Changed files: ${payload.changed.join(", ")}\n`);
  if (payload.removed.length > 0) process.stdout.write(`Removed stale files: ${payload.removed.join(", ")}\n`);
  if (payload.synced === true) process.stdout.write("Synchronized extension files.\n");
}

function run() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    process.stdout.write(`${usage()}\n`);
    return 0;
  }
  const before = compare(args.sourceDir);
  if (args.check) {
    const payload = assessmentPayload(before, args);
    writeResult(payload, args.json);
    return payload.ok ? 0 : 1;
  }
  if (!before.ok) {
    const beforeAssessment = assessmentPayload(before, args);
    const permission = assessSyncPermission(beforeAssessment, {
      forceReviewedSync: args.forceReviewedSync,
    });
    if (!permission.allowed) {
      throw new Error(
        `refusing extension sync: ${permission.reason}; audit the upstream and pass --force-reviewed-sync only after explicit manual review`,
      );
    }
    sync(args.sourceDir, before);
  }
  const after = compare(args.sourceDir);
  const payload = {
    ...assessmentPayload(after, args),
    synced: !before.ok,
    before,
  };
  writeResult(payload, args.json);
  return after.ok ? 0 : 1;
}

if (resolve(process.argv[1] ?? "") === currentFile) {
  try {
    process.exitCode = run();
  } catch (error) {
    process.stderr.write(`sync-genericagent-extension failed: ${String(error?.message ?? error)}\n`);
    process.exitCode = 1;
  }
}
