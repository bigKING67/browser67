import { createToolError } from "../errors.mjs";
import { resolvePreferredBrowserContext } from "../tmwd-runtime.mjs";
import { executeTmwdCommandWithPreferred } from "../browser-wrappers/shared.mjs";
import {
  createNavigationAuthorization,
  navigationStatusFromPolicy,
} from "./navigation-guard.mjs";

function normalizeManagementPolicy(policy = {}) {
  return {
    csp_override: policy.csp_override === "on" ? "on" : "off",
    dialog: policy.dialog === "capture" ? "capture" : "native",
    badge: policy.badge === "off" ? "off" : "managed",
    marker: policy.marker === "off" ? "off" : "managed",
  };
}

async function applyManagedTabPolicy(args, preferred, record, options = {}) {
  if (preferred.transport !== "tmwd_ws" && preferred.transport !== "tmwd_link") {
    return {
      status: "not_applicable",
      applied: false,
      transport: preferred.transport,
      policy: normalizeManagementPolicy(record.management_policy),
    };
  }
  const command = await executeTmwdCommandWithPreferred(args, preferred, {
    cmd: "policy",
    method: "apply",
    tabId: record.tab_id,
    ownershipGeneration: record.ownership_generation,
    leaseId: record.lease_id,
    leaseExpiresAt: record.lease_expires_at,
    previousOwnershipGeneration: options.previous_record?.ownership_generation,
    previousLeaseId: options.previous_record?.lease_id,
    policy: normalizeManagementPolicy(record.management_policy),
  });
  if (command.value?.managed !== true) {
    throw createToolError("MANAGED_POLICY_UNAVAILABLE", "extension did not confirm managed policy application", {
      retryable: true,
      details: command.value,
    });
  }
  return {
    status: options.renew === true ? "renewed" : "applied",
    applied: true,
    transport: command.transport,
    transport_attempts: command.transport_attempts,
    policy: normalizeManagementPolicy(record.management_policy),
    page_frame_count: command.value.page_frame_count,
    content_bridge: command.value.content_bridge === true,
    navigation_state: navigationStatusFromPolicy(command.value),
  };
}

async function readManagedTabPolicyStatus(args, preferred, record) {
  if (preferred.transport !== "tmwd_ws" && preferred.transport !== "tmwd_link") {
    throw createToolError("MANAGED_POLICY_UNAVAILABLE", "managed policy status requires TMWD transport", {
      retryable: true,
      details: { transport: preferred.transport },
    });
  }
  const command = await executeTmwdCommandWithPreferred(args, preferred, {
    cmd: "policy",
    method: "status",
    tabId: record.tab_id,
  });
  if (command.value?.managed !== true) {
    throw createToolError("MANAGED_POLICY_UNAVAILABLE", "extension has no active policy for adopted tab", {
      retryable: true,
      details: command.value,
    });
  }
  return {
    ...command.value,
    transport: command.transport,
    transport_attempts: command.transport_attempts,
  };
}

async function authorizeManagedTabNavigation(args, preferred, record, reason, options = {}) {
  if (record.ownership_origin !== "user_adopted") {
    return { status: "not_applicable", authorized: false };
  }
  const authorization = createNavigationAuthorization(record, reason, options);
  const command = await executeTmwdCommandWithPreferred(args, preferred, {
    cmd: "policy",
    method: "authorize_navigation",
    tabId: record.tab_id,
    ownershipGeneration: record.ownership_generation,
    leaseId: record.lease_id,
    authorizationId: authorization.navigation_authorization_id,
    authorizedUntil: authorization.navigation_authorized_until,
    reason: authorization.navigation_authorized_reason,
  });
  if (
    command.value?.navigation_authorization_id !== authorization.navigation_authorization_id
    || command.value?.ownership_generation !== record.ownership_generation
    || command.value?.lease_id !== record.lease_id
  ) {
    throw createToolError("NAVIGATION_AUTHORIZATION_FAILED", "extension did not confirm navigation authorization", {
      retryable: true,
      details: command.value,
    });
  }
  return {
    status: "authorized",
    authorized: true,
    ...authorization,
    transport: command.transport,
    transport_attempts: command.transport_attempts,
  };
}

async function releaseManagedTabPolicy(args, record) {
  if (record.management_policy_applied !== true) {
    return {
      status: "not_applied",
      restored: false,
      note: "No extension policy application was recorded for this ownership lease.",
    };
  }
  try {
    const preferred = await resolvePreferredBrowserContext({
      ...args,
      switch_tab_id: record.tab_id,
      session_id: record.tab_id,
    });
    if (preferred.transport !== "tmwd_ws" && preferred.transport !== "tmwd_link") {
      return {
        status: "not_applicable",
        restored: false,
        transport: preferred.transport,
      };
    }
    const command = await executeTmwdCommandWithPreferred(args, preferred, {
      cmd: "policy",
      method: "release",
      tabId: record.tab_id,
      ownershipGeneration: record.ownership_generation,
      leaseId: record.lease_id,
    });
    if (command.value?.managed !== false) {
      throw new Error("extension did not confirm managed=false");
    }
    return {
      status: "restored",
      restored: true,
      transport: command.transport,
      transport_attempts: command.transport_attempts,
      page_frame_count: command.value.page_frame_count,
    };
  } catch (error) {
    return {
      status: "release_failed",
      restored: false,
      error: String(error?.message ?? error),
      lease_expiry_fallback: record.lease_expires_at || undefined,
    };
  }
}

export {
  applyManagedTabPolicy,
  authorizeManagedTabNavigation,
  normalizeManagementPolicy,
  readManagedTabPolicyStatus,
  releaseManagedTabPolicy,
};
