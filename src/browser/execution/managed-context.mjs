import { createToolError } from "../../runtime/tool-errors.mjs";
import { resolveTmwdMode } from "../../runtime/config/endpoints.mjs";
import {
  browserConnectionGeneration,
  getManagedTab,
  reconcileAdoptedNavigation,
  updateManagedTab,
} from "../../tab-workspace/index.mjs";
import {
  authorizeManagedTabNavigation,
  readManagedTabPolicyStatus,
} from "../../tab-workspace/policy-bridge.mjs";

function scopeMatches(record, args = {}) {
  const workspaceKey = String(args.workspace_key ?? "").trim();
  const taskId = String(args.task_id ?? "").trim();
  if (workspaceKey && record.workspace_key !== workspaceKey) return false;
  if (taskId && record.task_id !== taskId) return false;
  return true;
}

function executionMayNavigate(value) {
  if (value && typeof value === "object") {
    const cmd = String(value.cmd ?? "").toLowerCase();
    const method = String(value.method ?? "").toLowerCase();
    if (cmd === "cdp" && ["page.navigate", "target.createtarget"].includes(method)) return true;
    if (cmd === "tabs" && ["create", "update"].includes(method)) return true;
    if (cmd === "batch") {
      return (Array.isArray(value.commands) ? value.commands : []).some((command) => executionMayNavigate(command));
    }
    return false;
  }
  const source = String(value ?? "");
  return /(?:\.click\s*\(|\.submit\s*\(|requestSubmit\s*\(|location(?:\.href)?\s*=|location\.(?:assign|replace)\s*\(|window\.open\s*\(|history\.(?:pushState|replaceState|go|back|forward)\s*\(|Input\.dispatchMouseEvent)/i.test(source);
}

async function assertManagedExecutionContext(preferred, args = {}, options = {}) {
  if (preferred?.transport === "cdp") {
    if (resolveTmwdMode(args.tmwd_mode) !== "cdp") {
      throw createToolError(
        "TMWD_REQUIRED",
        "raw execution may use CDP only when tmwd_mode=remote_cdp or cdp is explicit",
        { retryable: true },
      );
    }
    return { required: false, reason: "explicit_remote_cdp" };
  }
  const tabId = String(preferred?.context?.target?.id ?? "").trim();
  if (!tabId) {
    throw createToolError("TAB_NOT_FOUND", "browser execution did not resolve a target tab", {
      retryable: true,
    });
  }
  const lookup = options.get_managed_tab ?? getManagedTab;
  let record = await lookup(tabId);
  if (!record) {
    throw createToolError(
      "TAB_NOT_MANAGED",
      "raw browser execution requires an agent-created or explicitly adopted managed tab",
      {
        retryable: false,
        details: {
          tab_id: tabId,
          next_actions: ["browser_tab_lifecycle.inspect_adoption", "browser_tab_lifecycle.adopt_existing"],
        },
      },
    );
  }
  if (!scopeMatches(record, args)) {
    throw createToolError("MANAGED_TAB_SCOPE_MISMATCH", "managed tab belongs to another workspace or task", {
      retryable: false,
      details: {
        tab_id: tabId,
        workspace_key: record.workspace_key,
        task_id: record.task_id,
      },
    });
  }
  if (record.suspended === true) {
    throw createToolError("ADOPTED_TAB_SUSPENDED", "managed tab is suspended after an out-of-band change", {
      retryable: false,
      details: { tab_id: tabId, reason: record.suspension_reason || undefined },
    });
  }
  let navigationGuard = { status: "not_applicable" };
  if (record.ownership_origin === "user_adopted") {
    const readStatus = options.read_policy_status ?? readManagedTabPolicyStatus;
    const persistUpdate = options.update_managed_tab ?? updateManagedTab;
    const policyStatus = await readStatus(args, preferred, record, options);
    const reconciliation = reconcileAdoptedNavigation(record, {
      policy_status: policyStatus,
      connection_generation: browserConnectionGeneration(preferred),
      url: preferred.context?.target?.url,
      title: preferred.context?.target?.title,
    }, options);
    if (reconciliation.changed) {
      record = await persistUpdate(tabId, {
        ...reconciliation.record,
        touch: false,
      }) ?? reconciliation.record;
    } else {
      record = reconciliation.record;
    }
    navigationGuard = {
      status: reconciliation.status,
      reason: reconciliation.reason,
      navigation_generation: record.navigation_generation,
    };
  }
  if (record.suspended === true) {
    throw createToolError("ADOPTED_TAB_SUSPENDED", "managed tab is suspended after an out-of-band change", {
      retryable: false,
      details: { tab_id: tabId, reason: record.suspension_reason || navigationGuard.reason },
    });
  }
  return {
    required: true,
    tab_id: tabId,
    ownership_origin: record.ownership_origin,
    workspace_key: record.workspace_key,
    task_id: record.task_id,
    navigation_guard: navigationGuard,
  };
}

async function authorizeManagedExecutionNavigation(preferred, args = {}, reason = "agent_navigation", options = {}) {
  if (preferred?.transport === "cdp") {
    return { status: "not_applicable", authorized: false, reason: "explicit_remote_cdp" };
  }
  const tabId = String(preferred?.context?.target?.id ?? "").trim();
  const lookup = options.get_managed_tab ?? getManagedTab;
  const persistUpdate = options.update_managed_tab ?? updateManagedTab;
  const authorize = options.authorize_navigation ?? authorizeManagedTabNavigation;
  const record = await lookup(tabId);
  if (!record || record.ownership_origin !== "user_adopted") {
    return { status: "not_applicable", authorized: false };
  }
  if (!scopeMatches(record, args)) {
    throw createToolError("MANAGED_TAB_SCOPE_MISMATCH", "cannot authorize navigation for another scope", {
      retryable: false,
      details: { tab_id: tabId },
    });
  }
  if (record.suspended === true) {
    throw createToolError("ADOPTED_TAB_SUSPENDED", "cannot authorize navigation for a suspended adopted tab", {
      retryable: false,
      details: { tab_id: tabId, reason: record.suspension_reason || undefined },
    });
  }
  const authorization = await authorize(args, preferred, record, reason, options);
  if (authorization.authorized !== true) return authorization;
  await persistUpdate(tabId, {
    navigation_authorization_id: authorization.navigation_authorization_id,
    navigation_authorized_until: authorization.navigation_authorized_until,
    navigation_authorized_reason: authorization.navigation_authorized_reason,
    touch: false,
  });
  return {
    status: "authorized",
    authorized: true,
    navigation_authorization_id: authorization.navigation_authorization_id,
    navigation_authorized_until: authorization.navigation_authorized_until,
    navigation_authorized_reason: authorization.navigation_authorized_reason,
  };
}

export {
  authorizeManagedExecutionNavigation,
  assertManagedExecutionContext,
  executionMayNavigate,
  scopeMatches,
};
