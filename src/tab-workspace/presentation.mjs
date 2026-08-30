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

function resolveManagedPresentation(args = {}, options = {}) {
  const focusPolicy = normalizeFocusPolicy(args.focus_policy);
  const requestedWindowPolicy = normalizeWindowPolicy(args.window_policy);
  const explicitRemoteCdp = ["remote_cdp", "cdp"].includes(String(args.tmwd_mode ?? ""));
  const tmwdTransport = ["tmwd_ws", "tmwd_link"].includes(String(options.transport ?? ""));
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
