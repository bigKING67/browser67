#!/usr/bin/env node

import { chmod, lstat, readdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { resolveBrowser67HomePath } from "../src/runtime/paths/home.mjs";
import {
  PRIVATE_DIRECTORY_MODE,
  PRIVATE_FILE_MODE,
} from "../src/runtime/storage/private-path.mjs";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function parseArgs(argv = []) {
  const parsed = { home: "", write: false, json: false, max_items: 50 };
  for (let index = 0; index < argv.length; index += 1) {
    const token = String(argv[index] ?? "");
    if (token === "--home") {
      parsed.home = String(argv[index + 1] ?? "").trim();
      if (!parsed.home) throw new Error("--home requires a path");
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

function isSameOrInside(child, parent) {
  const relative = path.relative(parent, child);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function assertSafeBrowserHome(input) {
  const resolved = path.resolve(input);
  const root = path.parse(resolved).root;
  const userHome = path.resolve(os.homedir());
  if (resolved === root || resolved === userHome) {
    throw new Error(`refusing unsafe browser67 home: ${resolved}`);
  }
  if (resolved === REPO_ROOT || isSameOrInside(REPO_ROOT, resolved) || isSameOrInside(resolved, REPO_ROOT)) {
    throw new Error(`refusing browser67 home inside or above repository: ${resolved}`);
  }
  if (!isSameOrInside(resolved, userHome) && !path.basename(resolved).toLowerCase().includes("browser67")) {
    throw new Error(`refusing unrecognized external browser67 home: ${resolved}`);
  }
  return resolved;
}

function permissionBits(metadata) {
  return metadata.mode & 0o777;
}

async function collectPermissionRows(target, rows) {
  const metadata = await lstat(target).catch((error) => {
    if (error?.code === "ENOENT") return null;
    throw error;
  });
  if (!metadata) return;
  if (metadata.isSymbolicLink()) {
    rows.push({ path: target, kind: "symlink", skipped: true, reason: "symlink_not_followed" });
    return;
  }
  const kind = metadata.isDirectory() ? "directory" : (metadata.isFile() ? "file" : "other");
  const expectedMode = kind === "directory" ? PRIVATE_DIRECTORY_MODE : PRIVATE_FILE_MODE;
  rows.push({
    path: target,
    kind,
    actual_mode: permissionBits(metadata),
    expected_mode: expectedMode,
    current: kind === "other" || permissionBits(metadata) === expectedMode,
    skipped: kind === "other",
    reason: kind === "other" ? "unsupported_file_type" : undefined,
  });
  if (kind !== "directory") return;
  const entries = await readdir(target, { withFileTypes: true });
  for (const entry of entries) {
    await collectPermissionRows(path.join(target, entry.name), rows);
  }
}

async function auditRuntimePermissions(args = {}) {
  const home = assertSafeBrowserHome(args.home || resolveBrowser67HomePath());
  const homeMetadata = await lstat(home).catch((error) => {
    if (error?.code === "ENOENT") return null;
    throw error;
  });
  if (!homeMetadata) {
    return {
      ok: true,
      check: "runtime-permissions",
      write: args.write === true,
      home,
      home_exists: false,
      checked_count: 0,
      mismatch_count: 0,
      changed_count: 0,
      rows: [],
    };
  }
  if (!homeMetadata.isDirectory() || homeMetadata.isSymbolicLink()) {
    throw new Error(`browser67 home must be a real directory: ${home}`);
  }
  const rows = [];
  rows.push({
    path: home,
    kind: "directory",
    actual_mode: permissionBits(homeMetadata),
    expected_mode: PRIVATE_DIRECTORY_MODE,
    current: permissionBits(homeMetadata) === PRIVATE_DIRECTORY_MODE,
  });
  await collectPermissionRows(path.join(home, "runtime"), rows);
  await collectPermissionRows(path.join(home, "tab-workspace"), rows);
  const mismatches = rows.filter((row) => row.current === false && row.skipped !== true);
  const errors = [];
  let changedCount = 0;
  if (args.write === true) {
    for (const row of mismatches) {
      try {
        await chmod(row.path, row.expected_mode);
        changedCount += 1;
      } catch (error) {
        errors.push({ path: row.path, error: String(error?.message ?? error) });
      }
    }
  }
  const maxItems = Number.isInteger(args.max_items) ? args.max_items : 50;
  return {
    ok: errors.length === 0,
    check: "runtime-permissions",
    write: args.write === true,
    home,
    home_exists: true,
    policy: {
      directory_mode: "0700",
      file_mode: "0600",
      symlink_policy: "do_not_follow",
      scopes: ["home", "runtime", "tab-workspace"],
    },
    checked_count: rows.length,
    mismatch_count: mismatches.length,
    changed_count: changedCount,
    mismatch_rows: mismatches.slice(0, maxItems).map((row) => ({
      ...row,
      actual_mode: row.actual_mode.toString(8).padStart(4, "0"),
      expected_mode: row.expected_mode.toString(8).padStart(4, "0"),
    })),
    mismatch_rows_truncated: mismatches.length > maxItems,
    skipped_count: rows.filter((row) => row.skipped === true).length,
    errors,
  };
}

function usage() {
  return [
    "Usage: node scripts/audit-runtime-permissions.mjs [--dry-run|--write] [--home <path>] [--max-items <n>] [--json]",
    "",
    "The default is read-only. --write restricts the browser67 home directory, runtime subtree,",
    "and managed-tab registry subtree to owner-only modes without following symbolic links.",
  ].join("\n");
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    process.stdout.write(`${usage()}\n`);
    return 0;
  }
  const result = await auditRuntimePermissions(args);
  if (args.json) process.stdout.write(`${JSON.stringify(result)}\n`);
  else {
    process.stdout.write([
      `runtime_permissions=${result.write ? "applied" : "audit"}`,
      `home=${result.home}`,
      `checked=${result.checked_count}`,
      `mismatches=${result.mismatch_count}`,
      `changed=${result.changed_count}`,
    ].join(" "));
    process.stdout.write("\n");
  }
  return result.ok ? 0 : 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().then((code) => {
    process.exitCode = code;
  }).catch((error) => {
    process.stderr.write(`runtime permission audit failed: ${String(error?.message ?? error)}\n`);
    process.exitCode = 1;
  });
}

export {
  assertSafeBrowserHome,
  auditRuntimePermissions,
  parseArgs,
};
