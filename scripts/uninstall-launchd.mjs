#!/usr/bin/env node

import { rmSync } from "node:fs";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";

const home = process.env.HOME || process.cwd();
const label = "com.browser67.tmwd-browser-mcp";
const plistPath = resolve(home, "Library/LaunchAgents", `${label}.plist`);
const userTarget = `gui/${process.getuid?.() ?? ""}`;

function runCommand(command, args, allowFailure = false) {
  const result = spawnSync(command, args, {
    encoding: "utf8",
  });
  if (!allowFailure && result.status !== 0) {
    throw new Error(`${command} ${args.join(" ")} failed: ${String(result.stderr || result.stdout).trim()}`);
  }
  return result;
}

function run() {
  runCommand("launchctl", ["bootout", userTarget, plistPath], true);
  rmSync(plistPath, { force: true });
  process.stdout.write(`${JSON.stringify({ ok: true, removed: plistPath, label })}\n`);
  return 0;
}

try {
  process.exitCode = run();
} catch (error) {
  process.stderr.write(`uninstall-launchd failed: ${String(error?.message ?? error)}\n`);
  process.exitCode = 1;
}
