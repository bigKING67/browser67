import { nowIso, randomId } from "../common.mjs";
import { cdpRunCommand } from "../cdp-runtime.mjs";
import { createToolError } from "../errors.mjs";
import { resolvePreferredBrowserContext } from "../tmwd-runtime.mjs";
import {
  executeTmwdCommandWithPreferred,
  readBrowserTabById,
  sleep,
} from "../browser-wrappers/shared.mjs";
import {
  deleteManagedTab,
  browserConnectionGeneration,
  browserDocumentIdentity,
  getManagedTab,
  listManagedTabRecords,
  managedTabPayload,
  recordManagedTab,
  updateManagedTab,
} from "../tab-workspace.mjs";
import {
  applyManagedTabPolicy,
  normalizeManagementPolicy,
  releaseManagedTabPolicy,
} from "./policy-bridge.mjs";

const ADOPTION_TOKEN_TTL_MS = 60_000;
const CLOSE_TOKEN_TTL_MS = 30_000;
const ADOPTION_LEASE_MS = 10 * 60_000;
const ADOPTION_RENEW_MS = 60_000;
const RUNTIME_ID = randomId("runtime");
const adoptionTokens = new Map();
const closeTokens = new Map();

function normalizedScope(args = {}) {
  const workspaceKey = String(args.workspace_key ?? "").trim();
  const taskId = String(args.task_id ?? "").trim();
  if (!workspaceKey || !taskId) {
    throw createToolError(
      "INVALID_ARGUMENT",
      "workspace_key and task_id are required for adopted tab ownership",
      { retryable: false },
    );
  }
  return { workspace_key: workspaceKey, task_id: taskId };
}

function sameScope(record, scope) {
  return record?.workspace_key === scope.workspace_key && record?.task_id === scope.task_id;
}

function targetId(target = {}) {
  return String(target.id ?? target.tab_id ?? target.tabId ?? target.targetId ?? "").trim();
}

function findTarget(preferred, tabId) {
  const targets = Array.isArray(preferred?.context?.targets) ? preferred.context.targets : [];
  return targets.find((target) => targetId(target) === tabId) ?? null;
}

function routeArguments(args = {}) {
  return Object.fromEntries(Object.entries(args).filter(([key]) => (
    key.startsWith("tmwd_")
    || key === "cdp_endpoint"
    || key === "timeout_ms"
    || key === "include_disconnected"
  )));
}

function purgeExpiredTokens() {
  const now = Date.now();
  for (const [token, entry] of adoptionTokens) {
    if (entry.expires_at_ms <= now) adoptionTokens.delete(token);
  }
  for (const [token, entry] of closeTokens) {
    if (entry.expires_at_ms <= now) closeTokens.delete(token);
  }
}

async function closeAdoptedTab(routeArgs, record) {
  const preferred = await resolvePreferredBrowserContext({
    ...routeArgs,
    switch_tab_id: record.tab_id,
  });
  let transport = "cdp";
  if (preferred.transport === "tmwd_ws" || preferred.transport === "tmwd_link") {
    const result = await executeTmwdCommandWithPreferred(routeArgs, preferred, {
      cmd: "tabs",
      method: "close",
      tabId: record.tab_id,
    });
    if (result.value?.closed !== true) {
      throw createToolError("EXECUTION_ERROR", "tabs.close did not confirm closed=true", {
        retryable: true,
      });
    }
    transport = result.transport;
  } else {
    await cdpRunCommand({ ...routeArgs, switch_tab_id: record.tab_id }, "Target.closeTarget", {
      targetId: record.tab_id,
    });
  }
  const startedAt = Date.now();
  do {
    const live = await readBrowserTabById(routeArgs, preferred, record.tab_id);
    if (!live) {
      return { closed: true, close_verified: true, transport };
    }
    await sleep(100);
  } while (Date.now() - startedAt < 1_500);
  throw createToolError("EXECUTION_ERROR", "adopted tab remained visible after close", {
    retryable: true,
  });
}

async function inspectAdoption(args = {}) {
  purgeExpiredTokens();
  const scope = normalizedScope(args);
  const tabId = String(args.tab_id ?? "").trim();
  if (!tabId) {
    throw createToolError("INVALID_ARGUMENT", "tab_id is required when action=inspect_adoption");
  }
  const existing = await getManagedTab(tabId);
  if (existing && !sameScope(existing, scope)) {
    throw createToolError("TAB_OWNED_BY_OTHER_SCOPE", "tab is owned by another workspace/task", {
      retryable: false,
      details: { tab_id: tabId, ownership_origin: existing.ownership_origin },
    });
  }
  if (existing?.ownership_origin === "agent_created") {
    throw createToolError("TAB_ALREADY_MANAGED", "agent-created tab is already managed", {
      retryable: false,
    });
  }
  const preferred = await resolvePreferredBrowserContext({ ...args, switch_tab_id: tabId });
  const target = findTarget(preferred, tabId);
  if (!target) {
    throw createToolError("TAB_NOT_AVAILABLE", "adoption target is not present in the live browser", {
      retryable: true,
      details: { tab_id: tabId },
    });
  }
  const token = randomId("adopt");
  const expiresAtMs = Date.now() + ADOPTION_TOKEN_TTL_MS;
  adoptionTokens.set(token, {
    token,
    tab_id: tabId,
    scope,
    document_identity: browserDocumentIdentity(target),
    connection_generation: browserConnectionGeneration(preferred),
    ownership_generation: existing?.ownership_generation ?? "unmanaged",
    route_args: routeArguments(args),
    expires_at_ms: expiresAtMs,
  });
  return {
    status: "success",
    action: "inspect_adoption",
    adoption_token: token,
    expires_at: new Date(expiresAtMs).toISOString(),
    target: {
      tab_id: tabId,
      url: String(target.url ?? ""),
      title: String(target.title ?? ""),
    },
    current_ownership: existing ? managedTabPayload(existing) : {
      managed: false,
      ownership_origin: "user_unmanaged",
    },
    requires_user_confirmation: true,
    limitations: [
      "The token proves target identity and freshness; user consent remains a host workflow boundary.",
      "The current document is not reloaded during adoption.",
    ],
  };
}

async function adoptExisting(args = {}) {
  purgeExpiredTokens();
  if (args.confirm_adopt !== true) {
    throw createToolError("ADOPTION_NOT_CONFIRMED", "adopt_existing requires confirm_adopt=true", {
      retryable: false,
    });
  }
  const tokenValue = String(args.adoption_token ?? "").trim();
  const token = adoptionTokens.get(tokenValue);
  if (!token) {
    throw createToolError("ADOPTION_TOKEN_EXPIRED", "adoption token is missing or expired", {
      retryable: false,
    });
  }
  adoptionTokens.delete(tokenValue);
  if (token.expires_at_ms <= Date.now()) {
    throw createToolError("ADOPTION_TOKEN_EXPIRED", "adoption token expired", { retryable: false });
  }
  const existing = await getManagedTab(token.tab_id);
  if (existing && !sameScope(existing, token.scope)) {
    throw createToolError("TAB_OWNED_BY_OTHER_SCOPE", "tab is owned by another workspace/task", {
      retryable: false,
    });
  }
  if ((existing?.ownership_generation ?? "unmanaged") !== token.ownership_generation) {
    throw createToolError("ADOPTION_TARGET_CHANGED", "tab ownership changed after adoption inspection", {
      retryable: false,
    });
  }
  const preferred = await resolvePreferredBrowserContext({
    ...token.route_args,
    switch_tab_id: token.tab_id,
  });
  const target = findTarget(preferred, token.tab_id);
  if (
    !target
    || browserDocumentIdentity(target) !== token.document_identity
    || browserConnectionGeneration(preferred) !== token.connection_generation
  ) {
    throw createToolError("ADOPTION_TARGET_CHANGED", "tab document or connection changed after adoption inspection", {
      retryable: false,
    });
  }
  const now = nowIso();
  const leaseId = randomId("lease");
  const candidate = {
    tab_id: token.tab_id,
    url: String(target.url ?? "about:blank"),
    title: String(target.title ?? ""),
    workspace_key: token.scope.workspace_key,
    task_id: token.scope.task_id,
    source: "user_adoption",
    ownership_origin: "user_adopted",
    close_on_finalize: false,
    owning_runtime_id: RUNTIME_ID,
    lease_id: leaseId,
    lease_started_at: now,
    lease_renewed_at: now,
    lease_expires_at: new Date(Date.now() + ADOPTION_LEASE_MS).toISOString(),
    management_policy: normalizeManagementPolicy(args.policy),
    suspended: false,
    suspension_reason: "",
    adopted_document_identity: token.document_identity,
    connection_generation: token.connection_generation,
    observed_url: String(target.url ?? ""),
    observed_title: String(target.title ?? ""),
    observed_at: now,
    ownership_generation: randomId("ownership"),
  };
  let policyApplication;
  try {
    policyApplication = await applyManagedTabPolicy(token.route_args, preferred, candidate, {
      previous_record: existing,
    });
  } catch (error) {
    await releaseManagedTabPolicy(token.route_args, {
      ...candidate,
      management_policy_applied: true,
    });
    throw error;
  }
  const record = await recordManagedTab({
    ...candidate,
    management_policy_applied: policyApplication.applied === true,
    management_policy_status: policyApplication.status,
    navigation_generation: policyApplication.navigation_state?.navigation_generation ?? 0,
    last_navigation_actor: policyApplication.navigation_state?.last_navigation_actor ?? "none",
    last_navigation_at: policyApplication.navigation_state?.last_navigation_at ?? "",
  });
  return {
    status: "success",
    action: "adopt_existing",
    adopted: true,
    reloaded: false,
    managed_tab: managedTabPayload(record),
    lease: {
      lease_id: leaseId,
      expires_at: record.lease_expires_at,
      renew_interval_ms: ADOPTION_RENEW_MS,
    },
    policy_application: {
      ...policyApplication,
      policy: record.management_policy,
    },
  };
}

async function releaseAdopted(args = {}, options = {}) {
  const scope = options.scope ?? normalizedScope(args);
  const tabId = String(args.tab_id ?? "").trim();
  const record = await getManagedTab(tabId);
  if (!record || record.ownership_origin !== "user_adopted") {
    return {
      status: "success",
      action: "release_adopted",
      released: false,
      tab_id: tabId,
      note: "tab is not user-adopted",
    };
  }
  if (!sameScope(record, scope)) {
    throw createToolError("TAB_OWNED_BY_OTHER_SCOPE", "cannot release another scope's adopted tab", {
      retryable: false,
    });
  }
  if (options.ignore_lease !== true && String(args.lease_id ?? "") !== record.lease_id) {
    throw createToolError("ADOPTION_LEASE_MISMATCH", "release_adopted requires the active lease_id", {
      retryable: false,
    });
  }
  const policyRelease = await releaseManagedTabPolicy(args, record);
  await deleteManagedTab(tabId);
  return {
    status: "success",
    action: "release_adopted",
    released: true,
    closed: false,
    tab_id: tabId,
    ownership_origin: "user_unmanaged",
    policy_release: policyRelease,
  };
}

async function inspectCloseAdopted(args = {}) {
  purgeExpiredTokens();
  const scope = normalizedScope(args);
  const tabId = String(args.tab_id ?? "").trim();
  const record = await getManagedTab(tabId);
  if (!record || record.ownership_origin !== "user_adopted") {
    throw createToolError("TAB_NOT_ADOPTED", "tab is not user-adopted", { retryable: false });
  }
  if (!sameScope(record, scope)) {
    throw createToolError("TAB_OWNED_BY_OTHER_SCOPE", "cannot close another scope's adopted tab", {
      retryable: false,
    });
  }
  const closeToken = randomId("close_adopted");
  const expiresAtMs = Date.now() + CLOSE_TOKEN_TTL_MS;
  closeTokens.set(closeToken, {
    tab_id: tabId,
    scope,
    ownership_generation: record.ownership_generation,
    lease_id: record.lease_id,
    route_args: routeArguments(args),
    expires_at_ms: expiresAtMs,
  });
  return {
    status: "success",
    action: "inspect_close_adopted",
    close_token: closeToken,
    expires_at: new Date(expiresAtMs).toISOString(),
    target: managedTabPayload(record),
    requires_user_confirmation: true,
  };
}

async function closeAdopted(args = {}) {
  purgeExpiredTokens();
  if (args.close_adopted !== true || args.confirm_close_adopted !== true) {
    throw createToolError(
      "ADOPTED_CLOSE_NOT_CONFIRMED",
      "close_adopted requires close_adopted=true and confirm_close_adopted=true",
      { retryable: false },
    );
  }
  const tokenValue = String(args.close_token ?? "").trim();
  const token = closeTokens.get(tokenValue);
  if (!token || token.expires_at_ms <= Date.now()) {
    closeTokens.delete(tokenValue);
    throw createToolError("CLOSE_TOKEN_EXPIRED", "adopted close token is missing or expired", {
      retryable: false,
    });
  }
  closeTokens.delete(tokenValue);
  const record = await getManagedTab(token.tab_id);
  if (
    !record
    || record.ownership_origin !== "user_adopted"
    || !sameScope(record, token.scope)
    || record.ownership_generation !== token.ownership_generation
    || record.lease_id !== token.lease_id
  ) {
    throw createToolError("ADOPTION_TARGET_CHANGED", "adopted tab ownership changed before close", {
      retryable: false,
    });
  }
  const result = await closeAdoptedTab(token.route_args, record);
  await deleteManagedTab(record.tab_id);
  return {
    status: "success",
    action: "close_adopted",
    closed: true,
    close_verified: result.close_verified === true,
    tab_id: record.tab_id,
    transport: result.transport,
  };
}

async function releaseExpiredAdoptions() {
  const now = Date.now();
  const records = await listManagedTabRecords();
  const released = [];
  for (const record of records) {
    if (
      record.ownership_origin === "user_adopted"
      && record.lease_expires_at
      && Date.parse(record.lease_expires_at) <= now
    ) {
      const policyRelease = await releaseManagedTabPolicy({}, record);
      await deleteManagedTab(record.tab_id);
      released.push({
        tab_id: record.tab_id,
        workspace_key: record.workspace_key,
        task_id: record.task_id,
        reason: "released_after_runtime_loss",
        closed: false,
        policy_release: policyRelease,
      });
    }
  }
  return released;
}

async function renewOwnedAdoptions() {
  const records = await listManagedTabRecords();
  const now = nowIso();
  for (const record of records.filter((record) => (
      record.ownership_origin === "user_adopted"
      && record.owning_runtime_id === RUNTIME_ID
    ))) {
    const updated = await updateManagedTab(record.tab_id, {
      lease_renewed_at: now,
      lease_expires_at: new Date(Date.now() + ADOPTION_LEASE_MS).toISOString(),
      touch: false,
    });
    if (!updated || updated.management_policy_applied !== true) continue;
    try {
      const preferred = await resolvePreferredBrowserContext({ switch_tab_id: updated.tab_id });
      await applyManagedTabPolicy({}, preferred, updated, { renew: true });
      await updateManagedTab(updated.tab_id, { management_policy_status: "renewed", touch: false });
    } catch {
      await updateManagedTab(updated.tab_id, {
        management_policy_status: "renewal_failed",
        suspended: true,
        touch: false,
      });
    }
  }
}

const renewalTimer = setInterval(() => {
  renewOwnedAdoptions().catch(() => {});
}, ADOPTION_RENEW_MS);
renewalTimer.unref?.();

async function disposeAdoptionRuntime() {
  clearInterval(renewalTimer);
  const records = await listManagedTabRecords();
  const owned = records.filter((record) => (
    record.ownership_origin === "user_adopted"
    && record.owning_runtime_id === RUNTIME_ID
  ));
  const released = [];
  for (const record of owned) {
    released.push(await releaseAdopted({
      tab_id: record.tab_id,
      workspace_key: record.workspace_key,
      task_id: record.task_id,
    }, {
      scope: { workspace_key: record.workspace_key, task_id: record.task_id },
      ignore_lease: true,
    }));
  }
  adoptionTokens.clear();
  closeTokens.clear();
  return released;
}

export {
  ADOPTION_LEASE_MS,
  ADOPTION_RENEW_MS,
  ADOPTION_TOKEN_TTL_MS,
  adoptExisting,
  closeAdopted,
  disposeAdoptionRuntime,
  inspectAdoption,
  inspectCloseAdopted,
  releaseAdopted,
  releaseExpiredAdoptions,
};
