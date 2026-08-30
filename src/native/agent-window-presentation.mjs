import { ensureMacAgentWindowNativeFullscreen } from "../native-macos/agent-window-presentation.mjs";

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

export { ensureNativeAgentWindowPresentation };
