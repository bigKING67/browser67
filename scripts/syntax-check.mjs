#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { readdirSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, "..");
const ignoredDirs = new Set([".git", "node_modules"]);

function listMjsFiles(rootDir) {
  const rows = [];
  function walk(currentDir) {
    for (const entry of readdirSync(currentDir, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        if (!ignoredDirs.has(entry.name)) {
          walk(resolve(currentDir, entry.name));
        }
        continue;
      }
      if (entry.isFile() && entry.name.endsWith(".mjs")) {
        rows.push(resolve(currentDir, entry.name));
      }
    }
  }
  walk(rootDir);
  return rows.sort();
}

function run() {
  const files = listMjsFiles(repoRoot);
  const failures = [];
  for (const file of files) {
    const result = spawnSync(process.execPath, ["--check", file], {
      cwd: repoRoot,
      encoding: "utf8",
    });
    if (result.status !== 0) {
      failures.push({
        file: relative(repoRoot, file),
        stdout: String(result.stdout ?? "").trim(),
        stderr: String(result.stderr ?? "").trim(),
      });
    }
  }
  const payload = {
    ok: failures.length === 0,
    checked: files.length,
    failures,
  };
  process.stdout.write(`${JSON.stringify(payload)}\n`);
  return payload.ok ? 0 : 1;
}

try {
  process.exitCode = run();
} catch (error) {
  process.stderr.write(`syntax-check failed: ${String(error?.message ?? error)}\n`);
  process.exitCode = 1;
}
