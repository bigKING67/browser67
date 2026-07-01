#!/usr/bin/env node

import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";

import {
  browser67DefaultHomePath,
  legacyTmwdBrowserMcpHomePath,
  resolveBrowser67Home,
} from "../src/runtime/paths/home.mjs";

const MIGRATION_SCHEMA = "browser67.home-migration.v1";
const DEFAULT_ENTRY_NAMES = [
  "browser",
  "runtime",
  "mcp",
  "tab-workspace",
  "optional-live-proofs",
  "captcha-providers",
];

function usage() {
  return [
    "Usage: node scripts/migrate-home.mjs [--source <legacy-home>] [--target <browser67-home>] [--write] [--json]",
    "",
    "Copies legacy ~/.tmwd-browser-mcp runtime state into ~/.browser67.",
    "Dry-run is the default. The legacy source is never deleted.",
  ].join("\n");
}

function requiredValue(argv, index, token) {
  const value = String(argv[index + 1] ?? "").trim();
  if (!value || value.startsWith("--")) {
    throw new Error(`missing ${token} value`);
  }
  return value;
}

function parseArgs(argv = []) {
  const parsed = {
    source: legacyTmwdBrowserMcpHomePath({ preferExistingLegacy: false }),
    target: browser67DefaultHomePath({ preferExistingLegacy: false }),
    write: false,
    json: false,
    help: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index] ?? "";
    if (token === "--source") {
      parsed.source = path.resolve(requiredValue(argv, index, token));
      index += 1;
      continue;
    }
    if (token === "--target") {
      parsed.target = path.resolve(requiredValue(argv, index, token));
      index += 1;
      continue;
    }
    if (token === "--write") {
      parsed.write = true;
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
    if (!token) {
      continue;
    }
    throw new Error(`unknown argument: ${token}`);
  }
  if (path.resolve(parsed.source) === path.resolve(parsed.target)) {
    throw new Error("source and target must be different");
  }
  return parsed;
}

async function pathExists(candidate) {
  try {
    await fs.access(candidate);
    return true;
  } catch {
    return false;
  }
}

async function summarizeTree(root) {
  const summary = {
    files: 0,
    directories: 0,
    bytes: 0,
    sha256: "",
  };
  const hash = createHash("sha256");
  async function visit(candidate) {
    const stats = await fs.stat(candidate);
    const relative = path.relative(root, candidate) || ".";
    hash.update(relative);
    hash.update("\0");
    if (stats.isDirectory()) {
      summary.directories += 1;
      const entries = await fs.readdir(candidate);
      entries.sort();
      for (const entry of entries) {
        await visit(path.join(candidate, entry));
      }
      return;
    }
    if (stats.isFile()) {
      summary.files += 1;
      summary.bytes += stats.size;
      hash.update(String(stats.size));
      hash.update("\0");
    }
  }
  await visit(root);
  summary.sha256 = hash.digest("hex");
  return summary;
}

async function migrationEntries(source, target) {
  const entries = [];
  for (const name of DEFAULT_ENTRY_NAMES) {
    const from = path.join(source, name);
    const to = path.join(target, name);
    const sourceExists = await pathExists(from);
    const targetExists = await pathExists(to);
    entries.push({
      name,
      from,
      to,
      source_exists: sourceExists,
      target_exists: targetExists,
      action: sourceExists
        ? (targetExists ? "skip_target_exists" : "copy")
        : "skip_missing_source",
      summary: sourceExists ? await summarizeTree(from) : undefined,
    });
  }
  return entries;
}

async function writeManifest(target, manifest) {
  const dir = path.join(target, "migration");
  await fs.mkdir(dir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const manifestPath = path.join(dir, `browser67-home-migration-${stamp}.json`);
  await fs.writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  return manifestPath;
}

async function runMigration(args) {
  const sourceExists = await pathExists(args.source);
  const entries = sourceExists ? await migrationEntries(args.source, args.target) : [];
  const manifest = {
    schema: MIGRATION_SCHEMA,
    ok: true,
    mode: args.write ? "write" : "dry_run",
    created_at: new Date().toISOString(),
    source: args.source,
    target: args.target,
    source_exists: sourceExists,
    active_home_before: resolveBrowser67Home(),
    legacy_left_in_place: true,
    entries,
  };
  if (!sourceExists) {
    manifest.ok = false;
    manifest.reason = "legacy_source_missing";
    return manifest;
  }
  if (!args.write) {
    return manifest;
  }
  await fs.mkdir(args.target, { recursive: true });
  for (const entry of entries) {
    if (entry.action !== "copy") {
      continue;
    }
    await fs.cp(entry.from, entry.to, {
      recursive: true,
      force: false,
      errorOnExist: true,
      preserveTimestamps: true,
    });
    entry.action = "copied";
  }
  manifest.manifest_path = await writeManifest(args.target, manifest);
  return manifest;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    process.stdout.write(`${usage()}\n`);
    return 0;
  }
  const payload = await runMigration(args);
  if (args.json) {
    process.stdout.write(`${JSON.stringify(payload)}\n`);
    return payload.ok ? 0 : 1;
  }
  process.stdout.write(`browser67 home migration ${payload.mode}: ${payload.source} -> ${payload.target}\n`);
  if (!payload.source_exists) {
    process.stdout.write(`Legacy source missing: ${payload.source}\n`);
    return 1;
  }
  for (const entry of payload.entries) {
    const summary = entry.summary
      ? ` files=${entry.summary.files} bytes=${entry.summary.bytes}`
      : "";
    process.stdout.write(`  - ${entry.name}: ${entry.action}${summary}\n`);
  }
  if (payload.manifest_path) {
    process.stdout.write(`Manifest: ${payload.manifest_path}\n`);
  }
  process.stdout.write("Legacy source was left in place.\n");
  return payload.ok ? 0 : 1;
}

try {
  process.exitCode = await main();
} catch (error) {
  process.stderr.write(`migrate-home failed: ${String(error?.message ?? error)}\n\n${usage()}\n`);
  process.exitCode = 1;
}
