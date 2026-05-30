#!/usr/bin/env node

import { createHash } from "node:crypto";
import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, "..");
const lockPath = resolve(repoRoot, "UPSTREAM.lock.json");
const genericAgentRoot = resolve(repoRoot, "..", "GenericAgent");
const extensionSource = resolve(genericAgentRoot, "assets/tmwd_cdp_bridge");
const ignoredExtensionFiles = new Set(["config.js"]);

function exec(command, args, cwd) {
  const result = spawnSync(command, args, {
    cwd,
    encoding: "utf8",
  });
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(" ")} failed: ${String(result.stderr || result.stdout).trim()}`);
  }
  return String(result.stdout ?? "").trim();
}

function parseArgs(argv) {
  const parsed = {
    write: false,
    check: false,
  };
  for (const token of argv) {
    if (token === "--write") {
      parsed.write = true;
      continue;
    }
    if (token === "--check") {
      parsed.check = true;
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

function usage() {
  return [
    "Usage: node scripts/upstream-lock.mjs --write|--check",
    "",
    "Writes or verifies GenericAgent extension provenance in UPSTREAM.lock.json.",
  ].join("\n");
}

function listFiles(rootDir) {
  const rows = [];
  function walk(currentDir) {
    for (const entry of readdirSync(currentDir, { withFileTypes: true })) {
      const absolute = resolve(currentDir, entry.name);
      const rel = relative(rootDir, absolute).replaceAll("\\", "/");
      if (entry.isDirectory()) {
        walk(absolute);
        continue;
      }
      if (entry.isFile() && !ignoredExtensionFiles.has(rel)) {
        rows.push(rel);
      }
    }
  }
  walk(rootDir);
  return rows.sort();
}

function sha256(path) {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function collectCurrent() {
  const files = listFiles(extensionSource).map((file) => ({
    path: file,
    sha256: sha256(resolve(extensionSource, file)),
  }));
  return {
    schema_version: 1,
    upstream: {
      name: "lsdefine/GenericAgent",
      remote: exec("git", ["remote", "get-url", "origin"], genericAgentRoot),
      commit: exec("git", ["rev-parse", "HEAD"], genericAgentRoot),
      extension_source: relative(genericAgentRoot, extensionSource).replaceAll("\\", "/"),
      ignored_files: [...ignoredExtensionFiles].sort(),
    },
    files,
  };
}

function stableStringify(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function run() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help || (!args.write && !args.check)) {
    process.stdout.write(`${usage()}\n`);
    return args.help ? 0 : 1;
  }
  const current = collectCurrent();
  if (args.write) {
    writeFileSync(lockPath, stableStringify(current), "utf8");
    process.stdout.write(`${JSON.stringify({ ok: true, written: lockPath, upstream: current.upstream, file_count: current.files.length })}\n`);
    return 0;
  }
  const expected = JSON.parse(readFileSync(lockPath, "utf8"));
  const ok = stableStringify(expected) === stableStringify(current);
  const payload = {
    ok,
    lock_path: lockPath,
    expected_upstream: expected.upstream,
    current_upstream: current.upstream,
    expected_file_count: Array.isArray(expected.files) ? expected.files.length : 0,
    current_file_count: current.files.length,
  };
  process.stdout.write(`${JSON.stringify(payload)}\n`);
  return ok ? 0 : 1;
}

try {
  process.exitCode = run();
} catch (error) {
  process.stderr.write(`upstream-lock failed: ${String(error?.message ?? error)}\n`);
  process.exitCode = 1;
}
