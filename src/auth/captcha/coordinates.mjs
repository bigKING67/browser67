import { CAPTCHA_ASSIST_RETRY_AFTER_MS } from "../manual-challenge.mjs";

function finiteNumber(raw) {
  const value = Number(raw);
  return Number.isFinite(value) ? value : null;
}

function roundCoordinate(raw) {
  const value = finiteNumber(raw);
  return value === null ? null : Math.round(value * 100) / 100;
}

function normalizeWaitAfterMs(raw) {
  const parsed = finiteNumber(raw);
  if (parsed === null) {
    return CAPTCHA_ASSIST_RETRY_AFTER_MS;
  }
  return Math.max(CAPTCHA_ASSIST_RETRY_AFTER_MS, Math.min(30_000, Math.round(parsed)));
}

function normalizeDragDurationMs(raw) {
  const parsed = finiteNumber(raw);
  if (parsed === null) {
    return 700;
  }
  return Math.max(0, Math.min(10_000, Math.round(parsed)));
}

function normalizeDragSteps(raw) {
  const parsed = finiteNumber(raw);
  if (parsed === null) {
    return 16;
  }
  return Math.max(1, Math.min(240, Math.round(parsed)));
}

function normalizePreInputSettleMs(raw) {
  const parsed = finiteNumber(raw);
  if (parsed === null) {
    return 0;
  }
  return Math.max(0, Math.min(5_000, Math.round(parsed)));
}

function buildSliderDragHint(target) {
  const rect = target?.rect;
  if (!rect || target?.role !== "slider") {
    return undefined;
  }
  const inset = Math.max(6, Math.min(rect.width * 0.18, rect.height * 0.65, 42));
  const centerY = rect.top + rect.height / 2;
  return {
    coordinate_system: "viewport_css_pixels",
    confidence: target.confidence === "high" ? "medium" : "low",
    from_client: {
      x: Math.round((rect.left + inset) * 100) / 100,
      y: Math.round(centerY * 100) / 100,
    },
    to_client: {
      x: Math.round((rect.right - inset) * 100) / 100,
      y: Math.round(centerY * 100) / 100,
    },
    note: "Heuristic only. Convert viewport CSS pixels to screen pixels with window rect, viewport offset, DPR/UI chrome offsets, then confirm visually before physical drag.",
  };
}

function clampRectToViewport(rect, viewport = {}, margin = 12) {
  if (!rect) {
    return undefined;
  }
  const innerWidth = finiteNumber(viewport.inner_width);
  const innerHeight = finiteNumber(viewport.inner_height);
  const left = Math.max(0, Number(rect.left ?? 0) - margin);
  const top = Math.max(0, Number(rect.top ?? 0) - margin);
  const rightLimit = innerWidth === null ? Number(rect.right ?? 0) + margin : innerWidth;
  const bottomLimit = innerHeight === null ? Number(rect.bottom ?? 0) + margin : innerHeight;
  const right = Math.max(left + 1, Math.min(rightLimit, Number(rect.right ?? 0) + margin));
  const bottom = Math.max(top + 1, Math.min(bottomLimit, Number(rect.bottom ?? 0) + margin));
  return {
    x: roundCoordinate(left),
    y: roundCoordinate(top),
    width: roundCoordinate(right - left),
    height: roundCoordinate(bottom - top),
    scale: 1,
    coordinate_system: "viewport_css_pixels",
  };
}

function estimateViewportOriginScreen(viewport = {}) {
  const screenX = finiteNumber(viewport.screen_x);
  const screenY = finiteNumber(viewport.screen_y);
  const innerWidth = finiteNumber(viewport.inner_width);
  const innerHeight = finiteNumber(viewport.inner_height);
  const outerWidth = finiteNumber(viewport.outer_width);
  const outerHeight = finiteNumber(viewport.outer_height);
  if (screenX === null || screenY === null || innerWidth === null || innerHeight === null) {
    return null;
  }
  const chromeWidth = outerWidth === null ? 0 : Math.max(0, outerWidth - innerWidth);
  const chromeHeight = outerHeight === null ? 0 : Math.max(0, outerHeight - innerHeight);
  const sideInset = chromeWidth > 0 ? chromeWidth / 2 : 0;
  const topInset = chromeHeight > 0 ? Math.max(0, chromeHeight - sideInset) : 0;
  return {
    x: roundCoordinate(screenX + sideInset),
    y: roundCoordinate(screenY + topInset),
    top_chrome_inset: roundCoordinate(topInset),
    top_chrome_inset_source: outerHeight !== null && innerHeight !== null
      ? "outerHeight-innerHeight"
      : "unavailable",
    confidence: outerWidth !== null && outerHeight !== null ? "medium" : "low",
    method: "window.screen + outer/inner viewport chrome estimate",
    metrics_warning: chromeHeight === 0
      ? "outerHeight-innerHeight is zero; metrics can be stale before foreground activation"
      : undefined,
    assumptions: [
      "screenX/screenY refer to the browser outer window",
      "outerWidth/outerHeight include browser chrome and frame",
      "side frame inset is approximated from outerWidth-innerWidth",
      "top chrome inset is approximated from outerHeight-innerHeight",
    ],
  };
}

function clientPointToScreenEstimate(point, viewport = {}) {
  const origin = estimateViewportOriginScreen(viewport);
  const x = finiteNumber(point?.x);
  const y = finiteNumber(point?.y);
  if (!origin || x === null || y === null) {
    return null;
  }
  const visual = viewport.visual_viewport && typeof viewport.visual_viewport === "object"
    ? viewport.visual_viewport
    : {};
  const offsetLeft = finiteNumber(visual.offset_left) ?? 0;
  const offsetTop = finiteNumber(visual.offset_top) ?? 0;
  const scale = finiteNumber(visual.scale) ?? 1;
  return {
    x: roundCoordinate(origin.x + ((x - offsetLeft) * scale)),
    y: roundCoordinate(origin.y + ((y - offsetTop) * scale)),
    coordinate_system: "screen_pixels_estimate",
    confidence: origin.confidence,
    method: "viewport_css_pixels_to_screen_pixels_estimate",
  };
}

function buildVisionCorrectionPlan(screenshotClip, physicalInput = {}) {
  const captureSelection = physicalInput.capture_provider_selection;
  const captureProvider = physicalInput.selected_capture_provider;
  const captureSupported = Array.isArray(captureProvider?.supported_actions)
    && captureProvider.supported_actions.includes("capture_window_region");
  return {
    status: screenshotClip ? (captureSupported ? "capture_ready" : "planned") : "unavailable",
    method: "window_or_region_screenshot_then_visual_control_alignment",
    correction_status: "not_run",
    fullscreen_allowed: false,
    screenshot_method: captureSupported
      ? "physical_input_provider.capture_window_region"
      : "CDP Page.captureScreenshot with clip or ljq_driver window-region capture",
    screenshot_clip: screenshotClip,
    capture_provider_selection: captureSelection,
    capture_provider: captureProvider,
    executable_region_capture_available: Boolean(screenshotClip && captureSupported),
    confidence_gate_required: true,
    minimum_confidence_to_execute: 0.85,
    note: "Use this region for visual verification/correction before physical input. Do not capture fullscreen and do not click CAPTCHA through JS/CDP.",
  };
}

function buildCoordinateTransformPlan(pageState = {}, target = null, sliderDragHint = undefined, physicalInput = {}) {
  const viewport = pageState.viewport ?? {};
  const screenshotClip = clampRectToViewport(target?.rect, viewport);
  const clickScreen = target?.center_client
    ? clientPointToScreenEstimate(target.center_client, viewport)
    : null;
  const dragFrom = sliderDragHint?.from_client
    ? clientPointToScreenEstimate(sliderDragHint.from_client, viewport)
    : null;
  const dragTo = sliderDragHint?.to_client
    ? clientPointToScreenEstimate(sliderDragHint.to_client, viewport)
    : null;
  return {
    source_coordinate_system: "viewport_css_pixels",
    target_coordinate_system: "screen_pixels",
    estimate_method: "browser_window_metrics",
    auto_estimate_available: Boolean(clickScreen || (dragFrom && dragTo)),
    safe_to_auto_execute_without_confirmation: false,
    can_use_with_explicit_confirmation: Boolean(clickScreen || (dragFrom && dragTo)),
    required_execution_confirmations: [
      "confirm_physical_input:true",
      "confirm_auto_coordinates:true",
      "foreground_window_confirmation",
    ],
    viewport_origin_screen_estimate: estimateViewportOriginScreen(viewport) ?? undefined,
    screen_estimate: {
      click: clickScreen ?? undefined,
      drag: (dragFrom && dragTo)
        ? {
          from: dragFrom,
          to: dragTo,
        }
        : undefined,
    },
    vision_correction_plan: buildVisionCorrectionPlan(screenshotClip, physicalInput),
    caveats: [
      "Browser chrome/toolbars, iframe nesting, DPR, OS scaling, and multi-monitor layout can shift final physical pixels.",
      "Physical execution still requires managed tab ownership, foreground window confirmation, and explicit user/operator confirmation.",
    ],
  };
}

export {
  buildCoordinateTransformPlan,
  buildSliderDragHint,
  buildVisionCorrectionPlan,
  clientPointToScreenEstimate,
  clampRectToViewport,
  estimateViewportOriginScreen,
  finiteNumber,
  normalizeDragDurationMs,
  normalizeDragSteps,
  normalizePreInputSettleMs,
  normalizeWaitAfterMs,
  roundCoordinate,
};
