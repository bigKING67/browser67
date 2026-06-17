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

export {
  buildNativeInputSuggestion,
  resolveNativeAutoFallbackPolicy,
};
