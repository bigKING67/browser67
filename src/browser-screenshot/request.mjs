import { createToolError } from "../errors.mjs";
import {
  finiteNumber,
  normalizeMaxPixels,
} from "./clip.mjs";

const INTERNAL_SELECTOR_METRIC_KEY = "__browser67_target_selector";
const SCREENSHOT_TARGETS = ["viewport", "clip", "selector", "full_page"];

function normalizeViewportOverride(raw) {
  if (!raw || typeof raw !== "object") {
    return null;
  }
  const width = finiteNumber(raw.width);
  const height = finiteNumber(raw.height);
  if (width === null || height === null || width <= 0 || height <= 0) {
    throw createToolError("INVALID_ARGUMENT", "viewport override requires positive width and height", {
      retryable: false,
      details: { required_fields: ["viewport.width", "viewport.height"] },
    });
  }
  const dpr = finiteNumber(raw.dpr ?? raw.device_scale_factor ?? raw.deviceScaleFactor) ?? 1;
  if (dpr <= 0) {
    throw createToolError("INVALID_ARGUMENT", "viewport override dpr must be positive", {
      retryable: false,
      details: { field: "viewport.dpr" },
    });
  }
  const scale = finiteNumber(raw.scale);
  return {
    requested: {
      width: Math.round(width),
      height: Math.round(height),
      dpr,
      is_mobile: raw.is_mobile === true || raw.mobile === true,
      scale: scale ?? undefined,
      clear_after: raw.clear_after !== false,
    },
    cdp_params: {
      width: Math.round(width),
      height: Math.round(height),
      deviceScaleFactor: dpr,
      mobile: raw.is_mobile === true || raw.mobile === true,
      ...(scale !== null ? { scale } : {}),
    },
  };
}

function normalizeLayoutSelectors(raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return {};
  }
  return Object.fromEntries(
    Object.entries(raw)
      .map(([name, selector]) => [String(name ?? "").trim(), String(selector ?? "").trim()])
      .filter(([name, selector]) => name.length > 0 && selector.length > 0),
  );
}

function validateScreenshotRequest(args, target, requestedSelector) {
  const format = String(args.format ?? "png").trim() || "png";
  if (format !== "png") {
    throw createToolError("INVALID_ARGUMENT", "browser_screenshot_ops only supports format=png in v1", {
      retryable: false,
      details: { format },
    });
  }
  if (!SCREENSHOT_TARGETS.includes(target)) {
    throw createToolError("INVALID_ARGUMENT", `unknown screenshot target: ${target}`, {
      retryable: false,
      details: { accepted_targets: SCREENSHOT_TARGETS },
    });
  }
  if (target === "clip" && (!args.clip || typeof args.clip !== "object")) {
    throw createToolError("INVALID_ARGUMENT", "target=clip requires clip", {
      retryable: false,
      details: { required_fields: ["clip.x", "clip.y", "clip.width", "clip.height"] },
    });
  }
  if (target === "selector" && !requestedSelector) {
    throw createToolError("INVALID_ARGUMENT", "target=selector requires selector", {
      retryable: false,
      details: { required_fields: ["selector"] },
    });
  }
}

function normalizeScreenshotRequest(args = {}) {
  const target = String(args.target ?? "viewport").trim() || "viewport";
  const requestedSelector = String(args.selector ?? "").trim();
  validateScreenshotRequest(args, target, requestedSelector);

  const maxPixels = normalizeMaxPixels(args.max_pixels);
  const viewportOverride = normalizeViewportOverride(args.viewport);
  const layoutSelectors = normalizeLayoutSelectors(args.layout_selectors);
  const selectorTargetRequiresMetrics = target === "selector" && requestedSelector.length > 0;
  const effectiveLayoutSelectors = {
    ...layoutSelectors,
    ...(selectorTargetRequiresMetrics ? { [INTERNAL_SELECTOR_METRIC_KEY]: requestedSelector } : {}),
  };
  const callerRequestedLayoutMetrics = args.include_layout_metrics === true
    || Object.keys(layoutSelectors).length > 0;
  return {
    callerRequestedLayoutMetrics,
    effectiveLayoutSelectors,
    includeLayoutMetrics: callerRequestedLayoutMetrics || selectorTargetRequiresMetrics,
    maxPixels,
    requestedSelector,
    target,
    viewportOverride,
  };
}

export {
  INTERNAL_SELECTOR_METRIC_KEY,
  normalizeScreenshotRequest,
};
