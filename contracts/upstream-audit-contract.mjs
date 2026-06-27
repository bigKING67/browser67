#!/usr/bin/env node

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const repoRoot = path.resolve(import.meta.dirname, "..");
const extensionDir = path.resolve(repoRoot, "extension");

function run(command, args, cwd, options = {}) {
  const result = spawnSync(command, args, {
    cwd,
    encoding: "utf8",
    timeout: options.timeoutMs ?? 30_000,
  });
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(" ")} failed: ${String(result.stderr || result.stdout).trim()}`);
  }
  return result.stdout.trim();
}

function initGitRepo(root) {
  run("git", ["init"], root);
  run("git", ["checkout", "-B", "main"], root);
  run("git", ["config", "user.email", "fixture@example.test"], root);
  run("git", ["config", "user.name", "Fixture"], root);
  run("git", ["add", "assets"], root);
  run("git", ["commit", "-m", "fixture"], root);
}

function copyExtensionSource(sourceDir) {
  mkdirSync(sourceDir, { recursive: true });
  for (const file of readdirSync(extensionDir)) {
    if (file === "config.js" || file === "config.example.js") {
      continue;
    }
    const sourcePath = path.resolve(extensionDir, file);
    const targetPath = path.resolve(sourceDir, file);
    cpSync(sourcePath, targetPath, { recursive: true });
  }
}

function createGenericAgentFixture(kind) {
  const root = mkdtempSync(path.join(tmpdir(), `genericagent-audit-${kind}-`));
  const sourceDir = path.resolve(root, "assets", "tmwd_cdp_bridge");
  copyExtensionSource(sourceDir);
  if (kind === "disable-dialogs-drift") {
    const file = path.resolve(sourceDir, "disable_dialogs.js");
    writeFileSync(file, `${readFileSync(file, "utf8")}\n// fixture upstream dialog drift\n`);
  }
  if (kind === "disable-dialogs-final-newline-only") {
    const file = path.resolve(sourceDir, "disable_dialogs.js");
    writeFileSync(file, readFileSync(file, "utf8").replace(/\n$/, ""));
  }
  if (kind === "background-missing-local-features") {
    writeFileSync(
      path.resolve(sourceDir, "background.js"),
      [
        "chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {",
        "  sendResponse({ ok: true, upstream_fixture: true, cmd: msg?.cmd ?? null });",
        "});",
        "",
      ].join("\n"),
    );
  }
  initGitRepo(root);
  return {
    root,
    sourceDir,
    cleanup: () => rmSync(root, { recursive: true, force: true }),
  };
}

function runAudit(args, expectedStatus = 0) {
  const result = spawnSync(process.execPath, ["scripts/upstream-audit.mjs", ...args], {
    cwd: repoRoot,
    encoding: "utf8",
    timeout: 120_000,
  });
  assert.equal(result.status, expectedStatus, String(result.stderr || result.stdout));
  const stdout = result.stdout.trim();
  return {
    stdout,
    json: stdout.startsWith("{") ? JSON.parse(stdout) : null,
  };
}

function writeReviewLedger(reviewFile, { reviewedCommit, changedFiles = ["background.js"] }) {
  writeFileSync(reviewFile, JSON.stringify({
    schema_version: 1,
    upstream: {
      name: "lsdefine/GenericAgent",
      remote: path.dirname(reviewFile),
      reviewed_ref: "main",
      reviewed_commit: reviewedCommit,
      reviewed_at: "2026-06-27",
      release_context: "fixture",
    },
    decision: {
      extension_merge_mode: "manual_merge_preserve_local_bridge_features",
      direct_sync_allowed: false,
      local_extension_action: "keep_local_bridge",
      lock_action: "keep_extension_lock_at_fixture_baseline",
      reason: "Fixture upstream background.js lacks local bridge features.",
    },
    extension_review: {
      changed_files: changedFiles,
      background_preserve_features: [
        "handle_tabs_dispatch",
        "tabs_get",
        "tabs_close",
        "include_unscriptable",
        "unsupported_tabs_method",
        "batch_uses_handle_tabs",
        "numeric_tab_id_validation",
        "cookies_tabid_validation",
        "cdp_tabid_validation",
        "ws_exec_tabid_validation",
      ],
      per_file_decision: [
        {
          file: "background.js",
          action: "keep_local_bridge_features",
          risk: "high_if_blind_synced",
        },
      ],
    },
    absorbed_reference: {
      paths: [
        "docs/upstream/genericagent/README.md",
      ],
      notes: "Fixture review ledger.",
    },
  }, null, 2));
}

function assertAlignedAudit() {
  const fixture = createGenericAgentFixture("aligned");
  try {
    const { json } = runAudit([
      "--source", fixture.sourceDir,
      "--genericagent-root", fixture.root,
      "--no-remote",
      "--json",
    ]);
    assert.equal(json.ok, true);
    assert.equal(json.extension_diff.ok, true);
    assert.equal(json.safe_to_direct_sync, true);
    assert.equal(json.checked_source.matches_locked_commit, false);
    assert.equal(json.checked_source.matches_remote_main, false);
    assert.equal(json.checked_source.latest_temp, false);
    assert.equal(json.source_checkout_matches_locked_commit, false);
    assert.equal(json.source_checkout_matches_remote_main, false);
    assert.equal(json.extension_review.recommended_merge_mode, "no_extension_changes");
    assert.deepEqual(json.extension_review.files, []);
  } finally {
    fixture.cleanup();
  }
}

function assertChangedFileClassifier() {
  const fixture = createGenericAgentFixture("disable-dialogs-drift");
  try {
    const { json } = runAudit([
      "--source", fixture.sourceDir,
      "--genericagent-root", fixture.root,
      "--no-remote",
      "--json",
    ]);
    assert.equal(json.ok, true);
    assert.equal(json.extension_diff.ok, false);
    assert.deepEqual(json.extension_diff.changed, ["disable_dialogs.js"]);
    assert.equal(json.safe_to_direct_sync, false);
    assert.equal(json.extension_review.recommended_merge_mode, "selective_cherry_pick");
    assert.equal(json.extension_review.files[0].diff_kind, "content");
    assert.equal(json.extension_review.files[0].recommended_action, "selective_cherry_pick_after_behavior_review");

    const text = runAudit([
      "--source", fixture.sourceDir,
      "--genericagent-root", fixture.root,
      "--no-remote",
    ]).stdout;
    assert.match(text, /extension_review merge_mode=selective_cherry_pick/);
    assert.match(text, /review disable_dialogs\.js: risk=medium action=selective_cherry_pick_after_behavior_review/);
  } finally {
    fixture.cleanup();
  }
}

function assertFinalNewlineOnlyClassifier() {
  const fixture = createGenericAgentFixture("disable-dialogs-final-newline-only");
  try {
    const { json } = runAudit([
      "--source", fixture.sourceDir,
      "--genericagent-root", fixture.root,
      "--no-remote",
      "--json",
    ]);
    assert.equal(json.ok, true);
    assert.equal(json.extension_diff.ok, false);
    assert.deepEqual(json.extension_diff.changed, ["disable_dialogs.js"]);
    assert.equal(json.safe_to_direct_sync, true);
    assert.equal(json.manual_review_required, false);
    assert.equal(json.extension_review.recommended_merge_mode, "no_behavior_changes_keep_local");
    assert.equal(json.extension_review.files[0].diff_kind, "final_newline_only");
    assert.equal(json.extension_review.files[0].risk, "none");
    assert.equal(json.extension_review.files[0].recommended_action, "keep_local_no_behavior_change");

    const text = runAudit([
      "--source", fixture.sourceDir,
      "--genericagent-root", fixture.root,
      "--no-remote",
    ]).stdout;
    assert.match(text, /extension_review merge_mode=no_behavior_changes_keep_local/);
    assert.match(text, /review disable_dialogs\.js: risk=none action=keep_local_no_behavior_change diff_kind=final_newline_only/);
  } finally {
    fixture.cleanup();
  }
}

function assertMissingBridgeFeatureClassifier() {
  const fixture = createGenericAgentFixture("background-missing-local-features");
  try {
    const { json } = runAudit([
      "--source", fixture.sourceDir,
      "--genericagent-root", fixture.root,
      "--no-remote",
      "--json",
    ]);
    assert.equal(json.ok, true);
    assert.equal(json.safe_to_direct_sync, false);
    assert.equal(json.extension_review.recommended_merge_mode, "manual_merge_preserve_local_bridge_features");
    assert.equal(json.extension_review.files[0].file, "background.js");
    assert.equal(json.extension_review.files[0].risk, "high");
    assert.ok(json.extension_review.local_only_enhanced_features.includes("tabs_get"));
    assert.ok(json.extension_review.local_only_enhanced_features.includes("numeric_tab_id_validation"));
    assert.ok(json.recommended_actions.some((action) => action.includes("Do not direct-sync")));
  } finally {
    fixture.cleanup();
  }
}

function assertMissingSourceFailsClosed() {
  const fixture = createGenericAgentFixture("missing-source-root");
  try {
    const missingSource = path.resolve(fixture.root, "assets", "missing_bridge");
    const { json } = runAudit([
      "--source", missingSource,
      "--genericagent-root", fixture.root,
      "--no-remote",
      "--json",
    ], 1);
    assert.equal(json.ok, false);
    assert.equal(json.extension_diff.source_exists, false);
    assert.equal(json.safe_to_direct_sync, false);
  } finally {
    fixture.cleanup();
  }
}

function assertLatestTempLocalClone() {
  const fixture = createGenericAgentFixture("background-missing-local-features");
  try {
    const { json } = runAudit([
      "--latest-temp",
      "--latest-repo", fixture.root,
      "--latest-ref", "main",
      "--no-remote",
      "--json",
    ]);
    assert.equal(json.ok, true);
    assert.equal(json.latest_checkout.mode, "temp_clone");
    assert.equal(json.checked_source.latest_temp, true);
    assert.equal(json.source_checkout_matches_locked_commit, false);
    assert.equal(json.latest_checkout.cleanup, "removed_after_audit");
    assert.equal(json.extension_review.recommended_merge_mode, "manual_merge_preserve_local_bridge_features");
    assert.equal(existsSync(json.latest_checkout.root), false);
  } finally {
    fixture.cleanup();
  }
}

function assertReviewedRemoteDrift() {
  const fixture = createGenericAgentFixture("background-missing-local-features");
  try {
    const reviewedCommit = run("git", ["rev-parse", "HEAD"], fixture.root);
    const reviewFile = path.resolve(fixture.root, "UPSTREAM.review.json");
    writeReviewLedger(reviewFile, { reviewedCommit });

    const { json } = runAudit([
      "--latest-temp",
      "--latest-repo", fixture.root,
      "--latest-ref", "main",
      "--review-file", reviewFile,
      "--json",
    ]);
    assert.equal(json.ok, true);
    assert.equal(json.safe_to_direct_sync, false);
    assert.equal(json.manual_review_required, false);
    assert.equal(json.latest_review_recommended, false);
    assert.equal(json.upstream_review.status, "current");
    assert.equal(json.upstream_review.stale, false);
    assert.equal(json.upstream_review.remote_main_reviewed, true);
    assert.equal(json.upstream_review.current_extension_review_matches_decision, true);
    assert.equal(json.upstream_review.pending_remote_review, false);
    assert.ok(json.recommended_actions.some((action) => action.includes("matches UPSTREAM.review.json")));
  } finally {
    fixture.cleanup();
  }
}

function assertStaleReviewLedger() {
  const fixture = createGenericAgentFixture("background-missing-local-features");
  try {
    const reviewFile = path.resolve(fixture.root, "UPSTREAM.review.json");
    writeReviewLedger(reviewFile, {
      reviewedCommit: "0000000000000000000000000000000000000000",
    });

    const { json } = runAudit([
      "--latest-temp",
      "--latest-repo", fixture.root,
      "--latest-ref", "main",
      "--review-file", reviewFile,
      "--json",
    ]);
    assert.equal(json.ok, true);
    assert.equal(json.safe_to_direct_sync, false);
    assert.equal(json.manual_review_required, true);
    assert.equal(json.latest_review_recommended, false);
    assert.equal(json.upstream_review.status, "stale");
    assert.equal(json.upstream_review.stale, true);
    assert.equal(json.upstream_review.pending_remote_review, true);
    assert.equal(json.upstream_review.remote_main_reviewed, false);
    assert.match(json.upstream_review.next_command, /upstream:audit:latest/);
    assert.ok(json.recommended_actions.some((action) => action.includes("UPSTREAM.review.json is stale")));
  } finally {
    fixture.cleanup();
  }
}

function main() {
  assertAlignedAudit();
  assertChangedFileClassifier();
  assertFinalNewlineOnlyClassifier();
  assertMissingBridgeFeatureClassifier();
  assertMissingSourceFailsClosed();
  assertLatestTempLocalClone();
  assertReviewedRemoteDrift();
  assertStaleReviewLedger();
  process.stdout.write(JSON.stringify({
    ok: true,
    check: "upstream-audit-contract",
    scenarios: [
      "aligned",
      "changed-file-classifier",
      "final-newline-only-classifier",
      "missing-bridge-feature-classifier",
      "missing-source",
      "latest-temp-local-clone",
      "reviewed-remote-drift",
      "stale-review-ledger",
    ],
  }));
  process.stdout.write("\n");
}

try {
  main();
} catch (error) {
  process.stderr.write(`upstream-audit-contract failed: ${String(error?.stack ?? error)}\n`);
  process.exitCode = 1;
}
