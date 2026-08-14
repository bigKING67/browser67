#!/usr/bin/env node

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { collectGitSnapshot } from "../scripts/upstream-lock.mjs";

function run(command, args, cwd) {
  const result = spawnSync(command, args, { cwd, encoding: "utf8" });
  assert.equal(result.status, 0, String(result.stderr || result.stdout));
  return String(result.stdout).trim();
}

function sha256(text) {
  return createHash("sha256").update(text).digest("hex");
}

function main() {
  const root = mkdtempSync(path.join(tmpdir(), "browser67-upstream-lock-"));
  const extensionRoot = path.resolve(root, "assets", "tmwd_cdp_bridge");
  try {
    mkdirSync(extensionRoot, { recursive: true });
    run("git", ["init"], root);
    run("git", ["checkout", "-B", "main"], root);
    run("git", ["config", "user.email", "fixture@example.test"], root);
    run("git", ["config", "user.name", "Fixture"], root);
    run("git", ["remote", "add", "origin", "https://example.invalid/GenericAgent.git"], root);

    writeFileSync(path.resolve(extensionRoot, "background.js"), "base background\n");
    writeFileSync(path.resolve(extensionRoot, "content.js"), "base content\n");
    writeFileSync(path.resolve(extensionRoot, "config.js"), "ignored config\n");
    run("git", ["add", "assets"], root);
    run("git", ["commit", "-m", "base extension"], root);
    const baseCommit = run("git", ["rev-parse", "HEAD"], root);

    writeFileSync(path.resolve(extensionRoot, "content.js"), "new content\n");
    writeFileSync(path.resolve(extensionRoot, "popup.js"), "new popup\n");
    run("git", ["add", "assets"], root);
    run("git", ["commit", "-m", "new extension"], root);
    const latestCommit = run("git", ["rev-parse", "HEAD"], root);

    // Dirty working-tree bytes must not affect a commit-pinned provenance lock.
    writeFileSync(path.resolve(extensionRoot, "background.js"), "dirty background\n");

    const base = collectGitSnapshot(root, {
      commit: baseCommit,
      extensionSource: "assets/tmwd_cdp_bridge",
      ignoredFiles: ["config.js"],
    });
    assert.equal(base.upstream.commit, baseCommit);
    assert.equal(base.upstream.remote, "https://example.invalid/GenericAgent.git");
    assert.deepEqual(base.files, [
      { path: "background.js", sha256: sha256("base background\n") },
      { path: "content.js", sha256: sha256("base content\n") },
    ]);

    const latest = collectGitSnapshot(root, {
      commit: "HEAD",
      extensionSource: "assets/tmwd_cdp_bridge",
      ignoredFiles: ["config.js"],
    });
    assert.equal(latest.upstream.commit, latestCommit);
    assert.equal(latest.files.find((entry) => entry.path === "background.js")?.sha256, sha256("base background\n"));
    assert.equal(latest.files.find((entry) => entry.path === "content.js")?.sha256, sha256("new content\n"));
    assert.equal(latest.files.some((entry) => entry.path === "config.js"), false);

    process.stdout.write(`${JSON.stringify({
      ok: true,
      check: "upstream-lock-contract",
      scenarios: ["pinned-commit", "head-resolution", "dirty-worktree-isolation", "ignored-config"],
    })}\n`);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

try {
  main();
} catch (error) {
  process.stderr.write(`upstream-lock-contract failed: ${String(error?.stack ?? error)}\n`);
  process.exitCode = 1;
}
