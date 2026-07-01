#!/usr/bin/env node

import { rmSync } from "node:fs";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";

const home = process.env.HOME || process.cwd();
const canonicalLabel = "com.browser67.tmwd-hub";
const legacyLabels = [
  "com.browser67.tmwd-browser-mcp",
  "com.gaoqian.tmwd-browser-mcp",
];
const userTarget = `gui/${process.getuid?.() ?? ""}`;

function parseArgs(argv = []) {
  const parsed = {
    legacy: false,
    all: false,
  };
  for (const token of argv) {
    if (token === "--legacy") {
      parsed.legacy = true;
      continue;
    }
    if (token === "--all") {
      parsed.all = true;
      continue;
    }
    if (!token) {
      continue;
    }
    throw new Error(`unknown argument: ${token}`);
  }
  return parsed;
}

function runCommand(command, args, allowFailure = false) {
  const result = spawnSync(command, args, {
    encoding: "utf8",
  });
  if (!allowFailure && result.status !== 0) {
    throw new Error(`${command} ${args.join(" ")} failed: ${String(result.stderr || result.stdout).trim()}`);
  }
  return result;
}

function plistPathFor(label) {
  return resolve(home, "Library/LaunchAgents", `${label}.plist`);
}

function removeLabel(label) {
  const plistPath = plistPathFor(label);
  runCommand("launchctl", ["bootout", userTarget, plistPath], true);
  rmSync(plistPath, { force: true });
  return { label, plist_path: plistPath };
}

function run() {
  const args = parseArgs(process.argv.slice(2));
  const labels = args.all
    ? [canonicalLabel, ...legacyLabels]
    : [args.legacy ? legacyLabels : [canonicalLabel]].flat();
  const removed = labels.map(removeLabel);
  process.stdout.write(`${JSON.stringify({ ok: true, removed })}\n`);
  return 0;
}

try {
  process.exitCode = run();
} catch (error) {
  process.stderr.write(`uninstall-launchd failed: ${String(error?.message ?? error)}\n`);
  process.exitCode = 1;
}
