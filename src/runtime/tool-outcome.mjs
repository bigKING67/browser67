import { nowIso } from "../common.mjs";
import { redactBrowserValue } from "./redaction.mjs";

const TOOL_OUTCOME_SCHEMA = "browser67.tool-outcome.v3";

function completedOutcome(data, options = {}) {
  return {
    schema: TOOL_OUTCOME_SCHEMA,
    ok: true,
    status: options.status === "partial" ? "partial" : "completed",
    data: redactBrowserValue(data ?? {}),
    meta: redactBrowserValue({
      request_id: options.request_id,
      duration_ms: options.duration_ms,
      transport_attempts: options.transport_attempts,
      completed_at: options.completed_at ?? nowIso(),
      ...options.meta,
    }),
    warnings: redactBrowserValue(Array.isArray(options.warnings) ? options.warnings : []),
    artifacts: redactBrowserValue(Array.isArray(options.artifacts) ? options.artifacts : []),
  };
}

function failedOutcome(error, options = {}) {
  const code = String(options.code || error?.errorCode || "EXECUTION_ERROR");
  return {
    schema: TOOL_OUTCOME_SCHEMA,
    ok: false,
    status: "failed",
    error: redactBrowserValue({
      code,
      message: String(options.message || error?.message || error || "tool execution failed"),
      retryable: options.retryable === true,
      details: options.details,
    }),
    meta: redactBrowserValue({
      request_id: options.request_id,
      duration_ms: options.duration_ms,
      transport_attempts: options.transport_attempts,
      completed_at: options.completed_at ?? nowIso(),
      ...options.meta,
    }),
    warnings: redactBrowserValue(Array.isArray(options.warnings) ? options.warnings : []),
    artifacts: redactBrowserValue(Array.isArray(options.artifacts) ? options.artifacts : []),
  };
}

function isToolOutcome(value) {
  return value?.schema === TOOL_OUTCOME_SCHEMA
    && typeof value?.ok === "boolean"
    && ["completed", "partial", "failed"].includes(value?.status);
}

function formatMcpOutcome(outcome) {
  return {
    ...(outcome.ok === false ? { isError: true } : {}),
    content: [
      {
        type: "text",
        text: JSON.stringify(outcome),
      },
    ],
  };
}

export {
  TOOL_OUTCOME_SCHEMA,
  completedOutcome,
  failedOutcome,
  formatMcpOutcome,
  isToolOutcome,
};
