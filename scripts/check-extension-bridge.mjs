#!/usr/bin/env node

import { existsSync, readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

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
  process.stdout.write(`${JSON.stringify({ ok: true, checked: bridgeFiles })}\n`);
}

try {
  run();
} catch (error) {
  process.stderr.write(`check-extension-bridge failed: ${String(error?.message ?? error)}\n`);
  process.exitCode = 1;
}
