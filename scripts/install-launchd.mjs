#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { resolveBrowser67Home } from "../src/runtime/paths/home.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, "..");
const home = process.env.HOME || process.cwd();
const homeResolution = resolveBrowser67Home();
const runtimeHome = homeResolution.path;
const launchAgentsDir = resolve(home, "Library/LaunchAgents");
const label = "com.browser67.tmwd-hub";
const legacyLabel = "com.browser67.tmwd-browser-mcp";
const plistPath = resolve(launchAgentsDir, `${label}.plist`);
const legacyPlistPath = resolve(launchAgentsDir, `${legacyLabel}.plist`);
const userTarget = `gui/${process.getuid?.() ?? ""}`;

function xmlEscape(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function runCommand(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: repoRoot,
    env: process.env,
    encoding: "utf8",
  });
  if (options.allowFailure !== true && result.status !== 0) {
    throw new Error(`${command} ${args.join(" ")} failed: ${String(result.stderr || result.stdout).trim()}`);
  }
  return result;
}

function plist() {
  const stdoutPath = resolve(runtimeHome, "runtime/launchd.out.log");
  const stderrPath = resolve(runtimeHome, "runtime/launchd.err.log");
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${xmlEscape(label)}</string>
  <key>ProgramArguments</key>
  <array>
    <string>${xmlEscape(process.execPath)}</string>
    <string>${xmlEscape(resolve(repoRoot, "src/tmwd-hub.mjs"))}</string>
  </array>
  <key>WorkingDirectory</key>
  <string>${xmlEscape(repoRoot)}</string>
  <key>EnvironmentVariables</key>
  <dict>
    <key>BROWSER67_HOME</key>
    <string>${xmlEscape(runtimeHome)}</string>
    <key>TMWD_BROWSER_MCP_HOME</key>
    <string>${xmlEscape(runtimeHome)}</string>
  </dict>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>StandardOutPath</key>
  <string>${xmlEscape(stdoutPath)}</string>
  <key>StandardErrorPath</key>
  <string>${xmlEscape(stderrPath)}</string>
</dict>
</plist>
`;
}

function run() {
  mkdirSync(resolve(runtimeHome, "runtime"), { recursive: true });
  mkdirSync(launchAgentsDir, { recursive: true });
  writeFileSync(plistPath, plist(), "utf8");

  runCommand(process.execPath, [
    resolve(repoRoot, "src/tmwd-hub-control.mjs"),
    "stop",
    "--json",
    "--wait-ms", "3000",
  ], { allowFailure: true });
  if (existsSync(plistPath)) {
    runCommand("launchctl", ["bootout", userTarget, plistPath], { allowFailure: true });
  }
  if (existsSync(legacyPlistPath)) {
    runCommand("launchctl", ["bootout", userTarget, legacyPlistPath], { allowFailure: true });
  }
  runCommand("launchctl", ["bootstrap", userTarget, plistPath]);
  runCommand("launchctl", ["kickstart", "-k", `${userTarget}/${label}`], { allowFailure: true });

  process.stdout.write(`${JSON.stringify({
    ok: true,
    label,
    legacy_label: legacyLabel,
    plist_path: plistPath,
    runtime_home: runtimeHome,
    runtime_home_source: homeResolution.source,
    node: process.execPath,
  })}\n`);
  return 0;
}

try {
  process.exitCode = run();
} catch (error) {
  process.stderr.write(`install-launchd failed: ${String(error?.message ?? error)}\n`);
  process.exitCode = 1;
}
