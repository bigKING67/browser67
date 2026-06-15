#!/usr/bin/env node
import { listManagedTabRecords, managedTabPayload } from "../src/tab-workspace.mjs";

function parseArgs(argv) {
  const parsed = {
    max_unkept: 0,
    max_items: 20,
    json: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index] ?? "";
    if (token === "--max-unkept") {
      const value = Number(argv[index + 1] ?? "");
      if (!Number.isFinite(value) || value < 0) {
        throw new Error("invalid --max-unkept value");
      }
      parsed.max_unkept = Math.floor(value);
      index += 1;
      continue;
    }
    if (token === "--max-items") {
      const value = Number(argv[index + 1] ?? "");
      if (!Number.isFinite(value) || value < 0) {
        throw new Error("invalid --max-items value");
      }
      parsed.max_items = Math.floor(value);
      index += 1;
      continue;
    }
    if (token === "--json") {
      parsed.json = true;
      continue;
    }
    if (!token) {
      continue;
    }
    throw new Error(`unknown argument: ${token}`);
  }
  return parsed;
}

function run() {
  const args = parseArgs(process.argv.slice(2));
  const records = listManagedTabRecords();
  const unkept = records.filter((record) => record.keep !== true);
  const kept = records.filter((record) => record.keep === true);
  const ok = unkept.length <= args.max_unkept;
  const payload = {
    ok,
    check: "managed-tab-cleanup",
    registry_only: true,
    max_unkept: args.max_unkept,
    total_count: records.length,
    unkept_count: unkept.length,
    kept_count: kept.length,
    unkept: unkept.slice(0, args.max_items).map((record) => managedTabPayload(record)),
    unkept_returned_count: Math.min(unkept.length, args.max_items),
    unkept_truncated: unkept.length > args.max_items,
    remediation: unkept.length > args.max_unkept
      ? "Run browser_tab_lifecycle action=finalize_task for the relevant workspace_key/task_id, or prune stale records after browser tabs were closed."
      : "No unkept managed tabs exceed the configured threshold.",
  };
  if (args.json) {
    process.stdout.write(`${JSON.stringify(payload)}\n`);
  } else if (ok) {
    process.stdout.write(`managed_tab_cleanup=ok unkept=${unkept.length} kept=${kept.length} total=${records.length}\n`);
  } else {
    process.stderr.write(`managed_tab_cleanup=fail unkept=${unkept.length} kept=${kept.length} total=${records.length}\n`);
    for (const record of payload.unkept) {
      process.stderr.write(`- ${record.tab_id} workspace=${record.workspace_key} url=${record.url}\n`);
    }
  }
  process.exitCode = ok ? 0 : 1;
}

run();
