#!/usr/bin/env node

import { createHash } from "node:crypto";
import {
  existsSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
} from "node:fs";
import { dirname, relative, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, "..");
const lockPath = resolve(repoRoot, "UPSTREAM.lock.json");
const defaultGenericAgentRoot = resolve(repoRoot, "..", "GenericAgent");
const defaultSourceDir = resolve(defaultGenericAgentRoot, "assets", "tmwd_cdp_bridge");
const defaultUpstreamRemote = "https://github.com/lsdefine/GenericAgent.git";
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
    latestTemp: false,
    latestKeep: false,
    latestRepo: null,
    latestRef: "main",
    sourceExplicit: false,
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
      parsed.sourceExplicit = true;
      index += 1;
      continue;
    }
    if (token === "--genericagent-root") {
      const value = String(argv[index + 1] ?? "").trim();
      if (!value || value.startsWith("--")) {
        throw new Error("missing --genericagent-root value");
      }
      parsed.genericAgentRoot = resolve(value);
      if (!parsed.sourceExplicit) {
        parsed.sourceDir = resolve(parsed.genericAgentRoot, "assets", "tmwd_cdp_bridge");
      }
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
    if (token === "--latest-temp") {
      parsed.latestTemp = true;
      continue;
    }
    if (token === "--latest-keep") {
      parsed.latestKeep = true;
      continue;
    }
    if (token === "--latest-repo") {
      const value = String(argv[index + 1] ?? "").trim();
      if (!value || value.startsWith("--")) {
        throw new Error("missing --latest-repo value");
      }
      parsed.latestRepo = value;
      index += 1;
      continue;
    }
    if (token === "--latest-ref") {
      const value = String(argv[index + 1] ?? "").trim();
      if (!value || value.startsWith("--")) {
        throw new Error("missing --latest-ref value");
      }
      parsed.latestRef = value;
      index += 1;
      continue;
    }
    if (token === "--help" || token === "-h") {
      parsed.help = true;
      continue;
    }
    throw new Error(`unknown argument: ${token}`);
  }
  if (parsed.latestKeep && !parsed.latestTemp) {
    throw new Error("--latest-keep requires --latest-temp");
  }
  if (parsed.latestTemp && (parsed.sourceDir !== defaultSourceDir || parsed.genericAgentRoot !== defaultGenericAgentRoot)) {
    throw new Error("--latest-temp cannot be combined with --source or --genericagent-root");
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
    "       node scripts/upstream-audit.mjs [--json] --latest-temp [--latest-repo <repo>] [--latest-ref <ref>] [--latest-keep]",
    "",
    "Audits GenericAgent upstream drift without modifying files.",
    "--no-remote skips git ls-remote and reports only local checkout state.",
    "--latest-temp clones the latest upstream checkout to a temp dir, audits it, then removes it unless --latest-keep is set.",
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
  const remote = remoteUrl || defaultUpstreamRemote;
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

function summarizeExtensionReview(diff, localFeatures, sourceFeatures) {
  const files = [];
  const localMissing = Array.isArray(localFeatures.missing) ? localFeatures.missing : [];
  const sourceMissing = Array.isArray(sourceFeatures.missing) ? sourceFeatures.missing : [];
  const sourceMissingLocalFeatures = localFeatures.ok === true && sourceFeatures.exists === true && sourceMissing.length > 0;

  for (const file of diff.changed ?? []) {
    if (file === "background.js" && sourceMissingLocalFeatures) {
      files.push({
        file,
        status: "changed",
        risk: "high",
        recommended_action: "manual_merge_preserve_local_bridge_features",
        preserve_features: sourceMissing,
        rationale: "source background.js is missing local enhanced bridge capabilities required by managed-tab lifecycle and JS reverse isolation",
      });
      continue;
    }
    if (file === "background.js") {
      files.push({
        file,
        status: "changed",
        risk: "medium",
        recommended_action: "manual_review_bridge_behavior",
        preserve_features: [],
        rationale: "background.js owns the extension command surface; review behavior before syncing",
      });
      continue;
    }
    if (file === "disable_dialogs.js") {
      files.push({
        file,
        status: "changed",
        risk: "medium",
        recommended_action: "selective_cherry_pick_after_behavior_review",
        preserve_features: [],
        rationale: "dialog suppression affects visible page behavior and should be reviewed before adoption",
      });
      continue;
    }
    files.push({
      file,
      status: "changed",
      risk: "medium",
      recommended_action: "selective_cherry_pick_after_review",
      preserve_features: [],
      rationale: "changed upstream extension file requires manual review",
    });
  }

  for (const file of diff.added ?? []) {
    files.push({
      file,
      status: "added",
      risk: "low",
      recommended_action: "review_and_add_if_needed",
      preserve_features: [],
      rationale: "new upstream extension file can usually be added after manifest and behavior review",
    });
  }

  for (const file of diff.removed ?? []) {
    files.push({
      file,
      status: "removed",
      risk: "high",
      recommended_action: "do_not_remove_without_manual_review",
      preserve_features: [],
      rationale: "local extension file removal may break existing bridge/runtime assumptions",
    });
  }

  let recommendedMergeMode = "no_extension_changes";
  if (sourceMissingLocalFeatures) {
    recommendedMergeMode = "manual_merge_preserve_local_bridge_features";
  } else if (diff.ok !== true) {
    recommendedMergeMode = "selective_cherry_pick";
  }

  return {
    recommended_merge_mode: recommendedMergeMode,
    local_only_enhanced_features: sourceMissingLocalFeatures ? sourceMissing : [],
    local_missing_enhanced_features: localMissing,
    files,
  };
}

function buildRecommendation({ diff, localFeatures, sourceFeatures, lockedCommit, localStatus, remote, extensionReview }) {
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
  if (extensionReview?.recommended_merge_mode === "manual_merge_preserve_local_bridge_features") {
    actions.push("Use extension_review.files to cherry-pick upstream changes while preserving local bridge capabilities.");
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

function materializeLatestCheckout(args, lock) {
  if (args.latestTemp !== true) {
    return {
      args,
      latest_checkout: null,
      cleanup: () => {},
    };
  }
  const remote = args.latestRepo ?? lock?.upstream?.remote ?? defaultUpstreamRemote;
  const tempRoot = mkdtempSync(resolve(tmpdir(), "genericagent-upstream-"));
  const cloneArgs = ["clone", "--depth", "1", "--branch", args.latestRef, remote, tempRoot];
  const result = spawnSync("git", cloneArgs, {
    cwd: repoRoot,
    encoding: "utf8",
    timeout: 120_000,
  });
  if (result.status !== 0) {
    rmSync(tempRoot, { recursive: true, force: true });
    const detail = compactText(result.stderr || result.stdout || "unknown clone error", 500);
    throw new Error(`git ${cloneArgs.join(" ")} failed: ${detail}`);
  }
  return {
    args: {
      ...args,
      genericAgentRoot: tempRoot,
      sourceDir: resolve(tempRoot, "assets", "tmwd_cdp_bridge"),
    },
    latest_checkout: {
      mode: "temp_clone",
      remote,
      ref: args.latestRef,
      root: tempRoot,
      source_dir: resolve(tempRoot, "assets", "tmwd_cdp_bridge"),
      cleanup: args.latestKeep ? "kept" : "removed_after_audit",
    },
    cleanup: () => {
      if (!args.latestKeep) {
        rmSync(tempRoot, { recursive: true, force: true });
      }
    },
  };
}

function buildAudit(args) {
  const lock = safeReadJson(lockPath);
  const latest = materializeLatestCheckout(args, lock);
  const resolvedArgs = latest.args;
  try {
    const lockedCommit = lock?.upstream?.commit ?? null;
    const localStatus = gitStatusForGenericAgent(resolvedArgs.genericAgentRoot);
    const remote = remoteHead(localStatus.remote ?? lock?.upstream?.remote, args.noRemote);
    const diff = compareExtension(resolvedArgs.sourceDir);
    const localFeatures = featureMatrixFor(resolve(targetDir, "background.js"));
    const sourceFeatures = featureMatrixFor(resolve(resolvedArgs.sourceDir, "background.js"));
    const extensionReview = summarizeExtensionReview(diff, localFeatures, sourceFeatures);
    const recommendation = buildRecommendation({
      diff,
      localFeatures,
      sourceFeatures,
      lockedCommit,
      localStatus,
      remote,
      extensionReview,
    });
    return {
      ok: diff.source_exists === true,
      check: "genericagent-upstream-audit",
      latest_checkout: latest.latest_checkout,
      locked_commit: lockedCommit,
      lock_path: lockPath,
      local_genericagent: localStatus,
      remote_main: remote,
      source_dir: resolvedArgs.sourceDir,
      extension_diff: diff,
      extension_review: extensionReview,
      local_extension_features: localFeatures,
      source_extension_features: sourceFeatures,
      local_matches_locked_commit: Boolean(localStatus.head && lockedCommit && localStatus.head === lockedCommit),
      local_matches_remote_main: Boolean(localStatus.head && remote.commit && localStatus.head === remote.commit),
      lock_matches_remote_main: Boolean(lockedCommit && remote.commit && lockedCommit === remote.commit),
      safe_to_direct_sync: recommendation.safe_to_direct_sync,
      manual_review_required: recommendation.manual_review_required,
      recommended_actions: recommendation.actions,
    };
  } finally {
    latest.cleanup();
  }
}

function outputText(audit) {
  process.stdout.write(`upstream_audit ok=${audit.ok} manual_review_required=${audit.manual_review_required} safe_to_direct_sync=${audit.safe_to_direct_sync}\n`);
  process.stdout.write(`locked_commit=${audit.locked_commit ?? "unknown"}\n`);
  process.stdout.write(`local_genericagent=${audit.local_genericagent.head ?? "unknown"} root=${audit.local_genericagent.root}\n`);
  process.stdout.write(`remote_main=${audit.remote_main.commit ?? "unknown"} remote=${audit.remote_main.remote ?? "unknown"}\n`);
  const diff = audit.extension_diff;
  process.stdout.write(`extension_diff ok=${diff.ok} changed=${diff.changed.length} added=${diff.added.length} removed=${diff.removed.length}\n`);
  process.stdout.write(`extension_review merge_mode=${audit.extension_review.recommended_merge_mode}\n`);
  if (diff.changed.length > 0) process.stdout.write(`changed: ${diff.changed.join(", ")}\n`);
  if (diff.added.length > 0) process.stdout.write(`added: ${diff.added.join(", ")}\n`);
  if (diff.removed.length > 0) process.stdout.write(`removed: ${diff.removed.join(", ")}\n`);
  if (!audit.source_extension_features.ok && audit.source_extension_features.exists) {
    process.stdout.write(`source_missing_enhanced_features=${audit.source_extension_features.missing.join(",")}\n`);
  }
  for (const item of audit.extension_review.files) {
    process.stdout.write(`review ${item.file}: risk=${item.risk} action=${item.recommended_action}\n`);
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
