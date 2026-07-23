import { isRetryableBrowserErrorCode } from "../runtime/tool-errors.mjs";
import {
  buildNativeInputDryRunResponse,
  detectNativeInputCapabilities,
  mapNativeInputError,
  normalizeNativeInputTimeoutMs,
  runNativeInputAction,
} from "../native/input.mjs";
import {
  isPointerNativeAction,
  resolveNativeExecuteActionScope,
  resolveNativeFallbackAction,
  resolveNativeFallbackArgs,
} from "./plan.mjs";
import {
  buildNativeInputSuggestion,
  resolveNativeAutoFallbackPolicy,
} from "./policy.mjs";

async function buildNativeFallbackDryRun(args, suggestion) {
  const action = resolveNativeFallbackAction(args, suggestion);
  const fallbackArgs = resolveNativeFallbackArgs(args);
  const timeoutMs = normalizeNativeInputTimeoutMs(args?.native_fallback_timeout_ms ?? args?.timeout_ms);
  const capabilities = await detectNativeInputCapabilities();
  const dryRun = buildNativeInputDryRunResponse(action, fallbackArgs, timeoutMs, capabilities);
  return {
    action,
    timeoutMs,
    capabilities,
    dryRun,
  };
}

function buildNativeFallbackPlanError(action, error, policy, suggestion) {
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

function buildNativeFallbackSkip(policy, suggestion) {
  return {
    attempted: false,
    executed: false,
    status: "skipped",
    reason: "no_escalation_signal",
    policy,
    suggestion,
  };
}

function buildNativeFallbackBlocked({
  action,
  actionScope,
  autoExecute,
  capabilities,
  dryRun,
  policy,
  reason,
  suggestion,
  timeoutMs,
  requiredScope,
}) {
  return {
    attempted: true,
    executed: false,
    status: "blocked",
    reason,
    policy,
    suggestion,
    action,
    timeout_ms: timeoutMs,
    dry_run: dryRun,
    capabilities,
    auto_execute: autoExecute,
    action_scope: actionScope,
    ...(requiredScope ? { required_scope: requiredScope } : {}),
  };
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
    return buildNativeFallbackSkip(policy, suggestion);
  }
  let plan;
  try {
    plan = await buildNativeFallbackDryRun(args, suggestion);
  } catch (error) {
    return buildNativeFallbackPlanError(plan?.action, error, policy, suggestion);
  }
  const autoExecute = args?.native_auto_execute === true;
  const actionScope = resolveNativeExecuteActionScope(args);
  if (plan.dryRun.next_step !== "safe_to_execute") {
    return buildNativeFallbackBlocked({
      action: plan.action,
      actionScope,
      autoExecute,
      capabilities: plan.capabilities,
      dryRun: plan.dryRun,
      policy,
      reason: "requirements_missing",
      suggestion,
      timeoutMs: plan.timeoutMs,
    });
  }
  if (!autoExecute) {
    return {
      attempted: true,
      executed: false,
      status: "dry_run_only",
      reason: "native_auto_execute_disabled",
      policy,
      suggestion,
      action: plan.action,
      timeout_ms: plan.timeoutMs,
      dry_run: plan.dryRun,
      capabilities: plan.capabilities,
      auto_execute: false,
      action_scope: actionScope,
    };
  }
  if (actionScope !== "all" && isPointerNativeAction(plan.action)) {
    return buildNativeFallbackBlocked({
      action: plan.action,
      actionScope,
      autoExecute: true,
      capabilities: plan.capabilities,
      dryRun: plan.dryRun,
      policy,
      reason: "pointer_action_scope_blocked",
      requiredScope: "all",
      suggestion,
      timeoutMs: plan.timeoutMs,
    });
  }
  try {
    const payload = await runNativeInputAction(plan.action, plan.dryRun.validated_args ?? {}, plan.timeoutMs);
    return {
      attempted: true,
      executed: true,
      status: "executed",
      policy,
      suggestion,
      action: plan.action,
      timeout_ms: plan.timeoutMs,
      payload,
      dry_run: plan.dryRun,
      capabilities: plan.capabilities,
      auto_execute: true,
      action_scope: actionScope,
    };
  } catch (error) {
    const mapped = mapNativeInputError(plan.action, error);
    return {
      attempted: true,
      executed: false,
      status: "failed",
      reason: "native_execution_failed",
      policy,
      suggestion,
      action: plan.action,
      timeout_ms: plan.timeoutMs,
      dry_run: plan.dryRun,
      capabilities: plan.capabilities,
      auto_execute: true,
      action_scope: actionScope,
      error: String(mapped.message ?? mapped),
      error_code: String(mapped.errorCode ?? "NATIVE_INPUT_EXECUTION_FAILED"),
      retryable: isRetryableBrowserErrorCode(String(mapped.errorCode ?? "NATIVE_INPUT_EXECUTION_FAILED")),
    };
  }
}

export {
  maybeRunNativeFallbackForExecuteJs,
};
