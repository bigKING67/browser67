import { normalizeTimeoutMs } from "./config/limits.mjs";
import { classifyBrowserErrorCode, createToolError } from "./tool-errors.mjs";

const MIN_PHASE_TIMEOUT_MS = 100;

function createOperationDeadline(rawTimeoutMs, options = {}) {
  const clock = typeof options.clock === "function" ? options.clock : Date.now;
  const timeoutMs = normalizeTimeoutMs(rawTimeoutMs);
  const startedAtMs = clock();
  const deadlineAtMs = startedAtMs + timeoutMs;

  function snapshot(phase) {
    const now = clock();
    return {
      failed_phase: String(phase || "unknown"),
      timeout_ms: timeoutMs,
      elapsed_ms: Math.max(0, now - startedAtMs),
      remaining_ms: Math.max(0, deadlineAtMs - now),
      deadline_at: new Date(deadlineAtMs).toISOString(),
    };
  }

  function remaining(phase) {
    const state = snapshot(phase);
    if (state.remaining_ms < MIN_PHASE_TIMEOUT_MS) {
      throw createToolError(
        "TIMEOUT",
        `operation deadline exceeded before phase=${state.failed_phase}`,
        { retryable: true, details: state },
      );
    }
    return Math.floor(state.remaining_ms);
  }

  function argsFor(args, phase) {
    return {
      ...(args ?? {}),
      timeout_ms: remaining(phase),
    };
  }

  function annotate(error, phase) {
    const state = snapshot(phase);
    const value = /** @type {Error & {details?: Record<string, any>, errorCode?: string, retryable?: boolean}} */ (
      error instanceof Error ? error : new Error(String(error ?? "operation failed"))
    );
    value.details = {
      ...(value.details && typeof value.details === "object" ? value.details : {}),
      ...state,
    };
    if (
      state.remaining_ms === 0
      || value.errorCode === "TIMEOUT"
      || classifyBrowserErrorCode(value.message) === "TIMEOUT"
    ) {
      value.errorCode = "TIMEOUT";
      value.retryable = true;
    }
    return value;
  }

  return Object.freeze({
    annotate,
    argsFor,
    deadline_at: new Date(deadlineAtMs).toISOString(),
    remaining,
    snapshot,
    started_at: new Date(startedAtMs).toISOString(),
    timeout_ms: timeoutMs,
  });
}

export {
  MIN_PHASE_TIMEOUT_MS,
  createOperationDeadline,
};
