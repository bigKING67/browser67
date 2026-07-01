import assert from "node:assert/strict";

import {
  assertTextJsonContent,
  firstJsonContent,
} from "./rpc-content.mjs";

async function assertScreenshotOpsContract({ rpc, timeoutMs }) {
  const missingClipCall = await rpc.call(
    "tools/call",
    {
      name: "browser_screenshot_ops",
      arguments: {
        action: "capture",
        target: "clip",
        prepare_run: false,
      },
    },
    timeoutMs,
  );
  assert.equal(missingClipCall?.result?.isError, true);
  assertTextJsonContent(missingClipCall.result, "browser_screenshot_ops missing clip error");
  const missingClipPayload = firstJsonContent(missingClipCall.result);
  assert.equal(missingClipPayload?.error_code, "INVALID_ARGUMENT");
  assert.equal(missingClipPayload?.retryable, false);

  const missingSelectorCall = await rpc.call(
    "tools/call",
    {
      name: "browser_screenshot_ops",
      arguments: {
        action: "capture",
        target: "selector",
        prepare_run: false,
      },
    },
    timeoutMs,
  );
  assert.equal(missingSelectorCall?.result?.isError, true);
  assertTextJsonContent(missingSelectorCall.result, "browser_screenshot_ops missing selector error");
  const missingSelectorPayload = firstJsonContent(missingSelectorCall.result);
  assert.equal(missingSelectorPayload?.error_code, "INVALID_ARGUMENT");
  assert.equal(missingSelectorPayload?.retryable, false);

  const invalidFormatCall = await rpc.call(
    "tools/call",
    {
      name: "browser_screenshot_ops",
      arguments: {
        action: "capture",
        target: "viewport",
        format: "jpeg",
        prepare_run: false,
      },
    },
    timeoutMs,
  );
  assert.equal(invalidFormatCall?.result?.isError, true);
  assertTextJsonContent(invalidFormatCall.result, "browser_screenshot_ops invalid format error");
  const invalidFormatPayload = firstJsonContent(invalidFormatCall.result);
  assert.equal(invalidFormatPayload?.error_code, "INVALID_ARGUMENT");

  const invalidViewportCall = await rpc.call(
    "tools/call",
    {
      name: "browser_screenshot_ops",
      arguments: {
        action: "capture",
        target: "viewport",
        viewport: {
          width: 0,
          height: 844,
        },
        prepare_run: false,
      },
    },
    timeoutMs,
  );
  assert.equal(invalidViewportCall?.result?.isError, true);
  const invalidViewportPayload = firstJsonContent(invalidViewportCall.result);
  assert.equal(invalidViewportPayload?.error_code, "INVALID_ARGUMENT");

  return {
    missing_clip_error_code: missingClipPayload.error_code,
    missing_selector_error_code: missingSelectorPayload.error_code,
    invalid_format_error_code: invalidFormatPayload.error_code,
    invalid_viewport_error_code: invalidViewportPayload.error_code,
  };
}

export {
  assertScreenshotOpsContract,
};
