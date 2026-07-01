import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  browser67DefaultHomePath,
  legacyTmwdBrowserMcpHomePath,
  resolveBrowser67Home,
} from "../src/runtime/paths/home.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function fakeExists(paths = []) {
  const set = new Set(paths.map((entry) => path.resolve(entry)));
  return (candidate) => set.has(path.resolve(candidate));
}

function assertResolverContract() {
  const homeDir = path.join(tmpdir(), "browser67-home-contract-home");
  const canonical = path.join(homeDir, ".browser67");
  const legacy = path.join(homeDir, ".tmwd-browser-mcp");

  assert.equal(browser67DefaultHomePath({ env: {}, homeDir }), canonical);
  assert.equal(legacyTmwdBrowserMcpHomePath({ env: {}, homeDir }), legacy);

  assert.deepEqual(resolveBrowser67Home({
    env: { BROWSER67_HOME: "~/custom-browser67" },
    homeDir,
    exists: fakeExists(),
  }).source, "BROWSER67_HOME");

  const legacyEnv = resolveBrowser67Home({
    env: { TMWD_BROWSER_MCP_HOME: "~/legacy-browser" },
    homeDir,
    exists: fakeExists(),
  });
  assert.equal(legacyEnv.source, "TMWD_BROWSER_MCP_HOME");
  assert.equal(legacyEnv.legacy, true);

  const canonicalExisting = resolveBrowser67Home({
    env: {},
    homeDir,
    exists: fakeExists([canonical, legacy]),
  });
  assert.equal(canonicalExisting.path, canonical);
  assert.equal(canonicalExisting.source, "default_existing_browser67");

  const legacyExisting = resolveBrowser67Home({
    env: {},
    homeDir,
    exists: fakeExists([legacy]),
  });
  assert.equal(legacyExisting.path, legacy);
  assert.equal(legacyExisting.source, "legacy_existing_tmwd_browser_mcp");

  const fresh = resolveBrowser67Home({
    env: {},
    homeDir,
    exists: fakeExists(),
  });
  assert.equal(fresh.path, canonical);
  assert.equal(fresh.source, "default_browser67");
}

function assertMigrationScriptContract() {
  const root = mkdtempSync(path.join(tmpdir(), "browser67-migrate-contract-"));
  const source = path.join(root, "legacy");
  const target = path.join(root, "browser67");
  const runtimeFile = path.join(source, "runtime", "sample.txt");
  mkdirSync(path.dirname(runtimeFile), { recursive: true });
  writeFileSync(runtimeFile, "ok\n", { encoding: "utf8", flag: "w" });

  const dryRun = spawnSync(process.execPath, [
    path.join(repoRoot, "scripts/migrate-home.mjs"),
    "--source", source,
    "--target", target,
    "--json",
  ], {
    cwd: repoRoot,
    encoding: "utf8",
  });
  assert.equal(dryRun.status, 0, dryRun.stderr);
  const dryPayload = JSON.parse(dryRun.stdout);
  assert.equal(dryPayload.mode, "dry_run");
  assert.equal(dryPayload.entries.some((entry) => entry.name === "runtime" && entry.action === "copy"), true);

  const writeRun = spawnSync(process.execPath, [
    path.join(repoRoot, "scripts/migrate-home.mjs"),
    "--source", source,
    "--target", target,
    "--write",
    "--json",
  ], {
    cwd: repoRoot,
    encoding: "utf8",
  });
  assert.equal(writeRun.status, 0, writeRun.stderr);
  const writePayload = JSON.parse(writeRun.stdout);
  assert.equal(writePayload.mode, "write");
  assert.equal(writePayload.legacy_left_in_place, true);
  assert.equal(writePayload.entries.some((entry) => entry.name === "runtime" && entry.action === "copied"), true);
  rmSync(root, { recursive: true, force: true });
}

function run() {
  assertResolverContract();
  assertMigrationScriptContract();
  process.stdout.write(`${JSON.stringify({ ok: true, contract: "runtime-home" })}\n`);
}

try {
  run();
} catch (error) {
  process.stderr.write(`runtime-home-contract failed: ${String(error?.message ?? error)}\n`);
  process.exitCode = 1;
}
