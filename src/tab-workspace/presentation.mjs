import { createToolError } from "../runtime/tool-errors.mjs";

const FOCUS_POLICIES = Object.freeze([
  "background_only",
  "background_preferred",
  "foreground",
]);

const WINDOW_POLICIES = Object.freeze([
  "dedicated",
  "current",
]);

function normalizeEnum(value, supported, fallback, field) {
  const normalized = String(value ?? fallback).trim().toLowerCase() || fallback;
  if (!supported.includes(normalized)) {
    throw createToolError(
      "INVALID_ARGUMENT",
      `${field} must be one of ${supported.join(", ")}`,
      { details: { field, supported, received: value } },
    );
  }
  return normalized;
}

function normalizeFocusPolicy(value) {
  return normalizeEnum(value, FOCUS_POLICIES, "background_preferred", "focus_policy");
}

function normalizeWindowPolicy(value) {
  return normalizeEnum(value, WINDOW_POLICIES, "dedicated", "window_policy");
}

function normalizeWindowId(value) {
  if (value === undefined || value === null || value === "") return undefined;
  const number = Number(value);
  return Number.isInteger(number) && number >= 0 ? number : undefined;
}

function normalizeTabIdNumber(value) {
  if (value === undefined || value === null || value === "") return undefined;
  const number = Number(value);
  return Number.isInteger(number) && number >= 0 ? number : undefined;
}

function normalizeAgentWindowPresentation(data = {}) {
  const presentation = /** @type {Record<string, unknown>} */ (
    data && typeof data === "object" ? data : {}
  );
  return {
    mode: String(presentation.mode ?? "normal"),
    status: String(presentation.status ?? "unknown"),
    native_action_required: presentation.native_action_required === true,
    toolbar_preserved: presentation.toolbar_preserved === true,
    window_state: String(presentation.window_state ?? "unknown"),
  };
}

function normalizeAgentWindowFocusSnapshot(data = {}) {
  const snapshot = /** @type {Record<string, unknown>} */ (
    data && typeof data === "object" ? data : {}
  );
  return {
    window_id: normalizeWindowId(snapshot.window_id ?? snapshot.windowId),
    tab_id: normalizeTabIdNumber(snapshot.tab_id ?? snapshot.tabId),
    browser_focused: snapshot.browser_focused === true,
  };
}

function resolveManagedPresentation(args = {}, options = {}) {
  const focusPolicy = normalizeFocusPolicy(args.focus_policy);
  const requestedWindowPolicy = normalizeWindowPolicy(args.window_policy);
  const explicitRemoteCdp = ["remote_cdp", "cdp"].includes(String(args.tmwd_mode ?? ""));
  const tmwdTransport = ["tmwd_ws", "tmwd_link"].includes(String(options.transport ?? ""));
  const resolvedToTmwd = !options.transport || tmwdTransport;
  if (requestedWindowPolicy === "current" && !explicitRemoteCdp && resolvedToTmwd) {
    throw createToolError(
      "CURRENT_WINDOW_REQUIRES_ADOPTION",
      "window_policy=current cannot create or reuse managed tabs in an ordinary user window; use inspect_adoption -> adopt_existing for the exact user tab",
      {
        retryable: false,
        details: {
          window_policy: requestedWindowPolicy,
          required_flow: ["inspect_adoption", "adopt_existing"],
        },
      },
    );
  }
  if (focusPolicy === "foreground" && args.confirm_foreground !== true) {
    throw createToolError(
      "FOREGROUND_NOT_CONFIRMED",
      "focus_policy=foreground requires confirm_foreground=true because it intentionally leaves the Agent window visible",
      {
        retryable: false,
        details: {
          focus_policy: focusPolicy,
          required_confirmation: "confirm_foreground",
        },
      },
    );
  }
  const windowPolicy = explicitRemoteCdp || (options.transport && !tmwdTransport)
    ? "isolated_target"
    : requestedWindowPolicy;
  const activeExplicit = Object.prototype.hasOwnProperty.call(args, "active");
  if (focusPolicy === "background_only" && args.active === true) {
    throw createToolError(
      "INVALID_ARGUMENT",
      "active=true conflicts with focus_policy=background_only",
      { details: { focus_policy: focusPolicy, active: true } },
    );
  }
  return {
    focus_policy: focusPolicy,
    requested_window_policy: requestedWindowPolicy,
    window_policy: windowPolicy,
    active: focusPolicy === "foreground" || (activeExplicit && args.active === true),
    active_explicit: activeExplicit,
    foreground_requested: focusPolicy === "foreground",
    restore_focus: focusPolicy !== "foreground",
  };
}

function bridgeCommandData(result = {}) {
  const candidates = [
    result?.value?.data,
    result?.value,
    result?.raw?.data,
    result?.raw,
    result?.data,
    result,
  ];
  return candidates.find((candidate) => candidate && typeof candidate === "object") ?? {};
}

function agentWindowMetadata(result = {}) {
  const data = bridgeCommandData(result);
  const windowId = normalizeWindowId(data.window_id ?? data.windowId ?? data.id);
  const anchorTabId = normalizeTabIdNumber(
    data.anchor_tab_id ?? data.anchorTabId ?? data.anchor?.id ?? data.tabs?.[0]?.id,
  );
  if (windowId === undefined) {
    throw createToolError("AGENT_WINDOW_UNAVAILABLE", "browser67 agent window did not return a window id", {
      retryable: true,
      details: { status: data.status, reason: data.reason },
    });
  }
  return {
    status: String(data.status ?? "ready"),
    created: data.created === true,
    reused: data.reused === true,
    window_id: windowId,
    anchor_tab_id: anchorTabId,
    ownership_token: String(data.ownership_token ?? data.ownershipToken ?? "").trim(),
    anchor_url: String(data.anchor_url ?? data.anchorUrl ?? ""),
    browser_family: String(data.browser_family ?? data.browserFamily ?? "unknown"),
    platform_os: String(data.platform_os ?? data.platformOs ?? "unknown"),
    platform_arch: String(data.platform_arch ?? data.platformArch ?? "unknown"),
    focus_snapshot: normalizeAgentWindowFocusSnapshot(
      data.focus_snapshot ?? data.focusSnapshot,
    ),
    presentation: normalizeAgentWindowPresentation(data.presentation),
    focused: data.focused === true,
    ownership: "browser67_agent",
  };
}

function createdTabMetadata(result = {}) {
  const data = bridgeCommandData(result);
  const tabId = String(data.id ?? data.tabId ?? data.tab_id ?? "").trim();
  return {
    tab_id: tabId,
    window_id: normalizeWindowId(data.windowId ?? data.window_id),
    active: data.active === true,
    title: String(data.title ?? ""),
    url: String(data.url ?? ""),
  };
}

function managedWindowRecordFields(presentation, agentWindow = {}, tab = {}) {
  const windowPolicy = presentation?.window_policy ?? "dedicated";
  const dedicated = windowPolicy === "dedicated";
  return {
    focus_policy: presentation?.focus_policy ?? "background_preferred",
    window_policy: windowPolicy,
    window_id: normalizeWindowId(tab.window_id ?? agentWindow.window_id),
    window_ownership: dedicated
      ? "browser67_agent"
      : (windowPolicy === "isolated_target" ? "remote_cdp" : "current_user_window"),
    agent_window_anchor_tab_id: dedicated
      ? normalizeTabIdNumber(agentWindow.anchor_tab_id)
      : undefined,
    agent_window_created: dedicated && agentWindow.created === true,
    agent_window_ownership_token: dedicated
      ? String(agentWindow.ownership_token ?? "").trim()
      : undefined,
  };
}

export {
  FOCUS_POLICIES,
  WINDOW_POLICIES,
  agentWindowMetadata,
  bridgeCommandData,
  createdTabMetadata,
  managedWindowRecordFields,
  normalizeFocusPolicy,
  normalizeWindowId,
  normalizeWindowPolicy,
  resolveManagedPresentation,
};
