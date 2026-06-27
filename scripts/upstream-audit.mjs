#!/usr/bin/env node

import { createHash } from "node:crypto";
import {
  existsSync,
  readdirSync,
  readFileSync,
  statSync,
} from "node:fs";
import { dirname, relative, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, "..");
const lockPath = resolve(repoRoot, "UPSTREAM.lock.json");
const defaultGenericAgentRoot = resolve(repoRoot, "..", "GenericAgent");
const defaultSourceDir = resolve(defaultGenericAgentRoot, "assets", "tmwd_cdp_bridge");
const targetDir = resolve(repoRoot, "extension");
const managedExtraFiles = new Set(["config.example.js"]);
const ignoredFiles = new Set(["config.js"]);
const ENHANCED_BRIDGE_FEATURES = [
  {
    id: "handle_tabs_dispatch",
    description: "top-level TMWD tabs command dispatches through handleTabs",
    fragments: ["async function handleTabs(msg)", "return await handleTabs(msg)"],
  },
  {
    id: "tabs_get",
    description: "tabs.get is available for stale-tab and about:blank diagnostics",
    fragments: ["method === 'get'", "chrome.tabs.get"],
  },
  {
    id: "tabs_close",
    description: "tabs.close removes only explicitly selected TMWD-owned tabs",
    fragments: ["method === 'close'", "chrome.tabs.remove"],
  },
  {
    id: "include_unscriptable",
    description: "tabs.list can include about:blank/internal unscriptable tabs when requested",
    fragments: ["includeUnscriptable", "includeUnscriptableTabs"],
  },
  {
    id: "unsupported_tabs_method",
    description: "unsupported tabs methods fail explicitly",
    fragments: ["unsupported tabs method"],
  },
  {
    id: "batch_uses_handle_tabs",
    description: "batch tab commands use the same handleTabs capability surface",
    fragments: ["R.push(await handleTabs(c))"],
  },
];

function parseArgs(argv) {
  const parsed = {
    sourceDir: defaultSourceDir,
    genericAgentRoot: defaultGenericAgentRoot,
    json: false,
    noRemote: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const token = String(argv[index] ?? "");
    if (token === "--source") {
      const value = String(argv[index + 1] ?? "").trim();
      if (!value || value.startsWith("--")) {
        throw new Error("missing --source value");
      }
      parsed.sourceDir = resolve(value);
      parsed.genericAgentRoot = inferGenericAgentRoot(parsed.sourceDir);
      index += 1;
      continue;
    }
    if (token === "--genericagent-root") {
      const value = String(argv[index + 1] ?? "").trim();
      if (!value || value.startsWith("--")) {
        throw new Error("missing --genericagent-root value");
      }
      parsed.genericAgentRoot = resolve(value);
      parsed.sourceDir = resolve(parsed.genericAgentRoot, "assets", "tmwd_cdp_bridge");
      index += 1;
      continue;
    }
    if (token === "--json") {
      parsed.json = true;
      continue;
    }
    if (token === "--no-remote") {
      parsed.noRemote = true;
      continue;
    }
    if (token === "--help" || token === "-h") {
      parsed.help = true;
      continue;
    }
    throw new Error(`unknown argument: ${token}`);
  }
  return parsed;
}

function inferGenericAgentRoot(sourceDir) {
  const normalized = resolve(sourceDir);
  const marker = `${["assets", "tmwd_cdp_bridge"].join("/")}`;
  const rel = normalized.replaceAll("\\", "/");
  if (rel.endsWith(marker)) {
    return resolve(normalized, "..", "..");
  }
  return resolve(normalized, "..", "..");
}

function usage() {
  return [
    "Usage: node scripts/upstream-audit.mjs [--json] [--source <GenericAgent/assets/tmwd_cdp_bridge>]",
    "       node scripts/upstream-audit.mjs [--json] [--genericagent-root <GenericAgent>]",
    "",
    "Audits GenericAgent upstream drift without modifying files.",
    "--no-remote skips git ls-remote and reports only local checkout state.",
  ].join("\n");
}

function exec(command, args, cwd, options = {}) {
  const result = spawnSync(command, args, {
    cwd,
    encoding: "utf8",
    timeout: options.timeoutMs ?? 10_000,
  });
  if (result.status !== 0) {
    const detail = String(result.stderr || result.stdout || "unknown error").trim();
    throw new Error(`${command} ${args.join(" ")} failed: ${detail}`);
  }
  return String(result.stdout ?? "").trim();
}

function tryExec(command, args, cwd, options = {}) {
  try {
    return {
      ok: true,
      value: exec(command, args, cwd, options),
    };
  } catch (error) {
    return {
      ok: false,
      error: compactText(error?.message ?? error, 500),
    };
  }
}

function compactText(value, maxLength = 240) {
  return String(value ?? "").replace(/\s+/g, " ").trim().slice(0, maxLength);
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
      if (!entry.isFile() || ignoredFiles.has(rel)) {
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

function safeReadJson(path) {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    return {
      error: compactText(error?.message ?? error),
    };
  }
}

function compareExtension(sourceDir) {
  if (!existsSync(sourceDir) || !statSync(sourceDir).isDirectory()) {
    return {
      ok: false,
      source_exists: false,
      source_dir: sourceDir,
      target_dir: targetDir,
      added: [],
      removed: [],
      changed: [],
      error: "missing GenericAgent extension source",
    };
  }
  const sourceFiles = listFiles(sourceDir);
  const targetFiles = listFiles(targetDir).filter((file) => !managedExtraFiles.has(file));
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
    source_exists: true,
    source_dir: sourceDir,
    target_dir: targetDir,
    added,
    removed,
    changed,
    ignored: [...ignoredFiles].sort(),
    managed_extra: [...managedExtraFiles].sort(),
  };
}

function readTextIfExists(path) {
  return existsSync(path) ? readFileSync(path, "utf8") : "";
}

function featureMatrixFor(filePath) {
  const source = readTextIfExists(filePath);
  const features = {};
  for (const feature of ENHANCED_BRIDGE_FEATURES) {
    features[feature.id] = {
      ok: feature.fragments.every((fragment) => source.includes(fragment)),
      description: feature.description,
      fragments: [...feature.fragments],
    };
  }
  const missing = Object.entries(features)
    .filter(([, result]) => result.ok !== true)
    .map(([id]) => id);
  return {
    path: filePath,
    exists: source.length > 0,
    ok: missing.length === 0,
    missing,
    features,
  };
}

function gitStatusForGenericAgent(root) {
  if (!existsSync(resolve(root, ".git"))) {
    return {
      ok: false,
      root,
      error: "not a git checkout",
    };
  }
  const head = tryExec("git", ["rev-parse", "HEAD"], root);
  const remote = tryExec("git", ["remote", "get-url", "origin"], root);
  const branch = tryExec("git", ["rev-parse", "--abbrev-ref", "HEAD"], root);
  const upstream = tryExec("git", ["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{u}"], root);
  const aheadBehind = upstream.ok
    ? tryExec("git", ["rev-list", "--left-right", "--count", `HEAD...${upstream.value}`], root)
    : { ok: false, error: upstream.error };
  const [ahead, behind] = aheadBehind.ok
    ? aheadBehind.value.split(/\s+/).map((value) => Number(value))
    : [null, null];
  return {
    ok: head.ok,
    root,
    head: head.value,
    remote: remote.value,
    branch: branch.value,
    upstream: upstream.value,
    ahead,
    behind,
    errors: [head, remote, branch, upstream, aheadBehind]
      .filter((row) => row.ok !== true)
      .map((row) => row.error),
  };
}

function remoteHead(remoteUrl, noRemote) {
  if (noRemote) {
    return {
      ok: false,
      skipped: true,
      reason: "disabled_by_no_remote",
    };
  }
  const remote = remoteUrl || "https://github.com/lsdefine/GenericAgent.git";
  const result = tryExec("git", ["ls-remote", remote, "HEAD", "refs/heads/main"], repoRoot, {
    timeoutMs: 20_000,
  });
  if (!result.ok) {
    return {
      ok: false,
      remote,
      error: result.error,
    };
  }
  const rows = result.value
    .split(/\r?\n/g)
    .map((line) => line.trim().split(/\s+/))
    .filter((parts) => parts.length >= 2);
  const main = rows.find((parts) => parts[1] === "refs/heads/main") ?? rows[0];
  return {
    ok: Boolean(main?.[0]),
    remote,
    commit: main?.[0],
    refs: Object.fromEntries(rows.map((parts) => [parts[1], parts[0]])),
  };
}

function buildRecommendation({ diff, localFeatures, sourceFeatures, lockedCommit, localStatus, remote }) {
  const actions = [];
  let safeToDirectSync = diff.ok === true;
  let manualReviewRequired = false;
  if (diff.source_exists !== true) {
    safeToDirectSync = false;
    manualReviewRequired = true;
    actions.push("Provide a GenericAgent checkout via --source or --genericagent-root before attempting extension review.");
  }
  if (!diff.ok) {
    manualReviewRequired = true;
    actions.push(`Review extension drift before syncing: changed=${diff.changed.length} added=${diff.added.length} removed=${diff.removed.length}.`);
  }
  if (localFeatures.ok && sourceFeatures.exists && !sourceFeatures.ok) {
    safeToDirectSync = false;
    manualReviewRequired = true;
    actions.push(`Do not direct-sync: upstream source is missing local enhanced bridge features (${sourceFeatures.missing.join(", ")}).`);
  }
  if (remote.ok && lockedCommit && remote.commit !== lockedCommit) {
    manualReviewRequired = true;
    actions.push(`Remote main differs from UPSTREAM.lock.json (${lockedCommit} -> ${remote.commit}); audit selective absorption before updating the lock.`);
  }
  if (localStatus.ok && remote.ok && localStatus.head !== remote.commit) {
    actions.push("Local GenericAgent checkout is not at remote main; use a fresh checkout or explicit --source for latest-source comparison.");
  }
  if (actions.length === 0) {
    actions.push("No actionable upstream drift detected for the checked source.");
  }
  return {
    safe_to_direct_sync: safeToDirectSync,
    manual_review_required: manualReviewRequired,
    actions,
  };
}

function buildAudit(args) {
  const lock = safeReadJson(lockPath);
  const lockedCommit = lock?.upstream?.commit ?? null;
  const localStatus = gitStatusForGenericAgent(args.genericAgentRoot);
  const remote = remoteHead(localStatus.remote ?? lock?.upstream?.remote, args.noRemote);
  const diff = compareExtension(args.sourceDir);
  const localFeatures = featureMatrixFor(resolve(targetDir, "background.js"));
  const sourceFeatures = featureMatrixFor(resolve(args.sourceDir, "background.js"));
  const recommendation = buildRecommendation({
    diff,
    localFeatures,
    sourceFeatures,
    lockedCommit,
    localStatus,
    remote,
  });
  return {
    ok: diff.source_exists === true,
    check: "genericagent-upstream-audit",
    locked_commit: lockedCommit,
    lock_path: lockPath,
    local_genericagent: localStatus,
    remote_main: remote,
    source_dir: args.sourceDir,
    extension_diff: diff,
    local_extension_features: localFeatures,
    source_extension_features: sourceFeatures,
    local_matches_locked_commit: Boolean(localStatus.head && lockedCommit && localStatus.head === lockedCommit),
    local_matches_remote_main: Boolean(localStatus.head && remote.commit && localStatus.head === remote.commit),
    lock_matches_remote_main: Boolean(lockedCommit && remote.commit && lockedCommit === remote.commit),
    safe_to_direct_sync: recommendation.safe_to_direct_sync,
    manual_review_required: recommendation.manual_review_required,
    recommended_actions: recommendation.actions,
  };
}

function outputText(audit) {
  process.stdout.write(`upstream_audit ok=${audit.ok} manual_review_required=${audit.manual_review_required} safe_to_direct_sync=${audit.safe_to_direct_sync}\n`);
  process.stdout.write(`locked_commit=${audit.locked_commit ?? "unknown"}\n`);
  process.stdout.write(`local_genericagent=${audit.local_genericagent.head ?? "unknown"} root=${audit.local_genericagent.root}\n`);
  process.stdout.write(`remote_main=${audit.remote_main.commit ?? "unknown"} remote=${audit.remote_main.remote ?? "unknown"}\n`);
  const diff = audit.extension_diff;
  process.stdout.write(`extension_diff ok=${diff.ok} changed=${diff.changed.length} added=${diff.added.length} removed=${diff.removed.length}\n`);
  if (diff.changed.length > 0) process.stdout.write(`changed: ${diff.changed.join(", ")}\n`);
  if (diff.added.length > 0) process.stdout.write(`added: ${diff.added.join(", ")}\n`);
  if (diff.removed.length > 0) process.stdout.write(`removed: ${diff.removed.join(", ")}\n`);
  if (!audit.source_extension_features.ok && audit.source_extension_features.exists) {
    process.stdout.write(`source_missing_enhanced_features=${audit.source_extension_features.missing.join(",")}\n`);
  }
  process.stdout.write("recommended_actions:\n");
  for (const action of audit.recommended_actions) {
    process.stdout.write(`  - ${action}\n`);
  }
}

function run() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    process.stdout.write(`${usage()}\n`);
    return 0;
  }
  const audit = buildAudit(args);
  if (args.json) {
    process.stdout.write(`${JSON.stringify(audit)}\n`);
  } else {
    outputText(audit);
  }
  return audit.ok ? 0 : 1;
}

try {
  process.exitCode = run();
} catch (error) {
  process.stderr.write(`upstream-audit failed: ${String(error?.message ?? error)}\n`);
  process.exitCode = 1;
}
