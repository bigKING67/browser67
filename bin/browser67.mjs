#!/usr/bin/env node

import { spawn } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, "..");

const COMMANDS = new Map([
  ["server", ["src/mcp/browser/server.mjs"]],
  ["setup", ["scripts/setup-extension.mjs"]],
  ["migrate-home", ["scripts/migrate-home.mjs"]],
  ["doctor", ["contracts/browser67-live-gate.mjs", "--doctor-only", "--tmwd-mode", "tmwd"]],
  ["live-gate", ["contracts/browser67-live-gate.mjs", "--tmwd-mode", "tmwd"]],
  ["native-doctor", ["src/native-deps-setup.mjs"]],
  ["native-setup", ["src/native-deps-setup.mjs", "--install", "--yes"]],
]);

function usage() {
  return [
    "Usage: browser67 <command> [...args]",
    "",
    "Commands:",
    "  server                 Run browser67 tmwd_browser MCP server over stdio",
    "  setup                  Copy unpacked extension to the active browser67 home",
    "  migrate-home           Copy legacy ~/.tmwd-browser-mcp runtime state to ~/.browser67",
    "  doctor                 Run machine-readable readiness doctor",
    "  live-gate              Run live browser gate",
    "  hub start|status|stop   Manage TMWD hub",
    "  native-doctor          Check native input dependencies",
    "  native-setup           Install native input dependencies where supported",
  ].join("\n");
}

function runNode(scriptParts, extraArgs) {
  const [script, ...fixedArgs] = scriptParts;
  const child = spawn("node", [resolve(repoRoot, script), ...fixedArgs, ...extraArgs], {
    cwd: repoRoot,
    env: process.env,
    stdio: "inherit",
  });
  child.on("exit", (code, signal) => {
    if (signal) {
      process.kill(process.pid, signal);
      return;
    }
    process.exitCode = Number.isFinite(Number(code)) ? Number(code) : 1;
  });
}

function main(argv) {
  const command = String(argv[0] ?? "").trim();
  if (!command || command === "--help" || command === "-h") {
    process.stdout.write(`${usage()}\n`);
    return;
  }
  if (command === "hub") {
    const action = String(argv[1] ?? "").trim();
    if (!["start", "status", "stop"].includes(action)) {
      throw new Error("hub command requires start|status|stop");
    }
    runNode(["src/tmwd-hub-control.mjs", action], argv.slice(2));
    return;
  }
  const mapped = COMMANDS.get(command);
  if (!mapped) {
    throw new Error(`unknown command: ${command}`);
  }
  runNode(mapped, argv.slice(1));
}

try {
  main(process.argv.slice(2));
} catch (error) {
  process.stderr.write(`${String(error?.message ?? error)}\n\n${usage()}\n`);
  process.exitCode = 1;
}
