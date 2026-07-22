#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { resolveTier, tiers } from "./verification/manifest.mjs";

function parseArgs(argv = []) {
  const args = { tier: "fast", changed: false, list: false, json: false };
  for (let index = 0; index < argv.length; index += 1) {
    const token = String(argv[index] ?? "");
    if (token === "--tier") {
      args.tier = String(argv[index + 1] ?? "").trim();
      if (!args.tier) throw new Error("--tier requires a value");
      index += 1;
      continue;
    }
    if (token === "--changed") {
      args.changed = true;
      continue;
    }
    if (token === "--list" || token === "--dry-run") {
      args.list = true;
      continue;
    }
    if (token === "--json") {
      args.json = true;
      continue;
    }
    if (token === "--help" || token === "-h") {
      args.help = true;
      continue;
    }
    if (token) throw new Error(`unknown argument: ${token}`);
  }
  return args;
}

function usage() {
  return [
    "Usage: node scripts/run-verification.mjs --tier <tier> [--changed] [--list] [--json]",
    "",
    `Tiers: ${Object.keys(tiers).join(", ")}`,
  ].join("\n");
}

function changedPaths() {
  const result = spawnSync("git", ["status", "--porcelain=v1", "--untracked-files=all"], {
    cwd: process.cwd(),
    encoding: "utf8",
  });
  if (result.status !== 0) throw new Error(String(result.stderr || result.stdout || "git status failed"));
  return String(result.stdout ?? "")
    .split("\n")
    .filter(Boolean)
    .map((line) => line.slice(3).trim())
    .map((file) => file.includes(" -> ") ? file.split(" -> ").at(-1) : file)
    .filter(Boolean);
}

function globRegex(pattern) {
  const tokens = String(pattern).split("**");
  const source = tokens.map((token) => token
    .replace(/[.+?^${}()|[\]\\]/g, "\\$&")
    .replace(/\*/g, "[^/]*"))
    .join(".*");
  return new RegExp(`^${source}$`);
}

function entryMatchesPaths(entry, paths) {
  const patterns = entry.changed_paths ?? [];
  return paths.some((file) => patterns.some((pattern) => globRegex(pattern).test(file)));
}

function commandWithPlaceholders(entry, context) {
  return entry.command.map((part) => String(part).replaceAll("{managed_baseline}", context.managed_baseline));
}

function verificationPlan(options = {}) {
  let selected = resolveTier(options.tier ?? "fast");
  const paths = options.changed ? changedPaths() : [];
  if (options.changed) selected = selected.filter((entry) => entryMatchesPaths(entry, paths));
  return {
    tier: options.tier ?? "fast",
    purpose: tiers[options.tier ?? "fast"]?.purpose ?? "",
    changed: options.changed === true,
    changed_paths: paths,
    entries: selected,
  };
}

function runVerification(options = {}) {
  const plan = verificationPlan(options);
  if (options.list) {
    return { ok: true, executed: false, ...plan };
  }
  const tempDir = mkdtempSync(path.join(tmpdir(), "browser67-gate-"));
  const context = { managed_baseline: path.join(tempDir, "managed-tabs-baseline.json") };
  const completed = [];
  try {
    for (const entry of plan.entries) {
      const [command, ...args] = commandWithPlaceholders(entry, context);
      process.stdout.write(`\n>>> [${entry.id}] ${entry.label}\n`);
      const result = spawnSync(command, args, {
        cwd: process.cwd(),
        env: process.env,
        stdio: "inherit",
      });
      if (result.status !== 0) {
        process.stderr.write(`verification failed at: ${entry.id}\n`);
        return {
          ok: false,
          executed: true,
          ...plan,
          completed,
          failed: entry.id,
          exit_code: Number.isFinite(Number(result.status)) ? Number(result.status) : 1,
        };
      }
      completed.push(entry.id);
    }
    process.stdout.write(`\nverification tier ${plan.tier} ok (${completed.length} steps)\n`);
    return { ok: true, executed: true, ...plan, completed, exit_code: 0 };
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
}

function serializablePlan(result) {
  return {
    ...result,
    entries: result.entries.map((entry) => ({
      id: entry.id,
      command: entry.command,
      label: entry.label,
      changed_paths: entry.changed_paths,
      requirements: entry.requirements,
    })),
  };
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    process.stdout.write(`${usage()}\n`);
    return 0;
  }
  const result = runVerification(args);
  if (args.json) process.stdout.write(`${JSON.stringify(serializablePlan(result))}\n`);
  return result.ok ? 0 : result.exit_code ?? 1;
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  try {
    process.exitCode = main();
  } catch (error) {
    process.stderr.write(`verification runner failed: ${String(error?.stack ?? error)}\n`);
    process.exitCode = 1;
  }
}

export {
  changedPaths,
  entryMatchesPaths,
  parseArgs,
  runVerification,
  verificationPlan,
};
