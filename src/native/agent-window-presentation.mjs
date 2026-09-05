import {
  applicationForBrowserFamily,
  ensureMacAgentWindowNativeFullscreen,
} from "../native-macos/agent-window-presentation.mjs";
import { findChromiumTabWindow } from "../native-macos/chromium-window.mjs";

function presentationFailure(requested, error, reason) {
  return {
    ...requested,
    status: "failed",
    native_action_required: true,
    reason,
    error: String(error?.message ?? error),
  };
}

async function ensureNativeAgentWindowPresentation(agentWindow, options = {}) {
  const requested = agentWindow?.presentation && typeof agentWindow.presentation === "object"
    ? agentWindow.presentation
    : {};
  if (
    requested.mode !== "macos_native_fullscreen_space"
    || requested.native_action_required !== true
  ) {
    if (
      requested.mode === "macos_native_fullscreen_space"
      && requested.status === "ready"
      && requested.window_state === "fullscreen"
    ) {
      return {
        ...requested,
        native_fullscreen: true,
        verification: "exact_extension_window_state",
      };
    }
    if (
      requested.mode === "windows_maximized"
      && requested.status === "ready"
      && requested.window_state === "maximized"
    ) {
      return {
        ...requested,
        maximized: true,
        verification: "exact_extension_window_state",
      };
    }
    return requested;
  }
  if (options.foreground_requested !== true) {
    return {
      ...requested,
      status: "deferred",
      reason: "background_focus_preserved",
      verification_required: false,
      native_action_required: true,
    };
  }
  const hostPlatform = String(options.host_platform ?? process.platform);
  if (hostPlatform !== "darwin") {
    return presentationFailure(
      requested,
      `native macOS presentation cannot run on host platform=${hostPlatform}`,
      "host_platform_mismatch",
    );
  }
  const presenter = options.macos_presenter ?? ensureMacAgentWindowNativeFullscreen;
  const focusSnapshot = agentWindow?.focus_snapshot ?? {};
  try {
    const actual = await presenter({
      anchorTabId: agentWindow?.anchor_tab_id,
      anchorUrl: agentWindow?.anchor_url,
      browserFamily: agentWindow?.browser_family,
      restoreTabId: focusSnapshot.browser_focused === true
        ? focusSnapshot.tab_id
        : undefined,
      timeoutMs: options.timeout_ms,
    });
    return {
      ...requested,
      ...actual,
      status: actual.verification_required === true ? "verification_required" : "ready",
      native_action_required: actual.verification_required === true,
    };
  } catch (error) {
    return presentationFailure(requested, error, "native_presentation_failed");
  }
}

async function foregroundNativeAgentWindowTab(agentWindow, tabId, options = {}) {
  const presentation = agentWindow?.presentation && typeof agentWindow.presentation === "object"
    ? agentWindow.presentation
    : {};
  if (presentation.mode !== "macos_native_fullscreen_space") {
    return {
      status: "not_applicable",
      foregrounded: false,
      reason: "agent_window_not_macos_native_fullscreen",
    };
  }
  const hostPlatform = String(options.host_platform ?? process.platform);
  if (hostPlatform !== "darwin") {
    throw new Error(`native macOS Agent window foreground cannot run on host platform=${hostPlatform}`);
  }
  const fullscreenReady = presentation.status === "ready"
    && (
      presentation.native_fullscreen === true
      || presentation.window_state === "fullscreen"
    );
  if (!fullscreenReady) {
    throw new Error("macOS Agent window native Full Screen state is not verified");
  }
  const applicationName = applicationForBrowserFamily(agentWindow?.browser_family);
  const foregrounder = options.macos_foregrounder ?? findChromiumTabWindow;
  const result = await foregrounder({
    activate: true,
    preferredApplication: applicationName,
    strictApplication: true,
    timeoutMs: options.timeout_ms,
    windowTabId: tabId,
  });
  if (result?.foregrounded !== true) {
    throw new Error("native macOS Agent window foreground did not confirm activation");
  }
  if (
    String(result.application_name ?? "") !== applicationName
    || Number(result.browser_tab_id) !== Number(tabId)
  ) {
    throw new Error("native macOS Agent window foreground returned a mismatched browser identity");
  }
  return {
    status: "foregrounded",
    foregrounded: true,
    mode: "macos_native_fullscreen_space",
    driver: String(result.driver ?? "macos-chromium-applescript"),
    application_name: String(result.application_name ?? ""),
    browser_tab_id: result.browser_tab_id,
    window_index: result.window_index,
    tab_index: result.tab_index,
    space_activation: "exact_tab_native_activation",
    document_visibility_verification: "caller_required",
  };
}

export {
  ensureNativeAgentWindowPresentation,
  foregroundNativeAgentWindowTab,
};
