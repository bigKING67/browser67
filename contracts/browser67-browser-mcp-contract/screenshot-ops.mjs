import assert from "node:assert/strict";

import {
  assertTextJsonContent,
  firstJsonContent,
} from "./rpc-content.mjs";
import {
  buildViewportOverrideVerification,
} from "../../src/browser-screenshot/verification.mjs";
import {
  buildTmwdViewportScreenshotBatch,
  parseTmwdViewportScreenshotBatchResults,
} from "../../src/browser-screenshot/transport.mjs";

async function assertScreenshotOpsContract({ rpc, timeoutMs }) {
  const atomicBatch = buildTmwdViewportScreenshotBatch({
    viewportParams: {
      width: 390,
      height: 844,
      deviceScaleFactor: 2,
      mobile: true,
      screenWidth: 390,
      screenHeight: 844,
      positionX: 0,
      positionY: 0,
      dontSetVisibleSize: false,
    },
    settleScript: "return { ok: true };",
    pageMetadataScript: "return { viewport: { inner_width: 390, inner_height: 844 } };",
    layoutMetricsScript: "return { horizontal_overflow: false };",
    screenshotParams: {
      format: "png",
      fromSurface: true,
      captureBeyondViewport: false,
    },
  });
  assert.equal(atomicBatch.command.cmd, "batch");
  assert.deepEqual(
    atomicBatch.command.commands.map((command) => command.method),
    [
      "Emulation.setDeviceMetricsOverride",
      "Runtime.evaluate",
      "Runtime.evaluate",
      "Runtime.evaluate",
      "Page.captureScreenshot",
      "Emulation.clearDeviceMetricsOverride",
    ],
  );
  assert.equal(atomicBatch.command.commands[0].params.width, 390);
  assert.match(atomicBatch.command.commands[1].params.expression, /return \{ ok: true \}/);
  assert.equal(atomicBatch.command.commands[4].params.captureBeyondViewport, false);

  const parsedAtomicBatch = parseTmwdViewportScreenshotBatchResults({
    raw: { ok: true },
    value: [
      {},
      { result: { type: "object", value: { ok: true } } },
      {
        result: {
          type: "object",
          value: { viewport: { inner_width: 390, inner_height: 844 } },
        },
      },
      { result: { type: "object", value: { horizontal_overflow: false } } },
      { data: "c2NyZWVuc2hvdC1wbmctZml4dHVyZQ==" },
      {},
    ],
  }, atomicBatch);
  assert.equal(parsedAtomicBatch.page.viewport.inner_width, 390);
  assert.equal(parsedAtomicBatch.layout_metrics.horizontal_overflow, false);
  assert.equal(parsedAtomicBatch.base64, "c2NyZWVuc2hvdC1wbmctZml4dHVyZQ==");
  assert.equal(parsedAtomicBatch.cleanup.cleared, true);

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
  assert.equal(invalidFormatPayload?.error_code, "INVALID_ARGUMENTS");

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
  assert.equal(invalidViewportPayload?.error_code, "INVALID_ARGUMENTS");

  const matchingViewportVerification = buildViewportOverrideVerification({
    target: "viewport",
    page: {
      viewport: {
        inner_width: 390,
        inner_height: 844,
        device_pixel_ratio: 2,
      },
    },
    artifact: {
      width: 780,
      height: 1688,
    },
    viewportOverrideResult: {
      requested: {
        width: 390,
        height: 844,
        dpr: 2,
      },
    },
  });
  assert.equal(matchingViewportVerification?.ok, true);
  assert.equal(matchingViewportVerification?.page?.ok, true);
  assert.equal(matchingViewportVerification?.artifact?.ok, true);
  assert.equal(matchingViewportVerification?.artifact?.expected?.width, 780);
  assert.equal(matchingViewportVerification?.artifact?.expected?.height, 1688);

  const staleDesktopArtifactVerification = buildViewportOverrideVerification({
    target: "viewport",
    page: {
      viewport: {
        inner_width: 390,
        inner_height: 844,
        device_pixel_ratio: 2,
      },
    },
    artifact: {
      width: 3024,
      height: 1620,
    },
    viewportOverrideResult: {
      requested: {
        width: 390,
        height: 844,
        dpr: 2,
      },
    },
  });
  assert.equal(staleDesktopArtifactVerification?.ok, false);
  assert.equal(staleDesktopArtifactVerification?.page?.ok, true);
  assert.equal(staleDesktopArtifactVerification?.artifact?.ok, false);
  assert.equal(staleDesktopArtifactVerification?.artifact?.width?.actual, 3024);
  assert.equal(staleDesktopArtifactVerification?.artifact?.width?.expected, 780);

  return {
    missing_clip_error_code: missingClipPayload.error_code,
    missing_selector_error_code: missingSelectorPayload.error_code,
    invalid_format_error_code: invalidFormatPayload.error_code,
    invalid_viewport_error_code: invalidViewportPayload.error_code,
    tmwd_viewport_atomic_batch: "enabled",
    viewport_artifact_dimension_guard: "enabled",
  };
}

export {
  assertScreenshotOpsContract,
};
