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
    old_after_minutes: 60,
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
    if (token === "--old-after-minutes") {
      const value = Number(argv[index + 1] ?? "");
      if (!Number.isFinite(value) || value < 0) {
        throw new Error("invalid --old-after-minutes value");
      }
      parsed.old_after_minutes = Math.floor(value);
      index += 1;
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

function safeString(value, fallback = "") {
  const text = String(value ?? "").trim();
  return text || fallback;
}

function tabIds(records = []) {
  return records.map((record) => String(record.tab_id ?? "").trim()).filter(Boolean);
}

function timestampMs(record) {
  const raw = record.last_used_at || record.updated_at || record.created_at;
  const parsed = Date.parse(String(raw ?? ""));
  return Number.isFinite(parsed) ? parsed : null;
}

function ageMinutes(record, nowMs) {
  const timestamp = timestampMs(record);
  if (timestamp === null) {
    return null;
  }
  return Math.max(0, Math.floor((nowMs - timestamp) / 60_000));
}

function cleanupScopeKey(record) {
  const workspaceKey = safeString(record.workspace_key);
  if (workspaceKey) {
    return `workspace:${workspaceKey}`;
  }
  const taskId = safeString(record.task_id);
  if (taskId) {
    return `task:${taskId}`;
  }
  return "scope:unknown";
}

function suggestedFinalizeArguments(record) {
  const workspaceKey = safeString(record.workspace_key);
  if (workspaceKey) {
    return {
      action: "finalize_task",
      workspace_key: workspaceKey,
      prune_stale: true,
    };
  }
  const taskId = safeString(record.task_id);
  if (taskId) {
    return {
      action: "finalize_task",
      task_id: taskId,
      prune_stale: true,
    };
  }
  return {
    action: "finalize_task",
    scope: "all",
    prune_stale: true,
  };
}

function suggestedFinalizeText(record) {
  const args = suggestedFinalizeArguments(record);
  if (args.workspace_key) {
    return `browser_tab_lifecycle action=finalize_task workspace_key=${args.workspace_key} prune_stale=true`;
  }
  if (args.task_id) {
    return `browser_tab_lifecycle action=finalize_task task_id=${args.task_id} prune_stale=true`;
  }
  return "browser_tab_lifecycle action=finalize_task scope=all prune_stale=true";
}

function summarizeUnkeptByWorkspace(records = [], nowMs, maxItems) {
  const groups = new Map();
  for (const record of records) {
    const key = cleanupScopeKey(record);
    const existing = groups.get(key) ?? {
      key,
      workspace_key: safeString(record.workspace_key) || undefined,
      task_id: safeString(record.task_id) || undefined,
      unkept_count: 0,
      tab_ids: [],
      urls: new Set(),
      oldest_last_used_at: "",
      newest_last_used_at: "",
      oldest_age_minutes: null,
      suggested_arguments: suggestedFinalizeArguments(record),
      suggested_command: suggestedFinalizeText(record),
    };
    existing.unkept_count += 1;
    existing.tab_ids.push(record.tab_id);
    existing.urls.add(record.url);
    const age = ageMinutes(record, nowMs);
    if (age !== null && (existing.oldest_age_minutes === null || age > existing.oldest_age_minutes)) {
      existing.oldest_age_minutes = age;
      existing.oldest_last_used_at = record.last_used_at || record.updated_at || record.created_at || "";
    }
    const lastUsed = record.last_used_at || record.updated_at || record.created_at || "";
    if (!existing.newest_last_used_at || String(lastUsed).localeCompare(existing.newest_last_used_at) > 0) {
      existing.newest_last_used_at = lastUsed;
    }
    groups.set(key, existing);
  }
  const values = Array.from(groups.values())
    .sort((left, right) => right.unkept_count - left.unkept_count || left.key.localeCompare(right.key))
    .map((group) => ({
      ...group,
      url_count: group.urls.size,
      urls: Array.from(group.urls).slice(0, maxItems),
      urls_truncated: group.urls.size > maxItems,
      tab_ids: group.tab_ids.slice(0, maxItems),
      tab_ids_truncated: group.tab_ids.length > maxItems,
    }));
  return {
    values: values.slice(0, maxItems),
    total_count: values.length,
    returned_count: Math.min(values.length, maxItems),
    truncated: values.length > maxItems,
  };
}

function summarizeDuplicateUrls(records = [], maxItems) {
  const groups = new Map();
  for (const record of records) {
    const url = safeString(record.url, "about:blank");
    const existing = groups.get(url) ?? {
      url,
      tab_ids: [],
      workspace_keys: new Set(),
      task_ids: new Set(),
    };
    existing.tab_ids.push(record.tab_id);
    if (record.workspace_key) {
      existing.workspace_keys.add(record.workspace_key);
    }
    if (record.task_id) {
      existing.task_ids.add(record.task_id);
    }
    groups.set(url, existing);
  }
  const values = Array.from(groups.values())
    .filter((group) => group.tab_ids.length > 1)
    .sort((left, right) => right.tab_ids.length - left.tab_ids.length || left.url.localeCompare(right.url))
    .map((group) => ({
      url: group.url,
      tab_count: group.tab_ids.length,
      workspace_count: group.workspace_keys.size,
      task_count: group.task_ids.size,
      workspace_keys: Array.from(group.workspace_keys).slice(0, maxItems),
      task_ids: Array.from(group.task_ids).slice(0, maxItems),
      tab_ids: group.tab_ids.slice(0, maxItems),
      tab_ids_truncated: group.tab_ids.length > maxItems,
    }));
  return {
    values: values.slice(0, maxItems),
    total_count: values.length,
    returned_count: Math.min(values.length, maxItems),
    truncated: values.length > maxItems,
  };
}

function summarizeOldUnkept(records = [], nowMs, oldAfterMinutes, maxItems) {
  const values = records
    .map((record) => ({
      ...managedTabPayload(record),
      age_minutes: ageMinutes(record, nowMs),
      suggested_arguments: suggestedFinalizeArguments(record),
      suggested_command: suggestedFinalizeText(record),
    }))
    .filter((record) => record.age_minutes !== null && record.age_minutes >= oldAfterMinutes)
    .sort((left, right) => right.age_minutes - left.age_minutes);
  return {
    values: values.slice(0, maxItems),
    total_count: values.length,
    returned_count: Math.min(values.length, maxItems),
    truncated: values.length > maxItems,
  };
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
  const nowMs = Date.now();
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
  const byWorkspace = summarizeUnkeptByWorkspace(effectiveUnkept, nowMs, args.max_items);
  const duplicateUrls = summarizeDuplicateUrls(effectiveUnkept, args.max_items);
  const oldUnkept = summarizeOldUnkept(effectiveUnkept, nowMs, args.old_after_minutes, args.max_items);
  const ok = effectiveUnkept.length <= args.max_unkept;
  const payload = {
    ok,
    check: "managed-tab-cleanup",
    registry_only: true,
    baseline_file: args.baseline_file || undefined,
    max_unkept: args.max_unkept,
    old_after_minutes: args.old_after_minutes,
    total_count: records.length,
    unkept_count: unkept.length,
    effective_unkept_count: effectiveUnkept.length,
    ignored_preexisting_unkept_count: ignoredUnkept,
    kept_count: kept.length,
    unkept: effectiveUnkept.slice(0, args.max_items).map((record) => ({
      ...managedTabPayload(record),
      age_minutes: ageMinutes(record, nowMs),
      suggested_arguments: suggestedFinalizeArguments(record),
      suggested_command: suggestedFinalizeText(record),
    })),
    unkept_returned_count: Math.min(effectiveUnkept.length, args.max_items),
    unkept_truncated: effectiveUnkept.length > args.max_items,
    unkept_by_workspace: byWorkspace.values,
    unkept_by_workspace_total_count: byWorkspace.total_count,
    unkept_by_workspace_returned_count: byWorkspace.returned_count,
    unkept_by_workspace_truncated: byWorkspace.truncated,
    duplicate_url_groups: duplicateUrls.values,
    duplicate_url_groups_total_count: duplicateUrls.total_count,
    duplicate_url_groups_returned_count: duplicateUrls.returned_count,
    duplicate_url_groups_truncated: duplicateUrls.truncated,
    old_unkept: oldUnkept.values,
    old_unkept_total_count: oldUnkept.total_count,
    old_unkept_returned_count: oldUnkept.returned_count,
    old_unkept_truncated: oldUnkept.truncated,
    remediation: effectiveUnkept.length > args.max_unkept
      ? "Run browser_tab_lifecycle action=finalize_task for each listed workspace_key/task_id; avoid scope=all unless the user explicitly confirmed cross-workspace cleanup."
      : "No unkept managed tabs exceed the configured threshold.",
  };
  if (args.json) {
    process.stdout.write(`${JSON.stringify(payload)}\n`);
  } else if (ok) {
    process.stdout.write(`managed_tab_cleanup=ok unkept=${effectiveUnkept.length} ignored_preexisting=${ignoredUnkept} kept=${kept.length} total=${records.length}\n`);
  } else {
    process.stderr.write(`managed_tab_cleanup=fail unkept=${effectiveUnkept.length} ignored_preexisting=${ignoredUnkept} kept=${kept.length} total=${records.length}\n`);
    process.stderr.write(payload.unkept
      .map((record) => `- ${record.tab_id} workspace=${record.workspace_key} age_min=${record.age_minutes ?? "unknown"} url=${record.url} suggested="${record.suggested_command}"`)
      .join("\n"));
    process.stderr.write(payload.unkept.length > 0 ? "\n" : "");
  }
  process.exitCode = ok ? 0 : 1;
}

await run();
