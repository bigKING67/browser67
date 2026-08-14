#!/usr/bin/env node

import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, "..");
const lockPath = resolve(repoRoot, "UPSTREAM.lock.json");
const genericAgentRoot = resolve(repoRoot, "..", "GenericAgent");
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

function execBuffer(command, args, cwd) {
  const result = spawnSync(command, args, { cwd, encoding: null });
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(" ")} failed: ${String(result.stderr || result.stdout).trim()}`);
  }
  return result.stdout;
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

export function collectGitSnapshot(root, options = {}) {
  const commit = String(options.commit ?? "HEAD");
  const source = String(options.extensionSource ?? "assets/tmwd_cdp_bridge").replace(/^\/+|\/+$/g, "");
  const ignored = new Set(options.ignoredFiles ?? [...ignoredExtensionFiles]);
  const resolvedCommit = exec("git", ["rev-parse", `${commit}^{commit}`], root);
  const prefix = `${source}/`;
  const files = exec("git", ["ls-tree", "-r", "--name-only", resolvedCommit, "--", source], root)
    .split(/\r?\n/)
    .filter((file) => file.startsWith(prefix))
    .map((file) => file.slice(prefix.length))
    .filter((file) => !ignored.has(file))
    .sort()
    .map((file) => ({
      path: file,
      sha256: createHash("sha256")
        .update(execBuffer("git", ["show", `${resolvedCommit}:${source}/${file}`], root))
        .digest("hex"),
    }));
  if (files.length === 0) {
    throw new Error(`no extension files found at ${resolvedCommit}:${source}`);
  }
  return {
    schema_version: 1,
    upstream: {
      name: "lsdefine/GenericAgent",
      remote: exec("git", ["remote", "get-url", "origin"], root),
      commit: resolvedCommit,
      extension_source: source,
      ignored_files: [...ignored].sort(),
    },
    files,
  };
}

function collectCurrent() {
  return collectGitSnapshot(genericAgentRoot, {
    commit: "HEAD",
    extensionSource: "assets/tmwd_cdp_bridge",
    ignoredFiles: [...ignoredExtensionFiles],
  });
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
  if (args.write) {
    const current = collectCurrent();
    writeFileSync(lockPath, stableStringify(current), "utf8");
    process.stdout.write(`${JSON.stringify({ ok: true, written: lockPath, upstream: current.upstream, file_count: current.files.length })}\n`);
    return 0;
  }
  const expected = JSON.parse(readFileSync(lockPath, "utf8"));
  const current = collectGitSnapshot(genericAgentRoot, {
    commit: expected?.upstream?.commit,
    extensionSource: expected?.upstream?.extension_source,
    ignoredFiles: expected?.upstream?.ignored_files,
  });
  const ok = stableStringify(expected) === stableStringify(current);
  const payload = {
    ok,
    lock_path: lockPath,
    expected_upstream: expected.upstream,
    current_upstream: current.upstream,
    expected_file_count: Array.isArray(expected.files) ? expected.files.length : 0,
    current_file_count: current.files.length,
    check_basis: "locked_git_object",
  };
  process.stdout.write(`${JSON.stringify(payload)}\n`);
  return ok ? 0 : 1;
}

if (resolve(process.argv[1] ?? "") === fileURLToPath(import.meta.url)) {
  try {
    process.exitCode = run();
  } catch (error) {
    process.stderr.write(`upstream-lock failed: ${String(error?.message ?? error)}\n`);
    process.exitCode = 1;
  }
}
