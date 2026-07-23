import { createToolError } from "../runtime/tool-errors.mjs";
import {
  detectNativeInputCapabilities,
  normalizeNativeInputAction,
} from "../native/input.mjs";

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
    || action === "drag"
    || action === "click"
    || action === "double_click"
    || action === "scroll";
}

export {
  isPointerNativeAction,
  resolveNativeExecuteActionScope,
  resolveNativeFallbackAction,
  resolveNativeFallbackArgs,
  resolveSuggestedNativeInputCapabilities,
};
