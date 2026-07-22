import {
  assertPixelBudget,
  finiteNumber,
  roundCoordinate,
} from "./clip.mjs";
import { INTERNAL_SELECTOR_METRIC_KEY } from "./request.mjs";

function metricSelectorResult(metric, layoutMetrics, selector) {
  if (!metric?.found) {
    return null;
  }
  return {
    ok: true,
    selector,
    rect: metric.rect,
    computed: metric.computed ?? null,
    page: {
      url: String(layoutMetrics?.url || ""),
      title: String(layoutMetrics?.title || ""),
      viewport: layoutMetrics?.viewport ?? {},
      document: layoutMetrics?.document ?? {},
    },
  };
}

function buildFullPageClip(page, maxPixels) {
  const width = roundCoordinate(page?.document?.scroll_width);
  const height = roundCoordinate(page?.document?.scroll_height);
  assertPixelBudget(width, height, maxPixels, "full_page");
  return {
    x: 0,
    y: 0,
    width,
    height,
    scale: 1,
  };
}

function buildSelectorClip(selectorResult, maxPixels) {
  if (!selectorResult?.ok) {
    return {
      ok: false,
      reason: selectorResult?.reason ?? "selector_not_found",
      selector: selectorResult?.selector,
    };
  }
  const rect = selectorResult.rect ?? {};
  const page = selectorResult.page ?? {};
  const scrollX = finiteNumber(page.viewport?.scroll_x) ?? 0;
  const scrollY = finiteNumber(page.viewport?.scroll_y) ?? 0;
  const left = finiteNumber(rect.left);
  const top = finiteNumber(rect.top);
  const width = finiteNumber(rect.width);
  const height = finiteNumber(rect.height);
  if (left === null || top === null || width === null || height === null || width <= 0 || height <= 0) {
    return {
      ok: false,
      reason: "selector_empty_rect",
      selector: selectorResult.selector,
      rect,
    };
  }
  assertPixelBudget(width, height, maxPixels, "selector");
  return {
    ok: true,
    clip: {
      x: roundCoordinate(left + scrollX),
      y: roundCoordinate(top + scrollY),
      width: roundCoordinate(width),
      height: roundCoordinate(height),
      scale: 1,
    },
    rect,
    page,
  };
}

function selectorFailureStatus(reason) {
  if (reason === "selector_empty_rect") {
    return "empty_rect";
  }
  if (String(reason || "").startsWith("selector_detached")) {
    return "detached";
  }
  return "not_found";
}

function resolveSelectorFallback({
  layoutMetrics,
  maxPixels,
  primaryReason,
  selector,
}) {
  const selectors = layoutMetrics?.selectors;
  if (!selectors || typeof selectors !== "object") {
    return null;
  }
  const match = Object.entries(selectors).find(([name, metric]) => (
    name === INTERNAL_SELECTOR_METRIC_KEY
    || String(metric?.selector ?? "").trim() === selector
  ));
  if (!match) {
    return null;
  }
  const [metricName, metric] = match;
  const selectorResult = metricSelectorResult(metric, layoutMetrics, selector);
  if (!selectorResult) {
    return null;
  }
  const selectorClip = buildSelectorClip(selectorResult, maxPixels);
  if (!selectorClip.ok) {
    return null;
  }
  return {
    ...selectorClip,
    source: "layout_metrics",
    metric_name: metricName,
    original_reason: primaryReason,
    metric: {
      found: true,
      selector: metric.selector,
      rect: metric.rect,
      computed: metric.computed,
    },
  };
}

function responseLayoutMetrics(layoutMetrics, {
  includeInternalSelectorMetric = false,
} = {}) {
  if (!layoutMetrics || typeof layoutMetrics !== "object") {
    return undefined;
  }
  if (includeInternalSelectorMetric) {
    return layoutMetrics;
  }
  const selectors = layoutMetrics.selectors;
  if (!selectors || typeof selectors !== "object") {
    return layoutMetrics;
  }
  return {
    ...layoutMetrics,
    selectors: Object.fromEntries(
      Object.entries(selectors).filter(([name]) => name !== INTERNAL_SELECTOR_METRIC_KEY),
    ),
  };
}

export {
  buildFullPageClip,
  buildSelectorClip,
  resolveSelectorFallback,
  responseLayoutMetrics,
  selectorFailureStatus,
};
