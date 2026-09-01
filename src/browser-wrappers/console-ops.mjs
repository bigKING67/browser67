import { assertManagedExecutionContext } from "../browser/execution/managed-context.mjs";
import { createToolError } from "../runtime/tool-errors.mjs";
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
  const preferred = await resolvePreferredBrowserContext(args, runtimeOptions);
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
  const management = await assertManagedExecutionContext(preferred, args, runtimeOptions);
  const tabId = String(preferred.context?.target?.tab_id ?? preferred.context?.target?.id ?? "");
  const commandArgs = {
    ...args,
    timeout_ms: Math.max(
      boundedInteger(args.timeout_ms, 0, 0, 120_000),
      options.duration_ms + 5_000,
    ),
  };
  const observed = await executeTmwdCommandWithPreferred(commandArgs, preferred, {
    cmd: "debugger",
    method: "observe_console",
    tabId,
    durationMs: options.duration_ms,
    maxEntries: options.max_entries,
    maxTotalChars: options.max_total_chars,
    includeLogEntries: options.include_log_entries,
    includeStackTrace: options.include_stack_trace,
  }, runtimeOptions);
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
  };
}

export {
  handleBrowserConsoleOps,
  normalizeConsoleObservationOptions,
};
