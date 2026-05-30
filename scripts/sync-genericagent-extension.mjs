#!/usr/bin/env node

import { createHash } from "node:crypto";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
} from "node:fs";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, "..");
const defaultSourceDir = resolve(
  repoRoot,
  "..",
  "GenericAgent",
  "assets",
  "tmwd_cdp_bridge",
);
const targetDir = resolve(repoRoot, "extension");
const managedExtraFiles = new Set(["config.example.js"]);
const ignoredFiles = new Set(["config.js"]);

function parseArgs(argv) {
  const parsed = {
    sourceDir: defaultSourceDir,
    check: false,
    json: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const token = String(argv[index] ?? "");
    if (token === "--source") {
      const value = String(argv[index + 1] ?? "").trim();
      if (!value || value.startsWith("--")) {
        throw new Error("missing --source value");
      }
      parsed.sourceDir = resolve(value);
      index += 1;
      continue;
    }
    if (token === "--check") {
      parsed.check = true;
      continue;
    }
    if (token === "--json") {
      parsed.json = true;
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
    "Usage: node scripts/sync-genericagent-extension.mjs [--source <dir>] [--check] [--json]",
    "",
    "Synchronizes GenericAgent assets/tmwd_cdp_bridge into extension/.",
    "config.js is intentionally ignored because setup-extension writes a runtime TID.",
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
      if (!entry.isFile()) {
        continue;
      }
      if (ignoredFiles.has(rel)) {
        continue;
      }
      rows.push(rel);
    }
  }
  walk(rootDir);
  return rows.sort();
}

function hashFile(path) {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function compare(sourceDir) {
  if (!existsSync(sourceDir) || !statSync(sourceDir).isDirectory()) {
    throw new Error(`missing GenericAgent extension source: ${sourceDir}`);
  }
  if (!existsSync(targetDir) || !statSync(targetDir).isDirectory()) {
    throw new Error(`missing extension target: ${targetDir}`);
  }
  const sourceFiles = listFiles(sourceDir);
  const targetFiles = listFiles(targetDir).filter((file) => !managedExtraFiles.has(file));
  const sourceSet = new Set(sourceFiles);
  const targetSet = new Set(targetFiles);
  const added = sourceFiles.filter((file) => !targetSet.has(file));
  const removed = targetFiles.filter((file) => !sourceSet.has(file));
  const changed = sourceFiles.filter((file) => (
    targetSet.has(file)
    && hashFile(resolve(sourceDir, file)) !== hashFile(resolve(targetDir, file))
  ));
  return {
    ok: added.length === 0 && removed.length === 0 && changed.length === 0,
    source_dir: sourceDir,
    target_dir: targetDir,
    added,
    removed,
    changed,
    ignored: [...ignoredFiles].sort(),
    managed_extra: [...managedExtraFiles].sort(),
  };
}

function sync(sourceDir, diff) {
  for (const file of [...diff.added, ...diff.changed]) {
    const sourcePath = resolve(sourceDir, file);
    const targetPath = resolve(targetDir, file);
    mkdirSync(dirname(targetPath), { recursive: true });
    copyFileSync(sourcePath, targetPath);
  }
  for (const file of diff.removed) {
    rmSync(resolve(targetDir, file), { force: true });
  }
}

function writeResult(payload, json) {
  if (json) {
    process.stdout.write(`${JSON.stringify(payload)}\n`);
    return;
  }
  process.stdout.write(`GenericAgent extension source: ${payload.source_dir}\n`);
  process.stdout.write(`Target extension dir: ${payload.target_dir}\n`);
  process.stdout.write(`Status: ${payload.ok ? "aligned" : "drifted"}\n`);
  if (payload.added.length > 0) process.stdout.write(`Added upstream files: ${payload.added.join(", ")}\n`);
  if (payload.changed.length > 0) process.stdout.write(`Changed files: ${payload.changed.join(", ")}\n`);
  if (payload.removed.length > 0) process.stdout.write(`Removed stale files: ${payload.removed.join(", ")}\n`);
  if (payload.synced === true) process.stdout.write("Synchronized extension files.\n");
}

function run() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    process.stdout.write(`${usage()}\n`);
    return 0;
  }
  const before = compare(args.sourceDir);
  if (args.check) {
    writeResult(before, args.json);
    return before.ok ? 0 : 1;
  }
  if (!before.ok) {
    sync(args.sourceDir, before);
  }
  const after = compare(args.sourceDir);
  const payload = {
    ...after,
    synced: !before.ok,
    before,
  };
  writeResult(payload, args.json);
  return after.ok ? 0 : 1;
}

try {
  process.exitCode = run();
} catch (error) {
  process.stderr.write(`sync-genericagent-extension failed: ${String(error?.message ?? error)}\n`);
  process.exitCode = 1;
}
