import { createToolError } from "../errors.mjs";
import {
  listManagedTabRecords,
  managedTabPayload,
} from "../tab-workspace.mjs";
import {
  DEFAULT_LIST_MANAGED_MAX_ITEMS,
  limitedList,
  normalizeListManagedLimit,
} from "./tab-lifecycle-limits.mjs";

function resolveCloseScope(args = {}) {
  const taskId = String(args.task_id ?? args.taskId ?? "").trim();
  const workspaceKey = String(args.workspace_key ?? args.workspaceKey ?? "").trim();
  const scope = String(args.scope ?? "").trim().toLowerCase();
  const all = scope === "all" || args.all === true || args.confirm_all === true;
  if (!taskId && !workspaceKey && !all) {
    throw createToolError(
      "INVALID_ARGUMENT",
      "workspace_key or task_id is required when action=close_unkept; use scope=\"all\" to close all unkept managed tabs",
    );
  }
  return { taskId, workspaceKey, all, scope: all ? "all" : (workspaceKey ? "workspace" : "task") };
}

async function scopedManagedRecords(closeScope) {
  return listManagedTabRecords(closeScope.all
    ? {}
    : { task_id: closeScope.taskId, workspace_key: closeScope.workspaceKey });
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
  scopedManagedRecords,
  summarizeFinalizeRemainder,
};
