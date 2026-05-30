import { isRetryableBrowserErrorCode, createToolError } from "./errors.mjs";
import {
  buildNativeInputDryRunResponse,
  detectNativeInputCapabilities,
  mapNativeInputError,
  normalizeNativeInputAction,
  normalizeNativeInputTimeoutMs,
  runNativeInputAction,
} from "./native-input.mjs";

async function resolveSuggestedNativeInputCapabilities(nativeAutoFallback, nativeInputSuggestion) {
  if (typeof nativeAutoFallback?.capabilities === "object" && nativeAutoFallback.capabilities !== null) {
    return nativeAutoFallback.capabilities;
  }
  if (nativeInputSuggestion?.should_escalate !== true) {
    return undefined;
  }
  try {
    return await detectNativeInputCapabilities();
  } catch {
    return undefined;
  }
}

function resolveNativeAutoFallbackPolicy(args) {
  const normalized = String(args?.native_auto_fallback_policy ?? "balanced").trim().toLowerCase();
  if (normalized === "strict" || normalized === "aggressive") {
    return normalized;
  }
  return "balanced";
}

function buildNativeInputSuggestion(errorCode, errorMessage, policy = "balanced") {
  if (!errorCode) {
    return {
      should_escalate: false,
      policy,
    };
  }
  if (
    policy === "aggressive"
    && (
      errorCode === "NO_EXTENSION"
      || errorCode === "NO_SESSION"
      || errorCode === "TRANSPORT_UNAVAILABLE"
      || errorCode === "TIMEOUT"
    )
  ) {
    return {
      should_escalate: true,
      reason: "transport_or_session_unavailable",
      suggested_tool: "browser_native_input",
      suggested_action: "click",
      note: "Browser transport/session is unavailable; native fallback planning may help recover control.",
      policy,
    };
  }
  if (
    policy === "balanced"
    && (
      errorCode === "NO_EXTENSION"
      || errorCode === "NO_SESSION"
      || errorCode === "TRANSPORT_UNAVAILABLE"
    )
  ) {
    return {
      should_escalate: true,
      reason: "transport_or_session_unavailable",
      suggested_tool: "browser_native_input",
      suggested_action: "click",
      note: "Browser transport/session is unavailable; native fallback planning may help recover control.",
      policy,
    };
  }
  const normalized = String(errorMessage ?? "").toLowerCase();
  if (
    errorCode === "CSP_BLOCKED"
    || errorCode === "CDP_DENIED"
    || (policy === "aggressive" && errorCode === "EXECUTION_ERROR")
  ) {
    return {
      should_escalate: true,
      reason: "browser_policy_blocked",
      suggested_tool: "browser_native_input",
      suggested_action: "click",
      note: "Browser policy blocked JS/DevTools path; native input may be required.",
      policy,
    };
  }
  if (
    errorCode === "EXECUTION_ERROR"
    && (
      normalized.includes("istrusted")
      || normalized.includes("is trusted")
      || normalized.includes("user gesture")
      || normalized.includes("file chooser")
      || normalized.includes("picker")
    )
  ) {
    return {
      should_escalate: true,
      reason: "trusted_event_or_native_dialog_required",
      suggested_tool: "browser_native_input",
      suggested_action: "click",
      note: "Page requires trusted/native interaction semantics.",
      policy,
    };
  }
  return {
    should_escalate: false,
    policy,
  };
}

function resolveNativeFallbackAction(args, suggestion) {
  const rawRequested = String(args?.native_fallback_action ?? "").trim();
  const candidate = rawRequested || String(suggestion?.suggested_action ?? "click");
  const action = normalizeNativeInputAction(candidate);
  if (action === "capabilities") {
    throw createToolError("ACTION_NOT_SUPPORTED", "action not supported: native fallback cannot use capabilities");
  }
  return action;
}

function resolveNativeFallbackArgs(args) {
  const raw = args?.native_fallback_args;
  if (typeof raw === "object" && raw !== null && !Array.isArray(raw)) {
    return raw;
  }
  return {};
}

function resolveNativeExecuteActionScope(args) {
  const normalized = String(args?.native_execute_action_scope ?? "non_pointer").trim().toLowerCase();
  if (normalized === "all") {
    return "all";
  }
  return "non_pointer";
}

function isPointerNativeAction(action) {
  return action === "move"
    || action === "click"
    || action === "double_click"
    || action === "scroll";
}

async function maybeRunNativeFallbackForExecuteJs(
  args,
  errorCode,
  errorMessage,
  policy = resolveNativeAutoFallbackPolicy(args),
) {
  if (args?.native_auto_fallback !== true) {
    return undefined;
  }
  const suggestion = buildNativeInputSuggestion(errorCode, errorMessage, policy);
  if (suggestion.should_escalate !== true) {
    return {
      attempted: false,
      executed: false,
      status: "skipped",
      reason: "no_escalation_signal",
      policy,
      suggestion,
    };
  }
  let action;
  let fallbackArgs;
  let timeoutMs;
  let capabilities;
  let dryRun;
  try {
    action = resolveNativeFallbackAction(args, suggestion);
    fallbackArgs = resolveNativeFallbackArgs(args);
    timeoutMs = normalizeNativeInputTimeoutMs(args?.native_fallback_timeout_ms ?? args?.timeout_ms);
    capabilities = await detectNativeInputCapabilities();
    dryRun = buildNativeInputDryRunResponse(action, fallbackArgs, timeoutMs, capabilities);
  } catch (error) {
    const mapped = mapNativeInputError(String(action ?? "native_fallback"), error);
    return {
      attempted: true,
      executed: false,
      status: "failed",
      reason: "invalid_fallback_plan",
      policy,
      error: String(mapped.message ?? mapped),
      error_code: String(mapped.errorCode ?? "NATIVE_INPUT_EXECUTION_FAILED"),
      retryable: isRetryableBrowserErrorCode(String(mapped.errorCode ?? "NATIVE_INPUT_EXECUTION_FAILED")),
      suggestion,
    };
  }
  const autoExecute = args?.native_auto_execute === true;
  const actionScope = resolveNativeExecuteActionScope(args);
  if (dryRun.next_step !== "safe_to_execute") {
    return {
      attempted: true,
      executed: false,
      status: "blocked",
      reason: "requirements_missing",
      policy,
      suggestion,
      action,
      timeout_ms: timeoutMs,
      dry_run: dryRun,
      capabilities,
      auto_execute: autoExecute,
      action_scope: actionScope,
    };
  }
  if (!autoExecute) {
    return {
      attempted: true,
      executed: false,
      status: "dry_run_only",
      reason: "native_auto_execute_disabled",
      policy,
      suggestion,
      action,
      timeout_ms: timeoutMs,
      dry_run: dryRun,
      capabilities,
      auto_execute: false,
      action_scope: actionScope,
    };
  }
  if (actionScope !== "all" && isPointerNativeAction(action)) {
    return {
      attempted: true,
      executed: false,
      status: "blocked",
      reason: "pointer_action_scope_blocked",
      policy,
      suggestion,
      action,
      timeout_ms: timeoutMs,
      dry_run: dryRun,
      capabilities,
      auto_execute: true,
      action_scope: actionScope,
      required_scope: "all",
    };
  }
  try {
    const payload = await runNativeInputAction(action, dryRun.validated_args ?? {}, timeoutMs);
    return {
      attempted: true,
      executed: true,
      status: "executed",
      policy,
      suggestion,
      action,
      timeout_ms: timeoutMs,
      payload,
      dry_run: dryRun,
      capabilities,
      auto_execute: true,
      action_scope: actionScope,
    };
  } catch (error) {
    const mapped = mapNativeInputError(action, error);
    return {
      attempted: true,
      executed: false,
      status: "failed",
      reason: "native_execution_failed",
      policy,
      suggestion,
      action,
      timeout_ms: timeoutMs,
      dry_run: dryRun,
      capabilities,
      auto_execute: true,
      action_scope: actionScope,
      error: String(mapped.message ?? mapped),
      error_code: String(mapped.errorCode ?? "NATIVE_INPUT_EXECUTION_FAILED"),
      retryable: isRetryableBrowserErrorCode(String(mapped.errorCode ?? "NATIVE_INPUT_EXECUTION_FAILED")),
    };
  }
}

export {
  buildNativeInputSuggestion,
  maybeRunNativeFallbackForExecuteJs,
  resolveNativeAutoFallbackPolicy,
  resolveSuggestedNativeInputCapabilities,
};
