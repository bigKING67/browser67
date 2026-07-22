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
    managed: true,
    ownership_origin: String(input.ownership_origin ?? "agent_created"),
    close_on_finalize: input.close_on_finalize !== undefined
      ? input.close_on_finalize === true
      : input.ownership_origin !== "user_adopted",
    ownership_generation: String(input.ownership_generation ?? randomId("ownership")),
    owning_runtime_id: String(input.owning_runtime_id ?? ""),
    lease_id: String(input.lease_id ?? ""),
    lease_started_at: String(input.lease_started_at ?? ""),
    lease_renewed_at: String(input.lease_renewed_at ?? ""),
    lease_expires_at: String(input.lease_expires_at ?? ""),
    management_policy: typeof input.management_policy === "object" && input.management_policy !== null
      ? input.management_policy
      : undefined,
    management_policy_applied: input.management_policy_applied === true,
    management_policy_status: String(input.management_policy_status ?? ""),
    suspended: input.suspended === true,
    suspension_reason: String(input.suspension_reason ?? ""),
    adopted_document_identity: String(input.adopted_document_identity ?? ""),
    connection_generation: String(input.connection_generation ?? ""),
    observed_connection_generation: String(input.observed_connection_generation ?? ""),
    navigation_generation: Math.max(0, Number(input.navigation_generation ?? 0)),
    observed_navigation_generation: Math.max(0, Number(input.observed_navigation_generation ?? 0)),
    navigation_authorization_id: String(input.navigation_authorization_id ?? ""),
    navigation_authorized_until: String(input.navigation_authorized_until ?? ""),
    navigation_authorized_reason: String(input.navigation_authorized_reason ?? ""),
    last_navigation_actor: String(input.last_navigation_actor ?? ""),
    last_navigation_at: String(input.last_navigation_at ?? ""),
    observed_url: String(input.observed_url ?? url),
    observed_title: String(input.observed_title ?? input.title ?? ""),
    observed_at: String(input.observed_at ?? now),
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
    managed: true,
    ownership_origin: record.ownership_origin,
    close_on_finalize: record.close_on_finalize === true,
    ownership_generation: record.ownership_generation,
    owning_runtime_id: record.owning_runtime_id || undefined,
    lease_id: record.lease_id || undefined,
    lease_started_at: record.lease_started_at || undefined,
    lease_renewed_at: record.lease_renewed_at || undefined,
    lease_expires_at: record.lease_expires_at || undefined,
    management_policy: record.management_policy,
    management_policy_applied: record.management_policy_applied === true,
    management_policy_status: record.management_policy_status || undefined,
    suspended: record.suspended === true,
    suspension_reason: record.suspension_reason || undefined,
    adopted_document_identity: record.adopted_document_identity || undefined,
    connection_generation: record.connection_generation || undefined,
    observed_connection_generation: record.observed_connection_generation || undefined,
    navigation_generation: record.navigation_generation,
    observed_navigation_generation: record.observed_navigation_generation || undefined,
    navigation_authorization_id: record.navigation_authorization_id || undefined,
    navigation_authorized_until: record.navigation_authorized_until || undefined,
    navigation_authorized_reason: record.navigation_authorized_reason || undefined,
    last_navigation_actor: record.last_navigation_actor || undefined,
    last_navigation_at: record.last_navigation_at || undefined,
    observed_url: record.observed_url || undefined,
    observed_title: record.observed_title || undefined,
    observed_at: record.observed_at || undefined,
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
