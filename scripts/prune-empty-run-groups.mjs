#!/usr/bin/env node

import { lstat, readFile, readdir, rmdir, unlink } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { configuredRunRoot } from "../src/runtime/runs/store.mjs";
import { assertSafeRunRoot } from "./terminalize-stale-runs.mjs";

const ALLOWED_EMPTY_GROUP_FILES = new Set(["index.ndjson", "index.meta.json"]);

function parseArgs(argv = []) {
  const parsed = { run_root: "", write: false, json: false, max_items: 50 };
  for (let index = 0; index < argv.length; index += 1) {
    const token = String(argv[index] ?? "");
    if (token === "--run-root") {
      parsed.run_root = String(argv[index + 1] ?? "").trim();
      if (!parsed.run_root) throw new Error("--run-root requires a path");
      index += 1;
      continue;
    }
    if (token === "--max-items") {
      const value = Number(argv[index + 1]);
      if (!Number.isInteger(value) || value < 0 || value > 10_000) {
        throw new Error("--max-items must be an integer from 0 to 10000");
      }
      parsed.max_items = value;
      index += 1;
      continue;
    }
    if (token === "--write") {
      parsed.write = true;
      continue;
    }
    if (token === "--dry-run" || token === "--check") continue;
    if (token === "--json") {
      parsed.json = true;
      continue;
    }
    if (token === "--help" || token === "-h") {
      parsed.help = true;
      continue;
    }
    if (token) throw new Error(`unknown argument: ${token}`);
  }
  return parsed;
}

async function emptyGroupCandidate(root, entry) {
  if (!entry.isDirectory() || entry.isSymbolicLink()) return null;
  const groupPath = path.join(root, entry.name);
  const children = await readdir(groupPath, { withFileTypes: true });
  if (children.some((child) => child.isDirectory() || !child.isFile())) return null;
  if (children.some((child) => !ALLOWED_EMPTY_GROUP_FILES.has(child.name))) return null;
  const indexPath = path.join(groupPath, "index.ndjson");
  const indexRaw = await readFile(indexPath, "utf8").catch((error) => {
    if (error?.code === "ENOENT") return "";
    throw error;
  });
  if (indexRaw.trim()) return null;
  const metaPath = path.join(groupPath, "index.meta.json");
  const metaRaw = await readFile(metaPath, "utf8").catch((error) => {
    if (error?.code === "ENOENT") return "";
    throw error;
  });
  if (metaRaw.trim()) {
    let meta;
    try {
      meta = JSON.parse(metaRaw);
    } catch {
      return null;
    }
    if (Number(meta?.unique_count ?? 0) !== 0 || Number(meta?.entry_count ?? 0) !== 0) {
      return null;
    }
  }
  return {
    group: entry.name,
    path: groupPath,
    removable_files: children.map((child) => child.name).sort(),
  };
}

async function scanEmptyRunGroups(runRoot) {
  const root = assertSafeRunRoot(runRoot);
  const rootMetadata = await lstat(root).catch((error) => {
    if (error?.code === "ENOENT") return null;
    throw error;
  });
  if (!rootMetadata) return { root, root_exists: false, candidates: [] };
  if (!rootMetadata.isDirectory() || rootMetadata.isSymbolicLink()) {
    throw new Error(`run root must be a real directory: ${root}`);
  }
  const entries = await readdir(root, { withFileTypes: true });
  const candidates = [];
  for (const entry of entries) {
    const candidate = await emptyGroupCandidate(root, entry);
    if (candidate) candidates.push(candidate);
  }
  candidates.sort((left, right) => left.group.localeCompare(right.group));
  return { root, root_exists: true, candidates };
}

async function pruneEmptyRunGroups(args = {}) {
  const scan = await scanEmptyRunGroups(args.run_root || configuredRunRoot());
  const write = args.write === true;
  const removed = [];
  const errors = [];
  if (write) {
    for (const candidate of scan.candidates) {
      try {
        const refreshed = await emptyGroupCandidate(scan.root, {
          name: candidate.group,
          isDirectory: () => true,
          isSymbolicLink: () => false,
        });
        if (!refreshed) throw new Error("group changed after audit; refusing removal");
        for (const fileName of refreshed.removable_files) {
          await unlink(path.join(refreshed.path, fileName));
        }
        await rmdir(refreshed.path);
        removed.push({ group: refreshed.group, path: refreshed.path });
      } catch (error) {
        errors.push({
          group: candidate.group,
          path: candidate.path,
          error: String(error?.message ?? error),
        });
      }
    }
  }
  const maxItems = Number.isInteger(args.max_items) ? args.max_items : 50;
  return {
    ok: errors.length === 0,
    check: "empty-run-group-prune",
    write,
    dry_run: !write,
    root: scan.root,
    root_exists: scan.root_exists,
    candidate_count: scan.candidates.length,
    would_remove_count: write ? 0 : scan.candidates.length,
    removed_count: removed.length,
    candidates: scan.candidates.slice(0, maxItems),
    candidates_truncated: scan.candidates.length > maxItems,
    removed: removed.slice(0, maxItems),
    errors: errors.slice(0, maxItems),
  };
}

function usage() {
  return [
    "Usage: node scripts/prune-empty-run-groups.mjs [--dry-run|--write] [--run-root <path>] [--max-items <n>] [--json]",
    "",
    "The default is read-only. --write removes only direct child group directories that contain",
    "no run directories and at most empty index.ndjson/index.meta.json files.",
  ].join("\n");
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    process.stdout.write(`${usage()}\n`);
    return 0;
  }
  const result = await pruneEmptyRunGroups(args);
  if (args.json) process.stdout.write(`${JSON.stringify(result)}\n`);
  else {
    process.stdout.write([
      `empty_run_group_prune=${result.write ? "applied" : "audit"}`,
      `root=${result.root}`,
      `candidates=${result.candidate_count}`,
      `removed=${result.removed_count}`,
    ].join(" "));
    process.stdout.write("\n");
  }
  return result.ok ? 0 : 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().then((code) => {
    process.exitCode = code;
  }).catch((error) => {
    process.stderr.write(`empty run group prune failed: ${String(error?.message ?? error)}\n`);
    process.exitCode = 1;
  });
}

export {
  parseArgs,
  pruneEmptyRunGroups,
  scanEmptyRunGroups,
};
