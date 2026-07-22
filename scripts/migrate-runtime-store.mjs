#!/usr/bin/env node

import path from "node:path";
import { fileURLToPath } from "node:url";

import { createJobStore } from "../src/runtime/jobs/store.mjs";
import {
  RUN_SCHEMA_VERSION,
  configuredRunRoot,
  createRunStore,
} from "../src/runtime/runs/store.mjs";

function parseArgs(argv = []) {
  const args = { write: false, json: false, run_root: "" };
  for (let index = 0; index < argv.length; index += 1) {
    const token = String(argv[index] ?? "");
    if (token === "--write") {
      args.write = true;
      continue;
    }
    if (token === "--check" || token === "--dry-run") continue;
    if (token === "--json") {
      args.json = true;
      continue;
    }
    if (token === "--run-root") {
      args.run_root = String(argv[index + 1] ?? "").trim();
      if (!args.run_root) throw new Error("--run-root requires a path");
      index += 1;
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
    "Usage: node scripts/migrate-runtime-store.mjs [--check|--write] [--run-root <path>] [--json]",
    "",
    "The default is a read-only audit. --write upgrades run.json records and rebuilds",
    "group run indexes plus the global active-job/catalog indexes.",
  ].join("\n");
}

async function migrateRuntimeStore(args = {}) {
  const runRoot = path.resolve(args.run_root || configuredRunRoot());
  const runStore = createRunStore({ root: runRoot });
  const jobStore = createJobStore({ run_root: runRoot });
  const before = {
    runs: await runStore.inspect(),
    jobs: await jobStore.inspect(),
  };
  if (!args.write) {
    return {
      ok: true,
      check: "runtime-store-migration",
      write: false,
      target_run_schema_version: RUN_SCHEMA_VERSION,
      migration_required: before.runs.legacy_run_count > 0
        || before.runs.groups.some((group) => group.index_ready !== true)
        || before.jobs.catalog_ready !== true,
      before,
    };
  }
  const migratedRuns = await runStore.migrate();
  const rebuiltJobs = await jobStore.rebuild();
  return {
    ok: true,
    check: "runtime-store-migration",
    write: true,
    target_run_schema_version: RUN_SCHEMA_VERSION,
    before,
    migrated_runs: migratedRuns,
    rebuilt_jobs: rebuiltJobs,
    after: {
      runs: await runStore.inspect(),
      jobs: await jobStore.inspect(),
    },
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    process.stdout.write(`${usage()}\n`);
    return 0;
  }
  const result = await migrateRuntimeStore(args);
  if (args.json) {
    process.stdout.write(`${JSON.stringify(result)}\n`);
  } else {
    process.stdout.write([
      `runtime_store_migration=${result.write ? "applied" : "audit"}`,
      `run_root=${result.before.runs.root}`,
      `runs=${result.before.runs.run_count}`,
      `legacy_runs=${result.before.runs.legacy_run_count}`,
      `migration_required=${result.migration_required ?? false}`,
    ].join(" "));
    process.stdout.write("\n");
  }
  return 0;
}

const isMain = process.argv[1]
  && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  main().then((code) => {
    process.exitCode = code;
  }).catch((error) => {
    process.stderr.write(`runtime store migration failed: ${String(error?.message ?? error)}\n`);
    process.exitCode = 1;
  });
}

export {
  migrateRuntimeStore,
  parseArgs,
};
