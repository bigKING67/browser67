import assert from "node:assert/strict";

import {
  buildCliclickClickCommands,
  buildCliclickDragCommands,
} from "../../src/native-macos/pointer.mjs";

import {
  assertTextJsonContent,
  firstJsonContent,
} from "./rpc-content.mjs";

async function assertNativeInputOpsContract({ rpc, timeoutMs }) {
  const macosDragPlan = buildCliclickDragCommands({
    durationMs: 700,
    fromX: 120,
    fromY: 200,
    steps: 12,
    toX: 260,
    toY: 200,
  });
  assert.deepEqual(
    macosDragPlan.command_sequence.slice(0, 2),
    ["m", "dd"],
    "macOS cliclick drag should pre-move before mouse-down",
  );
  assert.equal(
    macosDragPlan.command_sequence.at(-1),
    "du",
    "macOS cliclick drag should release at the destination",
  );

  const macosClickPlan = buildCliclickClickCommands({
    action: "click",
    button: "left",
    x: 120,
    y: 200,
  });
  assert.deepEqual(
    macosClickPlan.command_sequence,
    ["m", "c"],
    "macOS cliclick click should pre-move before clicking",
  );
  assert.equal(
    macosClickPlan.pre_move,
    true,
    "macOS cliclick click should expose pre_move diagnostics",
  );

  const nativeCapabilitiesCall = await rpc.call(
    "tools/call",
    {
      name: "browser_native_input",
      arguments: {
        action: "capabilities",
      },
    },
    timeoutMs,
  );
  assert.equal(nativeCapabilitiesCall?.result?.isError, undefined);
  assertTextJsonContent(nativeCapabilitiesCall.result, "browser_native_input capabilities result");
  const nativeCapabilitiesPayload = firstJsonContent(nativeCapabilitiesCall.result);
  assert.equal(nativeCapabilitiesPayload?.status, "success");
  assert.equal(nativeCapabilitiesPayload?.action, "capabilities");
  assert.equal(typeof nativeCapabilitiesPayload?.platform, "string");
  assert.equal(Array.isArray(nativeCapabilitiesPayload?.supported_actions), true);
  assert.equal(Array.isArray(nativeCapabilitiesPayload?.unsupported_actions), true);
  assert.equal(
    nativeCapabilitiesPayload?.supported_actions?.includes("drag")
      || nativeCapabilitiesPayload?.unsupported_actions?.includes("drag"),
    true,
  );

  const nativeDryRunCall = await rpc.call(
    "tools/call",
    {
      name: "browser_native_input",
      arguments: {
        action: "click",
        x: 120,
        y: 200,
        button: "left",
        dry_run: true,
      },
    },
    timeoutMs,
  );
  assert.equal(nativeDryRunCall?.result?.isError, undefined);
  const nativeDryRunPayload = firstJsonContent(nativeDryRunCall.result);
  assert.equal(nativeDryRunPayload?.status, "success");
  assert.equal(nativeDryRunPayload?.action, "click");
  assert.equal(nativeDryRunPayload?.dry_run, true);
  assert.equal(typeof nativeDryRunPayload?.next_step, "string");
  assert.equal(typeof nativeDryRunPayload?.capabilities_summary?.supported, "boolean");

  const nativeDragDryRunCall = await rpc.call(
    "tools/call",
    {
      name: "browser_native_input",
      arguments: {
        action: "drag",
        from_x: 120,
        from_y: 200,
        to_x: 260,
        to_y: 200,
        duration_ms: 700,
        steps: 12,
        dry_run: true,
      },
    },
    timeoutMs,
  );
  assert.equal(nativeDragDryRunCall?.result?.isError, undefined);
  const nativeDragDryRunPayload = firstJsonContent(nativeDragDryRunCall.result);
  assert.equal(nativeDragDryRunPayload?.status, "success");
  assert.equal(nativeDragDryRunPayload?.action, "drag");
  assert.equal(nativeDragDryRunPayload?.dry_run, true);
  assert.equal(nativeDragDryRunPayload?.validated_args?.from_x, 120);
  assert.equal(nativeDragDryRunPayload?.validated_args?.to_x, 260);

  const nativeUnsupportedCall = await rpc.call(
    "tools/call",
    {
      name: "browser_native_input",
      arguments: {
        action: "not_supported_action",
      },
    },
    timeoutMs,
  );
  assert.equal(nativeUnsupportedCall?.result?.isError, true);
  const nativeUnsupportedPayload = firstJsonContent(nativeUnsupportedCall.result);
  assert.equal(nativeUnsupportedPayload?.tool, "browser_native_input");
  assert.equal(nativeUnsupportedPayload?.error_code, "ACTION_NOT_SUPPORTED");

  return {
    nativeCapabilitiesPayload,
    nativeDragDryRunPayload,
    nativeDryRunPayload,
    nativeUnsupportedPayload,
  };
}

export { assertNativeInputOpsContract };
