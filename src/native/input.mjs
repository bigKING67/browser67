import { createToolError } from "../runtime/tool-errors.mjs";
import {
  clearNativeInputCapabilitiesCache,
  detectNativeInputCapabilities,
} from "../native-capabilities/index.mjs";
import {
  NATIVE_INPUT_DEFAULT_TIMEOUT_MS,
  NATIVE_INPUT_MAX_TIMEOUT_MS,
  buildNativeInputDryRunResponse,
  normalizeNativeInputAction,
  normalizeNativeInputTimeoutMs,
  validateNativeInputArguments,
} from "../native-core/index.mjs";
import { runNativeInputLinux } from "../native-linux/index.mjs";
import { runNativeInputMac } from "../native-macos/index.mjs";
import { runNativeInputWindows } from "../native-windows/index.mjs";
import { nowIso } from "../runtime/identity.mjs";
import { getManagedTab } from "../tab-workspace/index.mjs";
import { resolvePreferredBrowserContext } from "../tmwd-runtime/index.mjs";
import { executeTmwdCommandWithPreferred } from "../browser-wrappers/shared.mjs";
import {
  acquireManagedFocusLease,
  releaseManagedFocusLease,
} from "../browser-wrappers/presentation.mjs";

const FOCUS_BOUND_NATIVE_ACTIONS = new Set([
  "activate_window",
  "move",
  "drag",
  "click",
  "double_click",
  "press",
  "type",
  "paste",
  "scroll",
]);

function mapNativeInputError(action, error) {
  if (typeof error?.errorCode === "string" && error.errorCode.trim().length > 0) {
    return error;
  }
  const rawMessage = String(error?.message ?? error ?? "native input execution failed");
  const normalized = rawMessage.toLowerCase();
  if (normalized.includes("enoent")) {
    return createToolError("ACTION_NOT_SUPPORTED", `action not supported: required binary missing for ${action}`);
  }
  if (
    normalized.includes("not permitted")
    || normalized.includes("not authorized")
    || normalized.includes("apple events")
    || normalized.includes("accessibility")
  ) {
    return createToolError("PLATFORM_PERMISSION_REQUIRED", `platform permission required: ${rawMessage}`);
  }
  if (
    normalized.includes("display backend unsupported")
    || normalized.includes("cannot open display")
    || normalized.includes("wayland session")
    || normalized.includes("display is not set")
  ) {
    return createToolError("DISPLAY_BACKEND_UNSUPPORTED", `display backend unsupported: ${rawMessage}`);
  }
  if (normalized.includes("window not found")) {
    return createToolError("WINDOW_NOT_FOUND", `window not found: ${rawMessage}`);
  }
  if (normalized.includes("coordinate out of range")) {
    return createToolError("COORDINATE_OUT_OF_RANGE", rawMessage);
  }
  if (normalized.includes("action not supported")) {
    return createToolError("ACTION_NOT_SUPPORTED", rawMessage);
  }
  return createToolError("NATIVE_INPUT_EXECUTION_FAILED", `native input execution failed action=${action}: ${rawMessage}`);
}

async function acquireNativeInputFocus(args, action, options = {}) {
  const tabId = String(args?.tab_id ?? "").trim();
  if (!tabId || !FOCUS_BOUND_NATIVE_ACTIONS.has(action)) {
    return { lease: undefined, run_command: undefined };
  }
  const record = await getManagedTab(tabId, args?.browser_instance_id);
  if (!record || record.status === "closed") {
    throw createToolError(
      "MANAGED_TAB_REQUIRED",
      "tab_id must identify a live browser67-managed tab before native input can acquire focus",
      { details: { tab_id: tabId } },
    );
  }
  const focusArgs = {
    ...args,
    browser_instance_id: record.browser_instance_id || args?.browser_instance_id,
    tab_id: tabId,
    switch_tab_id: tabId,
    session_id: tabId,
  };
  const preferred = await resolvePreferredBrowserContext(focusArgs, options);
  const runCommand = (command) => executeTmwdCommandWithPreferred(
    focusArgs,
    preferred,
    command,
    options,
  );
  const lease = await acquireManagedFocusLease(focusArgs, tabId, runCommand);
  return { lease, run_command: runCommand };
}

async function handleBrowserNativeInput(args, options = {}) {
  const action = normalizeNativeInputAction(args?.action);
  const timeoutMs = normalizeNativeInputTimeoutMs(args?.timeout_ms);
  const dryRun = args?.dry_run === true;
  if (action === "capabilities") {
    const capabilities = await detectNativeInputCapabilities();
    return {
      status: "success",
      action,
      timeout_ms: timeoutMs,
      ...capabilities,
      at: nowIso(),
    };
  }
  if (String(args?.focus_policy ?? "background_preferred") === "foreground"
    && args?.confirm_foreground !== true) {
    throw createToolError(
      "FOREGROUND_NOT_CONFIRMED",
      "focus_policy=foreground requires confirm_foreground=true before native input can leave the Agent tab visible",
      {
        retryable: false,
        details: {
          action,
          required_confirmation: "confirm_foreground",
        },
      },
    );
  }
  const validatedArgs = validateNativeInputArguments(action, args ?? {});
  const effectiveArgs = {
    ...(args ?? {}),
    ...validatedArgs,
  };
  if (dryRun) {
    const capabilities = await detectNativeInputCapabilities();
    return {
      ...buildNativeInputDryRunResponse(action, effectiveArgs, timeoutMs, capabilities),
      focus_lease_planned: Boolean(
        String(args?.tab_id ?? "").trim()
        && FOCUS_BOUND_NATIVE_ACTIONS.has(action)
      ),
    };
  }
  let focus;
  try {
    focus = await acquireNativeInputFocus(args, action, options);
    const payload = await runNativeInputAction(action, effectiveArgs, timeoutMs);
    const focusRestore = focus.lease
      ? await releaseManagedFocusLease(focus.lease, focus.run_command, "native_input_complete")
      : undefined;
    focus = undefined;
    return {
      status: "success",
      platform: process.platform,
      action,
      dry_run: false,
      timeout_ms: timeoutMs,
      ...payload,
      focus_lease: focusRestore ? { acquired: true, restore: focusRestore } : undefined,
      at: nowIso(),
    };
  } catch (error) {
    throw mapNativeInputError(action, error);
  } finally {
    if (focus?.lease) {
      await releaseManagedFocusLease(focus.lease, focus.run_command, "native_input_failed");
    }
  }
}

async function runNativeInputAction(action, effectiveArgs, timeoutMs) {
  if (process.platform === "win32") {
    return runNativeInputWindows(action, effectiveArgs, timeoutMs);
  }
  if (process.platform === "darwin") {
    return runNativeInputMac(action, effectiveArgs, timeoutMs);
  }
  if (process.platform === "linux") {
    return runNativeInputLinux(action, effectiveArgs, timeoutMs);
  }
  throw createToolError("DISPLAY_BACKEND_UNSUPPORTED", `display backend unsupported: platform=${process.platform}`);
}

export {
  NATIVE_INPUT_DEFAULT_TIMEOUT_MS,
  NATIVE_INPUT_MAX_TIMEOUT_MS,
  normalizeNativeInputTimeoutMs,
  normalizeNativeInputAction,
  detectNativeInputCapabilities,
  validateNativeInputArguments,
  buildNativeInputDryRunResponse,
  clearNativeInputCapabilitiesCache,
  runNativeInputAction,
  mapNativeInputError,
  handleBrowserNativeInput,
};
