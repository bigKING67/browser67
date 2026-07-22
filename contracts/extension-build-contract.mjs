#!/usr/bin/env node

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { buildExtension } from "../scripts/build-extension.mjs";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const sourceDir = resolve(repoRoot, "extension");

function hashFile(path) {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function run() {
  const tempRoot = mkdtempSync(resolve(tmpdir(), "browser67-extension-build-"));
  const targetDir = resolve(tempRoot, "extension");
  const sourceBackgroundPath = resolve(sourceDir, "background.js");
  const sourceManifestPath = resolve(sourceDir, "manifest.json");
  const before = {
    background: hashFile(sourceBackgroundPath),
    manifest: hashFile(sourceManifestPath),
  };
  try {
    const result = buildExtension({ source_dir: sourceDir, target_dir: targetDir });
    const manifest = JSON.parse(readFileSync(resolve(targetDir, "manifest.json"), "utf8"));
    const background = readFileSync(resolve(targetDir, "background.js"), "utf8");
    const runtime = readFileSync(resolve(targetDir, "browser67/runtime.js"), "utf8");
    assert.equal(result.schema, "browser67.extension-build.v1");
    assert.equal(manifest.name, "browser67 TMWD Bridge");
    assert.deepEqual(manifest.content_scripts, []);
    assert.equal(manifest.permissions.includes("webRequest"), true);
    assert.equal(manifest.permissions.includes("storage"), true);
    assert.match(background, /importScripts\('browser67\/runtime\.js'\)/);
    assert.match(background, /browser67HandleCommand/);
    assert.match(background, /const monitorNewTabs = data\.monitorNewTabs !== false/);
    assert.match(background, /monitorNewTabs && newTabIds\.size === 0/);
    assert.match(background, /if \(monitorNewTabs\) chrome\.tabs\.onCreated\.addListener/);
    assert.doesNotMatch(background, /id: 9999, priority: 1/);
    assert.match(runtime, /condition:\s*\{[\s\S]*tabIds:\s*\[tabId\]/);
    assert.match(runtime, /message\?\.cmd === "network"/);
    assert.match(runtime, /message\?\.cmd !== "policy"/);
    assert.match(runtime, /authorize_navigation/);
    assert.match(runtime, /last_navigation_actor/);
    assert.match(runtime, /data-browser67-node-id/);
    assert.equal(hashFile(sourceBackgroundPath), before.background);
    assert.equal(hashFile(sourceManifestPath), before.manifest);
    process.stdout.write(`${JSON.stringify({
      ok: true,
      check: "extension-build-contract",
      ordinary_tab_policy: result.ordinary_tab_policy,
      generated_background_changed: result.generated_background_sha256 !== result.upstream_background_sha256,
      generated_manifest_changed: result.generated_manifest_sha256 !== result.upstream_manifest_sha256,
      tab_scoped_csp: true,
      managed_dialog_badge_marker: true,
      managed_network_observer: true,
      managed_navigation_observer: true,
    })}\n`);
  } finally {
    rmSync(tempRoot, { recursive: true, force: true, maxRetries: 8, retryDelay: 125 });
  }
}

try {
  run();
} catch (error) {
  process.stderr.write(`extension-build-contract failed: ${error?.stack || String(error)}\n`);
  process.exitCode = 1;
}
