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

async function handleBrowserNativeInput(args) {
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
  const validatedArgs = validateNativeInputArguments(action, args ?? {});
  const effectiveArgs = {
    ...(args ?? {}),
    ...validatedArgs,
  };
  if (dryRun) {
    const capabilities = await detectNativeInputCapabilities();
    return buildNativeInputDryRunResponse(action, effectiveArgs, timeoutMs, capabilities);
  }
  try {
    const payload = await runNativeInputAction(action, effectiveArgs, timeoutMs);
    return {
      status: "success",
      platform: process.platform,
      action,
      dry_run: false,
      timeout_ms: timeoutMs,
      ...payload,
      at: nowIso(),
    };
  } catch (error) {
    throw mapNativeInputError(action, error);
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
