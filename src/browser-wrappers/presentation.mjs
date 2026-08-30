import { createToolError } from "../runtime/tool-errors.mjs";
import { ensureNativeAgentWindowPresentation } from "../native/agent-window-presentation.mjs";
import {
  agentWindowMetadata,
  bridgeCommandData,
  createdTabMetadata,
} from "../tab-workspace/presentation.mjs";

async function ensureAgentWindow(presentation, runCommand, options = {}) {
  if (presentation.window_policy !== "dedicated") {
    return {
      status: "not_applicable",
      created: false,
      reused: false,
      ownership: presentation.window_policy === "isolated_target"
        ? "remote_cdp"
        : "current_user_window",
    };
  }
  const agentWindow = agentWindowMetadata(await runCommand({
    cmd: "window",
    method: "ensure_agent_window",
  }));
  const ensurePresentation = options.ensure_agent_window_presentation
    ?? ensureNativeAgentWindowPresentation;
  const actualPresentation = await ensurePresentation(
    agentWindow,
    options.agent_window_presentation,
  );
  if (actualPresentation?.verification_required === true) {
    const verifiedWindow = agentWindowMetadata(await runCommand({
      cmd: "window",
      method: "ensure_agent_window",
    }));
    if (
      verifiedWindow.presentation?.mode !== "macos_native_fullscreen_space"
      || verifiedWindow.presentation?.status !== "ready"
      || verifiedWindow.presentation?.native_action_required === true
      || verifiedWindow.presentation?.window_state !== "fullscreen"
    ) {
      return {
        ...verifiedWindow,
        presentation: {
          ...actualPresentation,
          status: "failed",
          native_action_required: true,
          verification_required: false,
          reason: "extension_window_state_not_fullscreen",
          error: `Agent window state remained ${String(verifiedWindow.presentation?.window_state ?? "unknown")}`,
        },
      };
    }
    return {
      ...verifiedWindow,
      presentation: {
        ...actualPresentation,
        ...verifiedWindow.presentation,
        status: "ready",
        native_action_required: false,
        native_fullscreen: true,
        verification_required: false,
        verification: "exact_extension_window_state",
      },
    };
  }
  return {
    ...agentWindow,
    presentation: actualPresentation,
  };
}

async function resolveCreatedTab(result, runCommand) {
  let metadata = createdTabMetadata(result);
  if (!metadata.tab_id) {
    throw createToolError("EXECUTION_ERROR", "managed tab create did not return tab id");
  }
  if (metadata.window_id === undefined) {
    const getResult = await runCommand({
      cmd: "tabs",
      method: "get",
      tabId: metadata.tab_id,
    });
    metadata = {
      ...metadata,
      ...createdTabMetadata(getResult),
      tab_id: metadata.tab_id,
    };
  }
  return metadata;
}

function isMissingTabError(error) {
  return /(?:no\s+tab\s+with\s+id|tab(?:\s+id)?\s+not\s+found|invalid\s+tab\s+id)/i
    .test(String(error?.message ?? error));
}

async function inspectReusableManagedTabPresentation(
  presentation,
  agentWindow,
  record,
  runCommand,
) {
  if (presentation?.window_policy !== "dedicated") {
    return {
      checked: false,
      reusable: true,
      reason: "window_policy_not_dedicated",
    };
  }
  const expectedWindowId = Number(agentWindow?.window_id);
  if (!Number.isInteger(expectedWindowId) || expectedWindowId < 0) {
    throw createToolError(
      "AGENT_WINDOW_UNAVAILABLE",
      "dedicated managed-tab reuse requires a verified Agent window id",
      { retryable: true },
    );
  }
  let currentTab;
  try {
    currentTab = createdTabMetadata(await runCommand({
      cmd: "tabs",
      method: "get",
      tabId: String(record?.tab_id ?? ""),
    }));
  } catch (error) {
    if (isMissingTabError(error)) {
      return {
        checked: true,
        reusable: false,
        reason: "tab_unavailable",
        record_action: "delete",
        expected_window_id: expectedWindowId,
      };
    }
    throw createToolError(
      "AGENT_WINDOW_UNAVAILABLE",
      "could not verify that a reusable managed tab is still inside the Agent window",
      {
        retryable: true,
        details: {
          tab_id: String(record?.tab_id ?? ""),
          expected_window_id: expectedWindowId,
          error: String(error?.message ?? error),
        },
      },
    );
  }
  if (!currentTab.tab_id || currentTab.window_id === undefined) {
    throw createToolError(
      "AGENT_WINDOW_UNAVAILABLE",
      "managed-tab window inspection returned incomplete tab identity",
      {
        retryable: true,
        details: {
          tab_id: String(record?.tab_id ?? ""),
          expected_window_id: expectedWindowId,
        },
      },
    );
  }
  if (currentTab.window_id !== expectedWindowId) {
    return {
      checked: true,
      reusable: false,
      reason: "outside_agent_window",
      record_action: "quarantine",
      expected_window_id: expectedWindowId,
      actual_window_id: currentTab.window_id,
    };
  }
  return {
    checked: true,
    reusable: true,
    reason: "agent_window_match",
    expected_window_id: expectedWindowId,
    actual_window_id: currentTab.window_id,
  };
}

function focusLeaseData(result = {}) {
  const data = bridgeCommandData(result);
  if (data?.status === undefined && data?.lease_id === undefined) {
    throw createToolError("FOCUS_LEASE_FAILED", "browser67 focus command returned no lease state", {
      retryable: true,
    });
  }
  return data;
}

async function acquireManagedFocusLease(args, tabId, runCommand, options = {}) {
  if (String(args?.focus_policy ?? "background_preferred") === "background_only") {
    throw createToolError(
      "FOREGROUND_REQUIRED",
      "this operation requires temporary foreground focus but focus_policy=background_only",
      { retryable: false, details: { tab_id: String(tabId) } },
    );
  }
  const restore = options.restore ?? String(args?.focus_policy ?? "background_preferred") !== "foreground";
  return focusLeaseData(await runCommand({
    cmd: "focus",
    method: "acquire",
    tabId: String(tabId),
    restore,
    ttlMs: options.ttl_ms ?? args?.focus_lease_timeout_ms ?? args?.timeout_ms,
  }));
}

async function releaseManagedFocusLease(lease, runCommand, reason = "operation_complete") {
  const leaseId = String(lease?.lease_id ?? "").trim();
  if (!leaseId) return { status: "not_active", restored: false };
  try {
    return focusLeaseData(await runCommand({
      cmd: "focus",
      method: "release",
      leaseId,
      reason,
    }));
  } catch (error) {
    return {
      status: "release_failed",
      restored: false,
      error: String(error?.message ?? error),
    };
  }
}

async function foregroundManagedTab(presentation, args, tabId, runCommand) {
  if (presentation.foreground_requested !== true) return undefined;
  const lease = await acquireManagedFocusLease(
    { ...args, focus_policy: "foreground" },
    tabId,
    runCommand,
    { restore: false },
  );
  const release = await releaseManagedFocusLease(lease, runCommand, "foreground_entry_complete");
  return { lease, release };
}

export {
  acquireManagedFocusLease,
  ensureAgentWindow,
  foregroundManagedTab,
  inspectReusableManagedTabPresentation,
  releaseManagedFocusLease,
  resolveCreatedTab,
};
