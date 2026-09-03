import assert from "node:assert/strict";

import {
  assertTextJsonContent,
  firstJsonContent,
} from "./rpc-content.mjs";
import {
  buildViewportOverrideVerification,
} from "../../src/browser-screenshot/verification.mjs";
import {
  normalizeClip,
} from "../../src/browser-screenshot/clip.mjs";
import {
  buildFullPageClip,
  buildSelectorClip,
} from "../../src/browser-screenshot/capture-targets.mjs";
import {
  buildTmwdViewportScreenshotBatch,
  parseTmwdViewportScreenshotBatchResults,
} from "../../src/browser-screenshot/transport.mjs";

async function assertScreenshotOpsContract({ rpc, timeoutMs }) {
  const assertBitmapBudgetError = (error) => {
    assert.equal(error?.errorCode, "INVALID_ARGUMENT");
    assert.equal(error?.details?.area_css_pixels, 10_000);
    assert.equal(error?.details?.device_pixel_ratio, 2);
    assert.equal(error?.details?.capture_scale, 1);
    assert.equal(error?.details?.area_bitmap_pixels, 40_000);
    assert.equal(error?.details?.max_pixels, 10_000);
    return true;
  };

  assert.throws(
    () => normalizeClip({ x: 0, y: 0, width: 100, height: 100, scale: 1 }, {
      dpr: 2,
      maxPixels: 10_000,
      label: "clip",
    }),
    assertBitmapBudgetError,
  );

  const scaledHiDpiClip = normalizeClip(
    { x: 0, y: 0, width: 100, height: 100, scale: 0.5 },
    { dpr: 2, maxPixels: 10_000, label: "clip" },
  );
  assert.equal(scaledHiDpiClip.area_css_pixels, 10_000);
  assert.equal(scaledHiDpiClip.device_pixel_ratio, 2);
  assert.equal(scaledHiDpiClip.capture_scale, 0.5);
  assert.equal(scaledHiDpiClip.bitmap_width, 100);
  assert.equal(scaledHiDpiClip.bitmap_height, 100);
  assert.equal(scaledHiDpiClip.area_bitmap_pixels, 10_000);

  assert.throws(
    () => buildSelectorClip({
      ok: true,
      selector: "#hidpi-target",
      rect: { left: 0, top: 0, width: 100, height: 100 },
      page: {
        viewport: {
          device_pixel_ratio: 2,
          scroll_x: 0,
          scroll_y: 0,
        },
      },
    }, 10_000),
    assertBitmapBudgetError,
  );

  assert.throws(
    () => buildFullPageClip({
      viewport: { device_pixel_ratio: 2 },
      document: { scroll_width: 100, scroll_height: 100 },
    }, 10_000),
    assertBitmapBudgetError,
  );

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

  const selectorPreflight = buildTmwdViewportScreenshotBatch({
    viewportParams: { width: 390, height: 844, deviceScaleFactor: 2 },
    settleScript: "return { ok: true };",
    pageMetadataScript: "return { viewport: { inner_width: 390, inner_height: 844 } };",
    layoutMetricsScript: "return { horizontal_overflow: false };",
    targetScript: "return { ok: true, rect: { left: 8, top: 16, width: 120, height: 80 } };",
    screenshotParams: null,
  });
  assert.deepEqual(
    selectorPreflight.command.commands.map((command) => command.method),
    [
      "Emulation.setDeviceMetricsOverride",
      "Runtime.evaluate",
      "Runtime.evaluate",
      "Runtime.evaluate",
      "Runtime.evaluate",
      "Emulation.clearDeviceMetricsOverride",
    ],
  );
  assert.equal(selectorPreflight.result_indexes.screenshot, null);
  const parsedSelectorPreflight = parseTmwdViewportScreenshotBatchResults({
    raw: { ok: true },
    value: [
      {},
      { result: { type: "object", value: { ok: true } } },
      { result: { type: "object", value: { viewport: { inner_width: 390, inner_height: 844 } } } },
      { result: { type: "object", value: { horizontal_overflow: false } } },
      { result: { type: "object", value: { ok: true, rect: { left: 8, top: 16, width: 120, height: 80 } } } },
      {},
    ],
  }, selectorPreflight);
  assert.equal(parsedSelectorPreflight.target.rect.width, 120);
  assert.equal(parsedSelectorPreflight.base64, undefined);
  assert.equal(parsedSelectorPreflight.cleanup.cleared, true);

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

  const persistentViewportCall = await rpc.call(
    "tools/call",
    {
      name: "browser_screenshot_ops",
      arguments: {
        action: "capture",
        target: "viewport",
        viewport: {
          width: 390,
          height: 844,
          clear_after: false,
        },
        prepare_run: false,
      },
    },
    timeoutMs,
  );
  assert.equal(persistentViewportCall?.result?.isError, true);
  const persistentViewportPayload = firstJsonContent(persistentViewportCall.result);
  assert.equal(persistentViewportPayload?.error_code, "INVALID_ARGUMENT");
  assert.equal(persistentViewportPayload?.details?.persistent_viewport_override_supported, false);

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

  const clippedViewportVerification = buildViewportOverrideVerification({
    target: "selector",
    captureClip: { x: 10, y: 20, width: 120, height: 80, scale: 1 },
    page: {
      viewport: {
        inner_width: 390,
        inner_height: 844,
        device_pixel_ratio: 2,
      },
    },
    artifact: { width: 240, height: 160 },
    viewportOverrideResult: {
      requested: { width: 390, height: 844, dpr: 2 },
    },
  });
  assert.equal(clippedViewportVerification?.ok, true);
  assert.equal(clippedViewportVerification?.artifact?.scope, "capture_clip_png_dimensions");
  assert.equal(clippedViewportVerification?.artifact?.expected?.width, 240);
  assert.equal(clippedViewportVerification?.artifact?.expected?.height, 160);

  return {
    missing_clip_error_code: missingClipPayload.error_code,
    missing_selector_error_code: missingSelectorPayload.error_code,
    invalid_format_error_code: invalidFormatPayload.error_code,
    invalid_viewport_error_code: invalidViewportPayload.error_code,
    persistent_viewport_error_code: persistentViewportPayload.error_code,
    tmwd_viewport_atomic_batch: "enabled",
    tmwd_selector_preflight_atomic_batch: "enabled",
    viewport_artifact_dimension_guard: "enabled",
    hidpi_bitmap_pixel_guard: "enabled",
  };
}

export {
  assertScreenshotOpsContract,
};
