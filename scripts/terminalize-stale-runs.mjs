#!/usr/bin/env node

import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";

import { configuredRunRoot, createRunStore } from "../src/runtime/runs/store.mjs";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function isSameOrInside(child, parent) {
  const relative = path.relative(parent, child);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function assertSafeRunRoot(input) {
  const resolved = path.resolve(input);
  const filesystemRoot = path.parse(resolved).root;
  const userHome = path.resolve(os.homedir());
  if (resolved === filesystemRoot || resolved === userHome) {
    throw new Error(`refusing unsafe run root: ${resolved}`);
  }
  if (resolved === REPO_ROOT || isSameOrInside(REPO_ROOT, resolved) || isSameOrInside(resolved, REPO_ROOT)) {
    throw new Error(`refusing run root inside or above repository: ${resolved}`);
  }
  if (path.basename(resolved) !== "runs") {
    throw new Error(`run root must end with a dedicated runs directory: ${resolved}`);
  }
  return resolved;
}

function parsePositiveInteger(raw, label) {
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 1) throw new Error(`${label} must be a positive integer`);
  return value;
}

function parseArgs(argv = []) {
  const parsed = {
    run_root: "",
    write: false,
    json: false,
    stale_running_after_minutes: 1_440,
    max_items: 50,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const token = String(argv[index] ?? "");
    if (token === "--run-root") {
      parsed.run_root = String(argv[index + 1] ?? "").trim();
      if (!parsed.run_root) throw new Error("--run-root requires a path");
      index += 1;
      continue;
    }
    if (token === "--stale-running-after-minutes") {
      parsed.stale_running_after_minutes = parsePositiveInteger(argv[index + 1], token);
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

async function terminalizeStaleRuns(args = {}) {
  const root = assertSafeRunRoot(args.run_root || configuredRunRoot());
  const store = createRunStore({ root });
  try {
    const before = await store.inspect({
      summary_only: true,
      stale_running_after_minutes: args.stale_running_after_minutes,
    });
    const result = await store.terminalizeStale(args);
    const after = args.write === true
      ? await store.inspect({
          summary_only: true,
          stale_running_after_minutes: args.stale_running_after_minutes,
        })
      : before;
    return {
      ...result,
      check: "stale-run-terminalization",
      before: {
        running_run_count: before.running_run_count,
        stale_running_count: before.stale_running_count,
        nonterminal_run_count: before.nonterminal_run_count,
      },
      after: {
        running_run_count: after.running_run_count,
        stale_running_count: after.stale_running_count,
        nonterminal_run_count: after.nonterminal_run_count,
      },
    };
  } finally {
    await store.dispose();
  }
}

function usage() {
  return [
    "Usage: node scripts/terminalize-stale-runs.mjs [--dry-run|--write] [--run-root <path>] [--stale-running-after-minutes <n>] [--max-items <n>] [--json]",
    "",
    "The default is a read-only audit. --write changes only stale status=running records to interrupted;",
    "it does not delete run directories or artifacts.",
  ].join("\n");
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    process.stdout.write(`${usage()}\n`);
    return 0;
  }
  const result = await terminalizeStaleRuns(args);
  if (args.json) process.stdout.write(`${JSON.stringify(result)}\n`);
  else {
    process.stdout.write([
      `stale_run_terminalization=${result.write ? "applied" : "audit"}`,
      `root=${result.root}`,
      `candidates=${result.candidate_count}`,
      `terminalized=${result.terminalized_count}`,
      `threshold_minutes=${result.stale_running_after_minutes}`,
    ].join(" "));
    process.stdout.write("\n");
  }
  return result.ok ? 0 : 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().then((code) => {
    process.exitCode = code;
  }).catch((error) => {
    process.stderr.write(`stale run terminalization failed: ${String(error?.message ?? error)}\n`);
    process.exitCode = 1;
  });
}

export {
  assertSafeRunRoot,
  parseArgs,
  terminalizeStaleRuns,
};
