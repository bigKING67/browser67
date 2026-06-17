#!/usr/bin/env node
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

import { listManagedTabRecords, managedTabPayload } from "../src/tab-workspace.mjs";

function parseArgs(argv) {
  const parsed = {
    max_unkept: 0,
    max_items: 20,
    json: false,
    baseline_file: "",
    write_baseline: "",
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
    if (token === "--baseline-file") {
      const value = String(argv[index + 1] ?? "").trim();
      if (!value) {
        throw new Error("invalid --baseline-file value");
      }
      parsed.baseline_file = value;
      index += 1;
      continue;
    }
    if (token === "--write-baseline") {
      const value = String(argv[index + 1] ?? "").trim();
      if (!value) {
        throw new Error("invalid --write-baseline value");
      }
      parsed.write_baseline = value;
      index += 1;
      continue;
    }
    if (!token) {
      continue;
    }
    throw new Error(`unknown argument: ${token}`);
  }
  return parsed;
}

function tabIds(records = []) {
  return records.map((record) => String(record.tab_id ?? "").trim()).filter(Boolean);
}

async function readBaselineUnkeptIds(path) {
  if (!path) {
    return new Set();
  }
  const parsed = JSON.parse(await readFile(path, "utf8"));
  if (!Array.isArray(parsed?.unkept_tab_ids)) {
    throw new Error(`invalid managed tab cleanup baseline: ${path}`);
  }
  return new Set(parsed.unkept_tab_ids.map((tabId) => String(tabId ?? "").trim()).filter(Boolean));
}

async function writeBaseline(path, records = []) {
  const unkept = records.filter((record) => record.keep !== true);
  const kept = records.filter((record) => record.keep === true);
  const payload = {
    version: 1,
    check: "managed-tab-cleanup-baseline",
    created_at: new Date().toISOString(),
    registry_only: true,
    total_count: records.length,
    unkept_count: unkept.length,
    kept_count: kept.length,
    tab_ids: tabIds(records),
    unkept_tab_ids: tabIds(unkept),
    kept_tab_ids: tabIds(kept),
  };
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(payload, null, 2)}\n`, { flag: "wx" });
  return payload;
}

async function run() {
  const args = parseArgs(process.argv.slice(2));
  const records = await listManagedTabRecords();
  const unkept = records.filter((record) => record.keep !== true);
  const kept = records.filter((record) => record.keep === true);
  if (args.write_baseline) {
    const baseline = await writeBaseline(args.write_baseline, records);
    if (args.json) {
      process.stdout.write(`${JSON.stringify({
        ok: true,
        status: "baseline_written",
        baseline_file: args.write_baseline,
        ...baseline,
      })}\n`);
    } else {
      process.stdout.write(`managed_tab_cleanup_baseline=written file=${args.write_baseline} unkept=${baseline.unkept_count} kept=${baseline.kept_count} total=${baseline.total_count}\n`);
    }
    process.exitCode = 0;
    return;
  }
  const baselineUnkeptIds = await readBaselineUnkeptIds(args.baseline_file);
  const effectiveUnkept = unkept.filter((record) => !baselineUnkeptIds.has(String(record.tab_id)));
  const ignoredUnkept = unkept.length - effectiveUnkept.length;
  const ok = effectiveUnkept.length <= args.max_unkept;
  const payload = {
    ok,
    check: "managed-tab-cleanup",
    registry_only: true,
    baseline_file: args.baseline_file || undefined,
    max_unkept: args.max_unkept,
    total_count: records.length,
    unkept_count: unkept.length,
    effective_unkept_count: effectiveUnkept.length,
    ignored_preexisting_unkept_count: ignoredUnkept,
    kept_count: kept.length,
    unkept: effectiveUnkept.slice(0, args.max_items).map((record) => managedTabPayload(record)),
    unkept_returned_count: Math.min(effectiveUnkept.length, args.max_items),
    unkept_truncated: effectiveUnkept.length > args.max_items,
    remediation: effectiveUnkept.length > args.max_unkept
      ? "Run browser_tab_lifecycle action=finalize_task for the relevant workspace_key/task_id, or prune stale records after browser tabs were closed."
      : "No unkept managed tabs exceed the configured threshold.",
  };
  if (args.json) {
    process.stdout.write(`${JSON.stringify(payload)}\n`);
  } else if (ok) {
    process.stdout.write(`managed_tab_cleanup=ok unkept=${effectiveUnkept.length} ignored_preexisting=${ignoredUnkept} kept=${kept.length} total=${records.length}\n`);
  } else {
    process.stderr.write(`managed_tab_cleanup=fail unkept=${effectiveUnkept.length} ignored_preexisting=${ignoredUnkept} kept=${kept.length} total=${records.length}\n`);
    process.stderr.write(payload.unkept
      .map((record) => `- ${record.tab_id} workspace=${record.workspace_key} url=${record.url}`)
      .join("\n"));
    process.stderr.write(payload.unkept.length > 0 ? "\n" : "");
  }
  process.exitCode = ok ? 0 : 1;
}

await run();
