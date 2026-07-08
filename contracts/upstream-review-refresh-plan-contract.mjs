#!/usr/bin/env node

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  cpSync,
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
const planScript = path.resolve(repoRoot, "scripts/upstream-review-refresh-plan.mjs");

function run(command, args, cwd, options = {}) {
  const result = spawnSync(command, args, {
    cwd,
    encoding: "utf8",
    timeout: options.timeoutMs ?? 30_000,
  });
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(" ")} failed: ${String(result.stderr || result.stdout).trim()}`);
  }
  return String(result.stdout ?? "").trim();
}

function initGitRepo(root) {
  run("git", ["init"], root);
  run("git", ["checkout", "-B", "main"], root);
  run("git", ["config", "user.email", "fixture@example.test"], root);
  run("git", ["config", "user.name", "Fixture"], root);
  run("git", ["add", "assets"], root);
  run("git", ["commit", "-m", "fixture"], root);
}

function createGenericAgentFixture() {
  const root = mkdtempSync(path.join(tmpdir(), "genericagent-review-plan-"));
  const sourceDir = path.resolve(root, "assets", "tmwd_cdp_bridge");
  mkdirSync(sourceDir, { recursive: true });
  for (const file of readdirSync(extensionDir)) {
    if (file === "config.js" || file === "config.example.js") continue;
    cpSync(path.resolve(extensionDir, file), path.resolve(sourceDir, file), { recursive: true });
  }
  writeFileSync(
    path.resolve(sourceDir, "background.js"),
    [
      "chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {",
      "  sendResponse({ ok: true, upstream_fixture: true, cmd: msg?.cmd ?? null });",
      "});",
      "",
    ].join("\n"),
  );
  initGitRepo(root);
  return {
    root,
    head: run("git", ["rev-parse", "HEAD"], root),
    cleanup: () => rmSync(root, { recursive: true, force: true }),
  };
}

function writeStaleReview(reviewFile) {
  writeFileSync(reviewFile, `${JSON.stringify({
    schema_version: 1,
    upstream: {
      name: "lsdefine/GenericAgent",
      remote: path.dirname(reviewFile),
      reviewed_ref: "main",
      reviewed_commit: "0000000000000000000000000000000000000000",
      reviewed_at: "2026-07-01",
      release_context: "stale fixture",
    },
    decision: {
      extension_merge_mode: "manual_merge_preserve_local_bridge_features",
      direct_sync_allowed: false,
      local_extension_action: "keep_local_bridge",
      lock_action: "keep_extension_lock_at_fixture_baseline",
      reason: "Fixture stale review.",
    },
    extension_review: {
      changed_files: ["background.js"],
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
      paths: ["docs/upstream/genericagent/README.md"],
      notes: "Fixture review ledger.",
    },
  }, null, 2)}\n`);
}

function runPlan(args, expectedStatus = 0) {
  const result = spawnSync(process.execPath, [planScript, ...args], {
    cwd: repoRoot,
    encoding: "utf8",
    timeout: 120_000,
  });
  assert.equal(result.status, expectedStatus, String(result.stderr || result.stdout));
  const stdout = String(result.stdout ?? "").trim();
  if (expectedStatus !== 0) {
    return String(result.stderr || result.stdout || "").trim();
  }
  return stdout.startsWith("{") ? JSON.parse(stdout) : stdout;
}

function main() {
  const fixture = createGenericAgentFixture();
  const tempRoot = mkdtempSync(path.join(tmpdir(), "browser67-review-plan-"));
  try {
    const reviewFile = path.resolve(tempRoot, "UPSTREAM.review.json");
    writeStaleReview(reviewFile);

    const preview = runPlan([
      "--latest-repo", fixture.root,
      "--latest-ref", "main",
      "--review-file", reviewFile,
      "--reviewed-at", "2026-07-08",
      "--json",
    ]);
    assert.equal(preview.ok, true);
    assert.equal(preview.status, "ready_for_confirmation");
    assert.equal(preview.needs_refresh, true);
    assert.equal(preview.wrote, false);
    assert.equal(preview.proposed_reviewed_commit, fixture.head);
    assert.equal(preview.proposed_review.upstream.reviewed_commit, fixture.head);
    assert.equal(preview.proposed_review.upstream.reviewed_at, "2026-07-08");
    assert.equal(preview.proposed_review.decision.direct_sync_allowed, false);
    assert.equal(preview.proposed_review.decision.extension_merge_mode, "manual_merge_preserve_local_bridge_features");
    assert.deepEqual(preview.proposed_review.extension_review.changed_files, ["background.js"]);
    assert.ok(preview.proposed_review.extension_review.background_preserve_features.includes("tabs_get"));
    assert.ok(preview.commands.write_review.includes("--write --confirm-reviewed"));

    const missingConfirm = runPlan([
      "--latest-repo", fixture.root,
      "--review-file", reviewFile,
      "--write",
      "--json",
    ], 1);
    assert.match(missingConfirm, /--write requires --confirm-reviewed/);

    const written = runPlan([
      "--latest-repo", fixture.root,
      "--latest-ref", "main",
      "--review-file", reviewFile,
      "--reviewed-at", "2026-07-08",
      "--write",
      "--confirm-reviewed",
      "--json",
    ]);
    assert.equal(written.status, "written");
    assert.equal(written.wrote, true);
    const refreshed = JSON.parse(readFileSync(reviewFile, "utf8"));
    assert.equal(refreshed.upstream.reviewed_commit, fixture.head);

    const current = runPlan([
      "--latest-repo", fixture.root,
      "--latest-ref", "main",
      "--review-file", reviewFile,
      "--reviewed-at", "2026-07-08",
      "--json",
    ]);
    assert.equal(current.status, "current");
    assert.equal(current.needs_refresh, false);

    process.stdout.write(`${JSON.stringify({
      ok: true,
      check: "upstream-review-refresh-plan-contract",
      scenarios: ["preview", "write-confirmation", "write", "current-noop"],
    })}\n`);
  } finally {
    fixture.cleanup();
    rmSync(tempRoot, { recursive: true, force: true });
  }
}

try {
  main();
} catch (error) {
  process.stderr.write(`upstream-review-refresh-plan-contract failed: ${String(error?.stack ?? error)}\n`);
  process.exitCode = 1;
}
