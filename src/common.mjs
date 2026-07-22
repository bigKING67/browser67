// Compatibility surface while callers migrate to capability-owned modules.
export {
  CDP_DEFAULT_ENDPOINT,
  TMWD_LINK_DEFAULT_ENDPOINT,
  TMWD_WS_DEFAULT_ENDPOINT,
  normalizeEndpoint,
  normalizeTmwdLinkEndpoint,
  normalizeTmwdWsEndpoint,
  resolveTmwdMode,
  resolveTmwdTransport,
} from "./runtime/config/endpoints.mjs";
export {
  DEFAULT_SCAN_MAX_CHARS,
  DEFAULT_TIMEOUT_MS,
  normalizeMaxChars,
  normalizeTimeoutMs,
} from "./runtime/config/limits.mjs";
export { hashText, nowIso, randomId } from "./runtime/identity.mjs";
export {
  appendTransportAttempt,
  mergeTransportAttempts,
  normalizeTmwdTransportLabel,
} from "./runtime/transport-attempts.mjs";
export { clipContent, compactText } from "./browser/content/output-limits.mjs";
export {
  applyMainOnlyGuardrail,
  normalizeMainOnlyMinChars,
  normalizeMainOnlyMinCoverage,
} from "./browser/content/main-only-policy.mjs";
export { parseBridgeCommand } from "./browser/execution/bridge-command.mjs";
export { resolveExecuteJsScriptInput } from "./browser/execution/script-input.mjs";
