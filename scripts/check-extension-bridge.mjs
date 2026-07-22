#!/usr/bin/env node

import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
} from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { buildExtension } from "./build-extension.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, "..");
const candidateBridgeFiles = [
  "extension/background.js",
  "runtime/chrome-extension/tmwd_cdp_bridge/background.js",
];

function assertContains(source, needle, file) {
  if (!source.includes(needle)) {
    throw new Error(`${file} missing required bridge fragment: ${needle}`);
  }
}

function checkSyntax(file) {
  const result = spawnSync(process.execPath, ["--check", file], {
    cwd: repoRoot,
    encoding: "utf8",
  });
  if (result.status !== 0) {
    throw new Error(`${file} syntax check failed: ${String(result.stderr || result.stdout).trim()}`);
  }
}

function run() {
  const bridgeFiles = candidateBridgeFiles.filter((relativeFile) => (
    relativeFile === "extension/background.js" || existsSync(resolve(repoRoot, relativeFile))
  ));
  for (const relativeFile of bridgeFiles) {
    const absoluteFile = resolve(repoRoot, relativeFile);
    const source = readFileSync(absoluteFile, "utf8");
    checkSyntax(relativeFile);
    assertContains(source, "async function handleTabs(msg)", relativeFile);
    assertContains(source, "method === 'close'", relativeFile);
    assertContains(source, "chrome.tabs.remove(tabId)", relativeFile);
    assertContains(source, "method === 'get'", relativeFile);
    assertContains(source, "chrome.tabs.get", relativeFile);
    assertContains(source, "includeUnscriptable", relativeFile);
    assertContains(source, "unsupported tabs method", relativeFile);
    assertContains(source, "R.push(await handleTabs(c))", relativeFile);
  }
  for (const relativeFile of [
    "extension/browser67/runtime.js",
    "extension/browser67/managed-content.js",
  ]) {
    checkSyntax(relativeFile);
  }
  const tempRoot = mkdtempSync(resolve(tmpdir(), "browser67-extension-check-"));
  try {
    const generatedDir = resolve(tempRoot, "extension");
    buildExtension({ source_dir: resolve(repoRoot, "extension"), target_dir: generatedDir });
    checkSyntax(resolve(generatedDir, "background.js"));
    const generatedBackground = readFileSync(resolve(generatedDir, "background.js"), "utf8");
    const generatedManifest = JSON.parse(readFileSync(resolve(generatedDir, "manifest.json"), "utf8"));
    assertContains(generatedBackground, "browser67HandleCommand", "generated/background.js");
    if (/id: 9999, priority: 1/.test(generatedBackground)) {
      throw new Error("generated/background.js retained the upstream global CSP rule");
    }
    if (!Array.isArray(generatedManifest.content_scripts) || generatedManifest.content_scripts.length !== 0) {
      throw new Error("generated/manifest.json must keep ordinary tabs free of content scripts");
    }
  } finally {
    rmSync(tempRoot, { recursive: true, force: true, maxRetries: 8, retryDelay: 125 });
  }
  process.stdout.write(`${JSON.stringify({
    ok: true,
    checked: bridgeFiles,
    overlay_checked: true,
    generated_checked: true,
  })}\n`);
}

try {
  run();
} catch (error) {
  process.stderr.write(`check-extension-bridge failed: ${String(error?.message ?? error)}\n`);
  process.exitCode = 1;
}
