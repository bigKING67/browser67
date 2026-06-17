import { nowIso, randomId } from "../common.mjs";
import {
  normalizeReuseKey,
  normalizeWorkspaceKey,
  parseUrlParts,
} from "./policy.mjs";

function buildManagedRecord(input = {}) {
  const url = String(input.url ?? "").trim() || "about:blank";
  const parts = parseUrlParts(url);
  const now = nowIso();
  return {
    tab_id: String(input.tab_id ?? input.tabId ?? "").trim() || randomId("tmwd_tab"),
    owner: "tmwd",
    source: String(input.source ?? "tmwd_browser").trim() || "tmwd_browser",
    task_id: String(input.task_id ?? input.taskId ?? "").trim(),
    workspace_key: String(input.workspace_key ?? input.workspaceKey ?? "").trim()
      || normalizeWorkspaceKey(input, url),
    reuse_key: String(input.reuse_key ?? input.reuseKey ?? "").trim()
      || normalizeReuseKey(input, url),
    url: parts.normalized_url,
    title: String(input.title ?? ""),
    origin: parts.origin,
    path_scope: String(input.path_scope ?? input.pathScope ?? "").trim() || parts.path_scope,
    keep: input.keep === true,
    dry_run: input.dry_run === true,
    status: String(input.status ?? "open").trim() || "open",
    created_at: String(input.created_at ?? now),
    updated_at: String(input.updated_at ?? now),
    last_used_at: String(input.last_used_at ?? now),
  };
}

function managedTabPayload(record) {
  return {
    tab_id: record.tab_id,
    owner: record.owner,
    source: record.source,
    task_id: record.task_id || undefined,
    workspace_key: record.workspace_key,
    reuse_key: record.reuse_key,
    url: record.url,
    title: record.title,
    origin: record.origin,
    path_scope: record.path_scope,
    keep: record.keep === true,
    dry_run: record.dry_run === true,
    status: record.status,
    created_at: record.created_at,
    updated_at: record.updated_at,
    last_used_at: record.last_used_at,
  };
}

function managedTabFinalizeHint(record, options = {}) {
  const payload = managedTabPayload(record);
  const includeAction = options.include_action !== false;
  const action = String(options.action ?? "finalize_task").trim() || "finalize_task";
  const tool = String(options.tool ?? "browser_tab_lifecycle").trim() || "browser_tab_lifecycle";
  const scopeArgs = payload.workspace_key
    ? { workspace_key: payload.workspace_key }
    : (payload.task_id ? { task_id: payload.task_id } : {});
  const suggestedArguments = {
    ...(includeAction ? { action } : {}),
    ...scopeArgs,
    prune_stale: true,
  };
  const dryRun = payload.dry_run === true;
  const kept = payload.keep === true;
  return {
    required: dryRun ? false : !kept,
    reason: dryRun
      ? "dry_run planned tab; no live cleanup is required until a tab is created"
      : (kept
        ? "managed tab is marked keep=true; finalize_task will preserve it"
        : "managed keep=false tab should be finalized before task end"),
    tool,
    action,
    cleanup_scope: payload.workspace_key ? "workspace" : (payload.task_id ? "task" : "unknown"),
    workspace_key: payload.workspace_key || undefined,
    task_id: payload.task_id || undefined,
    suggested_arguments: suggestedArguments,
    closes_only_managed_tabs: true,
    preserves_keep_true: true,
    ignores_unmanaged_user_tabs: true,
  };
}

function planManagedTab(input) {
  return buildManagedRecord({
    ...input,
    tab_id: input?.tab_id ?? input?.tabId ?? randomId("dry_tab"),
    dry_run: true,
    status: input?.status ?? "planned",
  });
}

export {
  buildManagedRecord,
  managedTabFinalizeHint,
  managedTabPayload,
  planManagedTab,
};
