import { createToolError } from "../runtime/tool-errors.mjs";
import {
  listManagedTabRecords,
  managedTabPayload,
} from "../tab-workspace/index.mjs";
import {
  DEFAULT_LIST_MANAGED_MAX_ITEMS,
  limitedList,
  normalizeListManagedLimit,
} from "./tab-lifecycle-limits.mjs";

function resolveCloseScope(args = {}) {
  const taskId = String(args.task_id ?? args.taskId ?? "").trim();
  const workspaceKey = String(args.workspace_key ?? args.workspaceKey ?? "").trim();
  const browserInstanceId = String(
    args.browser_instance_id ?? args.browserInstanceId ?? "",
  ).trim();
  if (browserInstanceId && args.confirm_all_browser_instances === true) {
    throw createToolError(
      "INVALID_ARGUMENT",
      "browser_instance_id and confirm_all_browser_instances=true are mutually exclusive",
      { retryable: false },
    );
  }
  const scope = String(args.scope ?? "").trim().toLowerCase();
  const all = scope === "all" || args.all === true || args.confirm_all === true;
  if (!taskId && !workspaceKey && !all) {
    throw createToolError(
      "INVALID_ARGUMENT",
      "workspace_key or task_id is required when action=close_unkept; use scope=\"all\" to close all unkept managed tabs",
    );
  }
  return {
    taskId,
    workspaceKey,
    all,
    scope: all ? "all" : (workspaceKey ? "workspace" : "task"),
    browser_instance_id: browserInstanceId || undefined,
    all_browser_instances: args.confirm_all_browser_instances === true,
  };
}

async function scopedManagedRecords(closeScope) {
  return listManagedTabRecords({
    ...(closeScope.all
      ? {}
      : { task_id: closeScope.taskId, workspace_key: closeScope.workspaceKey }),
    ...(closeScope.browser_instance_id
      ? { browser_instance_id: closeScope.browser_instance_id }
      : {}),
  });
}

async function resolveBrowserInstanceScope(closeScope) {
  if (closeScope.browser_instance_id) {
    return { ...closeScope, browser_instance_scope: "explicit" };
  }
  const unboundScope = { ...closeScope, browser_instance_id: undefined };
  const records = await scopedManagedRecords(unboundScope);
  const browserInstanceIds = [...new Set(records
    .map((record) => String(record.browser_instance_id ?? "").trim())
    .filter(Boolean))].sort();
  if (browserInstanceIds.length <= 1) {
    return {
      ...closeScope,
      browser_instance_id: browserInstanceIds[0] || undefined,
      browser_instance_scope: browserInstanceIds.length === 1 ? "single" : "none",
    };
  }
  if (closeScope.all_browser_instances === true) {
    return { ...closeScope, browser_instance_scope: "confirmed_all" };
  }
  throw createToolError(
    "AMBIGUOUS_TARGET",
    "managed cleanup scope spans multiple Browser Instances; specify browser_instance_id or confirm_all_browser_instances=true",
    {
      retryable: false,
      details: { available_browser_instance_ids: browserInstanceIds },
    },
  );
}

function summarizeFinalizeRemainder(records, args = {}) {
  const summaryOnly = args?.summary_only === true;
  const maxItems = normalizeListManagedLimit(args?.max_items, DEFAULT_LIST_MANAGED_MAX_ITEMS);
  const kept = records.filter((record) => record.keep === true);
  const unkept = records.filter((record) => record.keep !== true);
  const returned = limitedList(records.map((record) => managedTabPayload(record)), maxItems, summaryOnly);
  return {
    total_count: records.length,
    kept_count: kept.length,
    unkept_count: unkept.length,
    tabs: returned.values,
    returned_count: returned.returned_count,
    truncated: returned.truncated,
  };
}

export {
  resolveCloseScope,
  resolveBrowserInstanceScope,
  scopedManagedRecords,
  summarizeFinalizeRemainder,
};
