#!/usr/bin/env node

import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const setupScript = path.resolve(repoRoot, "scripts/setup-extension.mjs");
const legacyBrowserServerPath = path.resolve(repoRoot, "src/server.mjs");
const legacyJsReverseServerPath = path.resolve(repoRoot, "src/js-reverse-server.mjs");
const browserServerPath = path.resolve(repoRoot, "src/mcp/browser/server.mjs");
const jsReverseServerPath = path.resolve(repoRoot, "src/mcp/js-reverse/server.mjs");
const packageVersion = JSON.parse(await readFile(path.resolve(repoRoot, "package.json"), "utf8")).version;

function tomlString(value) {
  return JSON.stringify(String(value));
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function assertContainsTomlString(text, value) {
  assert.match(text, new RegExp(escapeRegExp(tomlString(value))));
}

function assertMissingTomlString(text, value) {
  assert.doesNotMatch(text, new RegExp(escapeRegExp(tomlString(value))));
}

async function runSetup({ targetDir, registryPath }) {
  const { stdout, stderr } = await execFileAsync(process.execPath, [
    setupScript,
    "--target",
    targetDir,
    "--registry",
    registryPath,
    "--json",
  ], {
    cwd: repoRoot,
    maxBuffer: 1024 * 1024,
  });
  assert.equal(stderr, "");
  return JSON.parse(stdout);
}

async function main() {
    const tmpDir = await mkdtemp(path.join(os.tmpdir(), "browser67-setup-contract-"));
  try {
    const targetDir = path.join(tmpDir, "browser", "tmwd_cdp_bridge");
    const registryPath = path.join(tmpDir, "mcp", "servers.toml");
    await mkdir(path.dirname(registryPath), { recursive: true });
    await writeFile(registryPath, [
      "",
      "# Standalone browser67 real-browser MCP server.",
      "[[servers]]",
      'name = "tmwd-browser-mcp"',
      'command = "node"',
      `args = [${tomlString(legacyBrowserServerPath)}]`,
      "enabled = true",
      "",
      "[servers.env]",
      'BROWSER_STRUCTURED_TMWD_MODE = "tmwd"',
      "",
      "# browser67-backed JavaScript reverse-engineering MCP server.",
      "[[servers]]",
      'name = "js-reverse"',
      'command = "node"',
      `args = [${tomlString(legacyJsReverseServerPath)}]`,
      "enabled = true",
      "",
      "[servers.env]",
      'BROWSER_STRUCTURED_TMWD_MODE = "tmwd"',
      "",
    ].join("\n"), "utf8");

    const first = await runSetup({ targetDir, registryPath });
    assert.equal(first.ok, true);
    assert.equal(first.product, "browser67");
    assert.equal(first.mcp_registry_changed, true);
    assert.equal(first.extension_build?.schema, "browser67.extension-build.v1");
    const installedManifest = JSON.parse(await readFile(path.join(targetDir, "manifest.json"), "utf8"));
    assert.equal(installedManifest.name, "browser67 TMWD Bridge");
    assert.equal(installedManifest.version, packageVersion);
    assert.deepEqual(installedManifest.content_scripts, []);
    assert.equal(installedManifest.permissions.includes("webRequest"), true);
    assert.match(await readFile(path.join(targetDir, "background.js"), "utf8"), /browser67HandleCommand/);
    assert.match(await readFile(path.join(targetDir, "browser67", "runtime.js"), "utf8"), /tabIds: \[tabId\]/);
    const buildIdentity = JSON.parse(await readFile(path.join(targetDir, "browser67", "build-identity.json"), "utf8"));
    assert.equal(buildIdentity.schema, "browser67.extension-identity.v1");
    assert.equal(buildIdentity.extension_version, packageVersion);
    assert.equal(buildIdentity.manifest_version, installedManifest.version);
    assert.match(buildIdentity.source_digest, /^[a-f0-9]{64}$/);
    assert.match(
      await readFile(path.join(targetDir, "browser67", "build-identity.js"), "utf8"),
      /globalThis\.__browser67BuildIdentity/,
    );
    assert.match(await readFile(path.join(targetDir, "config.js"), "utf8"), /globalThis\.__browser67TID/);

    const normalized = await readFile(registryPath, "utf8");
    assert.match(normalized, /name = "tmwd_browser"/);
    assert.doesNotMatch(normalized, /name = "tmwd-browser-mcp"/);
    assertContainsTomlString(normalized, browserServerPath);
    assertContainsTomlString(normalized, jsReverseServerPath);
    assertMissingTomlString(normalized, legacyBrowserServerPath);
    assertMissingTomlString(normalized, legacyJsReverseServerPath);

    await writeFile(path.join(targetDir, "config.js"), "const TID = '__legacy_tid_kept';\n", "utf8");
    const second = await runSetup({ targetDir, registryPath });
    assert.equal(second.ok, true);
    assert.equal(second.mcp_registry_changed, false);
    assert.equal(second.config_migrated, true);
    assert.equal(
      await readFile(path.join(targetDir, "config.js"), "utf8"),
      'globalThis.__browser67TID = "__legacy_tid_kept";\n',
    );
    assert.equal(await readFile(registryPath, "utf8"), normalized);

    process.stdout.write(JSON.stringify({
      ok: true,
      check: "setup-extension-contract",
      normalized_legacy_registry: true,
      idempotent: true,
      managed_overlay_built: true,
      extension_identity_built: true,
      legacy_config_migrated: true,
    }) + "\n");
  } finally {
    await rm(tmpDir, { recursive: true, force: true });
  }
}

main().catch((error) => {
  process.stderr.write(`setup-extension-contract failed: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
