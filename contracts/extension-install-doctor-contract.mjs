#!/usr/bin/env node

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";

const repoRoot = path.resolve(import.meta.dirname, "..");
const doctorScript = path.resolve(repoRoot, "scripts/extension-install-doctor.mjs");

function writeFixtureSource(sourceDir) {
  mkdirSync(path.resolve(sourceDir, "content"), { recursive: true });
  writeFileSync(path.resolve(sourceDir, "manifest.json"), JSON.stringify({
    manifest_version: 3,
    name: "browser67 fixture bridge",
    version: "0.0.0",
  }, null, 2), "utf8");
  writeFileSync(path.resolve(sourceDir, "background.js"), "globalThis.fixtureBridge = true;\n", "utf8");
  writeFileSync(path.resolve(sourceDir, "content", "bridge.js"), "globalThis.fixtureContent = true;\n", "utf8");
  writeFileSync(path.resolve(sourceDir, "config.example.js"), "const TID = '__browser67_fixture';\n", "utf8");
}

function run(args, expectedStatus = 0) {
  const result = spawnSync(process.execPath, [doctorScript, ...args], {
    cwd: repoRoot,
    encoding: "utf8",
    timeout: 30_000,
  });
  if (result.status !== expectedStatus) {
    throw new Error(`extension doctor ${args.join(" ")} failed status=${result.status}: ${String(result.stderr || result.stdout).trim()}`);
  }
  return JSON.parse(String(result.stdout ?? "").trim());
}

function main() {
  const tempRoot = mkdtempSync(path.join(os.tmpdir(), "browser67-extension-doctor-"));
  try {
    const sourceDir = path.resolve(tempRoot, "source");
    const targetDir = path.resolve(tempRoot, "target");
    writeFixtureSource(sourceDir);

    const missing = run(["--source", sourceDir, "--target", targetDir, "--json"]);
    assert.equal(missing.ok, false);
    assert.equal(missing.target_status, "missing");
    assert.equal(missing.needs_setup, true);
    assert.equal(missing.needs_browser_extension_reload, true);
    assert.deepEqual(missing.missing.sort(), ["background.js", "config.example.js", "content/bridge.js", "manifest.json"].sort());

    const missingCheck = spawnSync(process.execPath, [
      doctorScript,
      "--source",
      sourceDir,
      "--target",
      targetDir,
      "--json",
      "--check",
    ], {
      cwd: repoRoot,
      encoding: "utf8",
      timeout: 30_000,
    });
    assert.notEqual(missingCheck.status, 0);

    cpSync(sourceDir, targetDir, { recursive: true });
    writeFileSync(path.resolve(targetDir, "config.js"), "const TID = '__install_local';\n", "utf8");
    writeFileSync(path.resolve(targetDir, ".DS_Store"), "ignored\n", "utf8");

    const current = run(["--source", sourceDir, "--target", targetDir, "--json", "--check"]);
    assert.equal(current.ok, true);
    assert.equal(current.installed_current, true);
    assert.equal(current.needs_setup, false);
    assert.deepEqual(current.ignored_target_files.sort(), [".DS_Store", "config.js"].sort());

    writeFileSync(path.resolve(targetDir, "background.js"), "globalThis.fixtureBridge = 'changed';\n", "utf8");
    rmSync(path.resolve(targetDir, "content", "bridge.js"));
    writeFileSync(path.resolve(targetDir, "stale.js"), "globalThis.stale = true;\n", "utf8");

    const drift = run(["--source", sourceDir, "--target", targetDir, "--json"]);
    assert.equal(drift.ok, false);
    assert.equal(drift.installed_current, false);
    assert.equal(drift.needs_setup, true);
    assert.equal(drift.needs_clean_setup, true);
    assert.deepEqual(drift.missing, ["content/bridge.js"]);
    assert.deepEqual(drift.changed.map((item) => item.file), ["background.js"]);
    assert.deepEqual(drift.extra, ["stale.js"]);

    process.stdout.write(`${JSON.stringify({
      ok: true,
      check: "extension-install-doctor-contract",
      scenarios: ["missing-target", "current-ignores-generated-config", "drift-detects-missing-changed-extra"],
    })}\n`);
  } finally {
    if (existsSync(tempRoot)) rmSync(tempRoot, { recursive: true, force: true });
  }
}

try {
  main();
} catch (error) {
  process.stderr.write(`extension-install-doctor-contract failed: ${String(error?.message ?? error)}\n`);
  process.exitCode = 1;
}
