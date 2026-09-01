import { createToolError } from "../runtime/tool-errors.mjs";
import { listManagedTabRecords } from "./registry.mjs";

const DEFAULT_MANAGED_TAB_SCOPE_LIMIT = 8;
const MAX_MANAGED_TAB_SCOPE_LIMIT = 64;

function managedTabScopeLimit(raw = process.env.BROWSER67_MANAGED_TAB_SCOPE_LIMIT) {
  const value = Number(raw ?? DEFAULT_MANAGED_TAB_SCOPE_LIMIT);
  if (!Number.isFinite(value)) return DEFAULT_MANAGED_TAB_SCOPE_LIMIT;
  return Math.max(1, Math.min(MAX_MANAGED_TAB_SCOPE_LIMIT, Math.floor(value)));
}

function evaluateManagedTabCapacity(records = [], ownership = {}, options = {}) {
  const limit = managedTabScopeLimit(options.limit);
  const scoped = records.filter((record) => (
    record?.status !== "closed"
    && record?.keep !== true
    && (!ownership.workspace_key || record.workspace_key === ownership.workspace_key)
    && (!ownership.task_id || record.task_id === ownership.task_id)
    && (!ownership.browser_instance_id || record.browser_instance_id === ownership.browser_instance_id)
  ));
  const confirmedOverflow = options.confirm_overflow === true;
  return {
    allowed: scoped.length < limit || confirmedOverflow,
    confirmed_overflow: confirmedOverflow,
    open_unkept_count: scoped.length,
    limit,
    workspace_key: ownership.workspace_key || undefined,
    task_id: ownership.task_id || undefined,
    browser_instance_id: ownership.browser_instance_id || undefined,
  };
}

async function assertManagedTabCapacity(ownership = {}, options = {}) {
  const records = await listManagedTabRecords({
    ...(ownership.workspace_key ? { workspace_key: ownership.workspace_key } : {}),
    ...(ownership.task_id ? { task_id: ownership.task_id } : {}),
    ...(ownership.browser_instance_id ? { browser_instance_id: ownership.browser_instance_id } : {}),
  });
  const capacity = evaluateManagedTabCapacity(records, ownership, options);
  if (!capacity.allowed) {
    throw createToolError(
      "MANAGED_TAB_LIMIT_REACHED",
      "managed tab scope limit reached; finalize or prune the exact task scope before creating another tab",
      {
        retryable: false,
        details: {
          ...capacity,
          next_action: "browser_tab_lifecycle.finalize_task",
          override_confirmation: "confirm_managed_tab_overflow",
        },
      },
    );
  }
  return capacity;
}

export {
  DEFAULT_MANAGED_TAB_SCOPE_LIMIT,
  MAX_MANAGED_TAB_SCOPE_LIMIT,
  assertManagedTabCapacity,
  evaluateManagedTabCapacity,
  managedTabScopeLimit,
};
