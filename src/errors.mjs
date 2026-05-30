import { nowIso, resolveTmwdTransport } from "./common.mjs";

function makeErrorPayload(tool, error) {
  const message = String(error?.message ?? error ?? "unknown error");
  const explicitErrorCode = typeof error?.errorCode === "string" ? error.errorCode.trim() : "";
  const errorCode = explicitErrorCode || classifyBrowserErrorCode(message);
  const retryable = typeof error?.retryable === "boolean"
    ? error.retryable
    : isRetryableBrowserErrorCode(errorCode);
  const transportAttempts = Array.isArray(error?.transportAttempts)
    ? error.transportAttempts
    : undefined;
  const errorDetails = (
    typeof error?.details === "object"
    && error.details !== null
    && !Array.isArray(error.details)
  )
    ? error.details
    : undefined;
  return {
    isError: true,
    content: [
      {
        type: "json",
        json: {
          status: "error",
          tool,
          error: message,
          error_code: errorCode,
          retryable,
          transport_attempts: transportAttempts,
          details: errorDetails,
          at: nowIso(),
        },
      },
    ],
  };
}

function classifyBrowserErrorCode(message) {
  const normalized = String(message ?? "").toLowerCase();
  if (
    normalized.includes("tmwd ws connection failed")
    || normalized.includes("no active extension websocket")
    || normalized.includes("tmwd ws is not connected")
    || normalized.includes("extension websocket closed")
  ) {
    return "NO_EXTENSION";
  }
  if (
    normalized.includes("no active session available")
    || normalized.includes("get_all_sessions returned empty")
    || normalized.includes("tmwd ws tabs returned empty")
    || normalized.includes("no cdp page targets found")
    || normalized.includes("tab not found")
  ) {
    return "NO_SESSION";
  }
  if (normalized.includes("timeout")) {
    return "TIMEOUT";
  }
  if (
    normalized.includes("content security policy")
    || (normalized.includes("csp") && normalized.includes("violat"))
  ) {
    return "CSP_BLOCKED";
  }
  if (
    normalized.includes("cdp")
    && (normalized.includes("not allowed") || normalized.includes("permission denied"))
  ) {
    return "CDP_DENIED";
  }
  if (
    normalized.includes("tmwd context unavailable")
    || normalized.includes("no transport succeeded")
    || normalized.includes("transport unavailable")
  ) {
    return "TRANSPORT_UNAVAILABLE";
  }
  if (
    normalized.includes("platform permission required")
    || normalized.includes("accessibility permission")
    || normalized.includes("apple events")
    || normalized.includes("not authorized")
  ) {
    return "PLATFORM_PERMISSION_REQUIRED";
  }
  if (
    normalized.includes("display backend unsupported")
    || normalized.includes("cannot open display")
    || normalized.includes("wayland session")
  ) {
    return "DISPLAY_BACKEND_UNSUPPORTED";
  }
  if (normalized.includes("window not found")) {
    return "WINDOW_NOT_FOUND";
  }
  if (normalized.includes("coordinate out of range")) {
    return "COORDINATE_OUT_OF_RANGE";
  }
  if (normalized.includes("action not supported")) {
    return "ACTION_NOT_SUPPORTED";
  }
  if (normalized.includes("native input execution failed")) {
    return "NATIVE_INPUT_EXECUTION_FAILED";
  }
  return "EXECUTION_ERROR";
}

function isRetryableBrowserErrorCode(code) {
  return code === "NO_EXTENSION"
    || code === "NO_SESSION"
    || code === "TIMEOUT"
    || code === "TRANSPORT_UNAVAILABLE";
}

function withTransportAttempts(error, attempts) {
  if (typeof error === "object" && error !== null) {
    error.transportAttempts = [...attempts];
  }
  return error;
}

function createToolError(errorCode, message, options = {}) {
  const error = new Error(String(message ?? "tool execution failed"));
  error.errorCode = String(errorCode || "EXECUTION_ERROR");
  if (typeof options.retryable === "boolean") {
    error.retryable = options.retryable;
  }
  if (typeof options.details === "object" && options.details !== null) {
    error.details = options.details;
  }
  return error;
}

function shouldFallbackAcrossTmwdTransports(args, error) {
  const configuredTransport = resolveTmwdTransport(args?.tmwd_transport);
  if (configuredTransport === "link") {
    return false;
  }
  const message = String(error?.message ?? error ?? "");
  const code = classifyBrowserErrorCode(message);
  return isRetryableBrowserErrorCode(code);
}

export {
  makeErrorPayload,
  classifyBrowserErrorCode,
  isRetryableBrowserErrorCode,
  withTransportAttempts,
  createToolError,
  shouldFallbackAcrossTmwdTransports,
};
