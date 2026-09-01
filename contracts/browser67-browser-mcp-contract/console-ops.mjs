import assert from "node:assert/strict";

import { normalizeConsoleObservationOptions } from "../../src/browser-wrappers/console-ops.mjs";
import {
  assertTextJsonContent,
  firstJsonContent,
} from "./rpc-content.mjs";

export async function assertConsoleOpsContract({ rpc, timeoutMs }) {
  assert.deepEqual(normalizeConsoleObservationOptions({}), {
    duration_ms: 1_000,
    max_entries: 100,
    max_total_chars: 100_000,
    include_log_entries: true,
    include_stack_trace: false,
  });
  assert.deepEqual(normalizeConsoleObservationOptions({
    duration_ms: 60_000,
    max_entries: 5_000,
    max_total_chars: 900_000,
    include_log_entries: false,
    include_stack_trace: true,
  }), {
    duration_ms: 30_000,
    max_entries: 500,
    max_total_chars: 300_000,
    include_log_entries: false,
    include_stack_trace: true,
  });

  const missingActionCall = await rpc.call(
    "tools/call",
    {
      name: "browser_console_ops",
      arguments: {},
    },
    timeoutMs,
  );
  assert.equal(missingActionCall?.result?.isError, true);
  assertTextJsonContent(missingActionCall.result, "browser_console_ops missing action error");
  const missingActionPayload = firstJsonContent(missingActionCall.result);
  assert.equal(missingActionPayload?.error_code, "INVALID_ARGUMENTS");

  const unsupportedActionCall = await rpc.call(
    "tools/call",
    {
      name: "browser_console_ops",
      arguments: { action: "persistent_attach" },
    },
    timeoutMs,
  );
  assert.equal(unsupportedActionCall?.result?.isError, true);
  const unsupportedActionPayload = firstJsonContent(unsupportedActionCall.result);
  assert.equal(unsupportedActionPayload?.error_code, "INVALID_ARGUMENTS");

  return {
    default_limits: normalizeConsoleObservationOptions({}),
    missing_action_error_code: missingActionPayload.error_code,
  };
}
