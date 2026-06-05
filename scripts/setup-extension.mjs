#!/usr/bin/env node

import { randomBytes } from "node:crypto";
import { appendFileSync, cpSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, "..");
const sourceDir = resolve(repoRoot, "extension");
const defaultHome = resolve(
  process.env.TMWD_BROWSER_MCP_HOME
    || process.env.TMWD_HOME
    || `${process.env.HOME || process.cwd()}/.tmwd-browser-mcp`,
);
const defaultTargetDir = resolve(defaultHome, "browser/tmwd_cdp_bridge");
const defaultMcpRegistryPath = resolve(defaultHome, "mcp/servers.toml");
const browserServerPath = resolve(repoRoot, "src/server.mjs");
const jsReverseServerPath = resolve(repoRoot, "src/js-reverse-server.mjs");

function parseArgs(argv) {
  const parsed = {
    targetDir: defaultTargetDir,
    registryPath: defaultMcpRegistryPath,
    json: false,
    forceConfig: false,
    skipRegistry: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index] ?? "";
    if (token === "--json") {
      parsed.json = true;
      continue;
    }
    if (token === "--force-config") {
      parsed.forceConfig = true;
      continue;
    }
    if (token === "--skip-registry") {
      parsed.skipRegistry = true;
      continue;
    }
    if (token === "--target") {
      parsed.targetDir = resolve(requiredValue(argv, index, token));
      index += 1;
      continue;
    }
    if (token === "--registry") {
      parsed.registryPath = resolve(requiredValue(argv, index, token));
      index += 1;
      continue;
    }
    if (token === "--help" || token === "-h") {
      parsed.help = true;
      continue;
    }
    throw new Error(`unknown argument: ${token}`);
  }
  return parsed;
}

function requiredValue(argv, index, token) {
  const value = String(argv[index + 1] ?? "").trim();
  if (!value || value.startsWith("--")) {
    throw new Error(`missing ${token} value`);
  }
  return value;
}

function usage() {
  return [
    "Usage: node scripts/setup-extension.mjs [--target <dir>] [--registry <path>] [--force-config] [--skip-registry] [--json]",
    "",
    "Copies extension/ into a stable unpacked-extension directory and writes config.js.",
  ].join("\n");
}

function makeTid() {
  return `__tmwd_browser_mcp_${randomBytes(6).toString("hex")}`;
}

function tomlString(value) {
  return JSON.stringify(String(value));
}

function ensureMcpRegistry(registryPath) {
  mkdirSync(dirname(registryPath), { recursive: true });
  const current = existsSync(registryPath) ? readFileSync(registryPath, "utf8") : "";
  const blocks = [];
  if (!/^\s*name\s*=\s*["']tmwd-browser-mcp["']/m.test(current)) {
    blocks.push([
      "",
      "# Standalone TMWD browser MCP server.",
      "[[servers]]",
      "name = \"tmwd-browser-mcp\"",
      "command = \"node\"",
      `args = [${tomlString(browserServerPath)}]`,
      "enabled = true",
      "",
      "[servers.env]",
      "BROWSER_STRUCTURED_TMWD_MODE = \"tmwd\"",
      "BROWSER_STRUCTURED_TMWD_TRANSPORT = \"auto\"",
      "BROWSER_STRUCTURED_TMWD_WS_ENDPOINT = \"ws://127.0.0.1:18765\"",
      "BROWSER_STRUCTURED_TMWD_LINK_ENDPOINT = \"http://127.0.0.1:18766/link\"",
      "",
    ].join("\n"));
  }
  if (!/^\s*name\s*=\s*["']js-reverse["']/m.test(current)) {
    blocks.push([
      "",
      "# TMWD-backed JavaScript reverse-engineering MCP server.",
      "[[servers]]",
      "name = \"js-reverse\"",
      "command = \"node\"",
      `args = [${tomlString(jsReverseServerPath)}]`,
      "enabled = true",
      "",
      "[servers.env]",
      "BROWSER_STRUCTURED_TMWD_MODE = \"tmwd\"",
      "BROWSER_STRUCTURED_TMWD_TRANSPORT = \"auto\"",
      "BROWSER_STRUCTURED_TMWD_WS_ENDPOINT = \"ws://127.0.0.1:18765\"",
      "BROWSER_STRUCTURED_TMWD_LINK_ENDPOINT = \"http://127.0.0.1:18766/link\"",
      "",
    ].join("\n"));
  }
  if (blocks.length === 0) {
    return { path: registryPath, changed: false };
  }
  appendFileSync(registryPath, blocks.join(""), "utf8");
  return { path: registryPath, changed: true };
}

function run() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    process.stdout.write(`${usage()}\n`);
    return 0;
  }
  if (!existsSync(sourceDir)) {
    throw new Error(`missing extension source: ${sourceDir}`);
  }
  mkdirSync(args.targetDir, { recursive: true });
  cpSync(sourceDir, args.targetDir, {
    recursive: true,
    force: true,
    errorOnExist: false,
  });
  const configPath = resolve(args.targetDir, "config.js");
  const configExists = existsSync(configPath);
  if (!configExists || args.forceConfig) {
    writeFileSync(configPath, `const TID = '${makeTid()}';\n`, "utf8");
  }
  const registry = args.skipRegistry
    ? { path: args.registryPath, changed: false, skipped: true }
    : ensureMcpRegistry(args.registryPath);
  const payload = {
    ok: true,
    extension_dir: args.targetDir,
    config_path: configPath,
    config_created: !configExists || args.forceConfig,
    mcp_registry_path: registry.path,
    mcp_registry_changed: registry.changed,
    mcp_registry_skipped: registry.skipped === true,
    next_steps: [
      "Open chrome://extensions or edge://extensions",
      "Enable Developer mode",
      `Load unpacked extension from: ${args.targetDir}`,
      "Reload TMWD CDP Bridge after every extension source update",
      "Run: npm run hub:start",
      "Run: npm run doctor",
    ],
  };
  if (args.json) {
    process.stdout.write(`${JSON.stringify(payload)}\n`);
    return 0;
  }
  process.stdout.write(`Extension prepared: ${payload.extension_dir}\n`);
  process.stdout.write(`Config: ${payload.config_path}${payload.config_created ? " (created)" : " (kept)"}\n`);
  process.stdout.write(`MCP registry: ${payload.mcp_registry_path}${payload.mcp_registry_changed ? " (updated)" : " (unchanged)"}\n`);
  process.stdout.write("Next:\n");
  for (const item of payload.next_steps) {
    process.stdout.write(`  - ${item}\n`);
  }
  return 0;
}

try {
  process.exitCode = run();
} catch (error) {
  process.stderr.write(`setup-extension failed: ${String(error?.message ?? error)}\n`);
  process.exitCode = 1;
}
