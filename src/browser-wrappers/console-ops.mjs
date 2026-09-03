import { assertManagedExecutionContext } from "../browser/execution/managed-context.mjs";
import { createToolError } from "../runtime/tool-errors.mjs";
import { createOperationDeadline } from "../runtime/operation-deadline.mjs";
import { resolvePreferredBrowserContext } from "../tmwd-runtime/index.mjs";
import {
  executeTmwdCommandWithPreferred,
  normalizeAction,
} from "./shared.mjs";

function boundedInteger(raw, fallback, min, max) {
  const value = Number(raw);
  if (!Number.isFinite(value)) return fallback;
  return Math.max(min, Math.min(max, Math.floor(value)));
}

function normalizeConsoleObservationOptions(args = {}) {
  return {
    duration_ms: boundedInteger(args.duration_ms, 1_000, 50, 30_000),
    max_entries: boundedInteger(args.max_entries, 100, 1, 500),
    max_total_chars: boundedInteger(args.max_total_chars, 100_000, 1_000, 300_000),
    include_log_entries: args.include_log_entries !== false,
    include_stack_trace: args.include_stack_trace === true,
  };
}

async function handleBrowserConsoleOps(args = {}, runtimeOptions = {}) {
  const action = normalizeAction(args, ["observe"]);
  if (action !== "observe") {
    throw createToolError("INVALID_ARGUMENT", `unsupported browser_console_ops action: ${action}`);
  }
  const options = normalizeConsoleObservationOptions(args);
  const deadline = createOperationDeadline(args.timeout_ms ?? options.duration_ms + 5_000);
  if (args.timeout_ms !== undefined && deadline.timeout_ms < options.duration_ms + 250) {
    throw createToolError(
      "INVALID_ARGUMENT",
      "browser_console_ops timeout_ms must cover duration_ms plus debugger teardown",
      {
        retryable: false,
        details: {
          field: "timeout_ms",
          timeout_ms: deadline.timeout_ms,
          duration_ms: options.duration_ms,
          minimum_timeout_ms: options.duration_ms + 250,
          failed_phase: "console_budget_validation",
        },
      },
    );
  }
  let phase = "resolve_context";
  let preferred;
  try {
    preferred = await resolvePreferredBrowserContext(deadline.argsFor(args, phase), runtimeOptions);
  } catch (error) {
    throw deadline.annotate(error, phase);
  }
  if (preferred.transport !== "tmwd_ws" && preferred.transport !== "tmwd_link") {
    throw createToolError(
      "TMWD_REQUIRED",
      "bounded console observation requires the browser67 TMWD extension",
      {
        retryable: true,
        details: {
          transport: preferred.transport,
          persistent_debugger_supported: false,
        },
      },
    );
  }
  phase = "managed_context";
  let management;
  try {
    management = await assertManagedExecutionContext(
      preferred,
      deadline.argsFor(args, phase),
      runtimeOptions,
    );
  } catch (error) {
    throw deadline.annotate(error, phase);
  }
  const tabId = String(preferred.context?.target?.tab_id ?? preferred.context?.target?.id ?? "");
  phase = "console_observation";
  const remainingMs = deadline.remaining(phase);
  if (remainingMs < options.duration_ms + 100) {
    throw createToolError("TIMEOUT", "console observation deadline exhausted before attach", {
      retryable: true,
      details: {
        ...deadline.snapshot(phase),
        duration_ms: options.duration_ms,
        required_remaining_ms: options.duration_ms + 100,
      },
    });
  }
  let observed;
  try {
    observed = await executeTmwdCommandWithPreferred({
      ...args,
      timeout_ms: remainingMs,
    }, preferred, {
      cmd: "debugger",
      method: "observe_console",
      tabId,
      durationMs: options.duration_ms,
      maxEntries: options.max_entries,
      maxTotalChars: options.max_total_chars,
      includeLogEntries: options.include_log_entries,
      includeStackTrace: options.include_stack_trace,
    }, runtimeOptions);
  } catch (error) {
    throw deadline.annotate(error, phase);
  }
  if (observed.value?.schema !== "browser67.console-observation.v1") {
    throw createToolError(
      "CONSOLE_OBSERVATION_UNAVAILABLE",
      "TMWD extension did not return a bounded console observation",
      {
        retryable: true,
        details: observed.value,
      },
    );
  }
  return {
    ...observed.value,
    status: "success",
    action: "observe",
    transport: observed.transport,
    transport_attempts: observed.transport_attempts,
    page: observed.page,
    management,
    deadline: {
      timeout_ms: deadline.timeout_ms,
      elapsed_ms: deadline.snapshot("completed").elapsed_ms,
    },
  };
}

export {
  handleBrowserConsoleOps,
  normalizeConsoleObservationOptions,
};
