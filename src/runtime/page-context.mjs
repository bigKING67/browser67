import { listSessionsSnapshot, normalizeIdToken } from "./sessions/registry.mjs";
import { getManagedTab } from "../tab-workspace/registry.mjs";

const PAGE_CONTEXT_RESOLUTION = new Set(["confirmed", "inferred"]);

function firstObject(...values) {
  return values.find((value) => value && typeof value === "object" && !Array.isArray(value)) ?? null;
}

function firstText(...values) {
  for (const value of values) {
    const normalized = String(value ?? "").trim();
    if (normalized) return normalized;
  }
  return "";
}

function targetCandidate(data = {}) {
  return firstObject(
    data.page,
    data.target,
    data.context?.target,
    data.selected_target,
    data.tab,
    data.job?.target,
    data.job?.result?.target,
  );
}

function jobArgsCandidate(data = {}) {
  return firstObject(data.job?.execute_args, data.job?.args, data.execute_args);
}

function resolvePageId(args = {}, data = {}) {
  const target = targetCandidate(data);
  const jobArgs = jobArgsCandidate(data);
  return firstText(
    data.page?.tab_id,
    data.tab_id,
    data.target_id,
    target?.tab_id,
    target?.id,
    data.selected_tab_id,
    data.session_id,
    jobArgs?.tab_id,
    jobArgs?.switch_tab_id,
    jobArgs?.session_id,
    args.tab_id,
    args.switch_tab_id,
    args.session_id,
  );
}

function sessionForId(tabId, data = {}, sessionStore = null) {
  const dataSessions = Array.isArray(data.sessions) ? data.sessions : [];
  return dataSessions.find((session) => normalizeIdToken(session?.id ?? session?.tab_id) === tabId)
    ?? (sessionStore?.list({ include_disconnected: true })
      ?? listSessionsSnapshot({ include_disconnected: true }))
      .find((session) => normalizeIdToken(session?.id) === tabId)
    ?? null;
}

function normalizeManagement(record, data = {}) {
  const candidate = firstObject(data.page?.management, data.management, record);
  if (!candidate) {
    return {
      managed: false,
      ownership_origin: "unmanaged",
      policy_status: "not_applied",
      suspended: false,
    };
  }
  const managed = candidate.managed === true || candidate.owner === "tmwd";
  return {
    managed,
    ownership_origin: firstText(candidate.ownership_origin, managed ? "agent_created" : "unmanaged"),
    policy_status: firstText(
      candidate.policy_status,
      candidate.management_policy_status,
      candidate.management_policy_applied === true ? "applied" : "not_applied",
    ),
    suspended: candidate.suspended === true,
  };
}

async function resolvePageContext(_toolName, args = {}, data = {}, options = {}) {
  const resultTabId = resolvePageId({}, data);
  const tabId = resultTabId || resolvePageId(args, {});
  if (!tabId) return null;

  const target = targetCandidate(data);
  const session = typeof options.session_for_id === "function"
    ? options.session_for_id(tabId, data)
    : sessionForId(tabId, data, options.runtime?.sessionStore);
  let managedRecord = null;
  try {
    managedRecord = typeof options.get_managed_tab === "function"
      ? await options.get_managed_tab(tabId)
      : await getManagedTab(tabId);
  } catch {
    // Outcome presentation must never turn a completed tool call into a failure.
  }
  if (!resultTabId && !target && !session && !managedRecord) return null;
  const title = firstText(
    data.page?.title,
    target?.title,
    data.target_title,
    session?.title,
    managedRecord?.observed_title,
    managedRecord?.title,
  );
  const url = firstText(
    data.page?.url,
    target?.url,
    data.target_url,
    session?.url,
    managedRecord?.observed_url,
    managedRecord?.url,
  );
  const explicitResolution = firstText(data.page?.resolution);
  const resolution = PAGE_CONTEXT_RESOLUTION.has(explicitResolution)
    ? explicitResolution
    : (target || session || managedRecord ? "confirmed" : "inferred");
  const source = firstText(
    data.page?.source,
    target ? "selected_target" : "",
    resultTabId ? "tool_result" : "",
    session ? "session_registry" : "",
    managedRecord ? "managed_registry" : "",
    "managed_registry",
  );

  return {
    tab_id: tabId,
    title,
    url,
    source,
    resolution,
    management: normalizeManagement(managedRecord, data),
  };
}

export {
  resolvePageContext,
  resolvePageId,
};
