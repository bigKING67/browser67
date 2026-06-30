import {
  mergeTransportAttempts,
  normalizeTmwdTransportLabel,
} from "../common.mjs";
import {
  cdpEvaluateScript,
  cdpRunCommand,
} from "../cdp-runtime.mjs";
import { createToolError } from "../errors.mjs";
import {
  executeTmwdJsWithFallback,
  resolvePreferredBrowserContext,
} from "../tmwd-runtime.mjs";
import {
  assertPixelBudget,
  finiteNumber,
  normalizeClip,
  normalizeMaxPixels,
  roundCoordinate,
} from "./clip.mjs";
import { writeScreenshotArtifact } from "./artifact.mjs";

const PAGE_METADATA_SCRIPT = `return (() => {
  const doc = document.documentElement || {};
  const body = document.body || {};
  const visualViewport = window.visualViewport ? {
    width: window.visualViewport.width,
    height: window.visualViewport.height,
    offset_left: window.visualViewport.offsetLeft,
    offset_top: window.visualViewport.offsetTop,
    page_left: window.visualViewport.pageLeft,
    page_top: window.visualViewport.pageTop,
    scale: window.visualViewport.scale
  } : null;
  const scrollWidth = Math.max(
    Number(doc.scrollWidth || 0),
    Number(body.scrollWidth || 0),
    Number(doc.clientWidth || 0),
    Number(window.innerWidth || 0)
  );
  const scrollHeight = Math.max(
    Number(doc.scrollHeight || 0),
    Number(body.scrollHeight || 0),
    Number(doc.clientHeight || 0),
    Number(window.innerHeight || 0)
  );
  return {
    url: String(location.href || ""),
    title: String(document.title || ""),
    viewport: {
      inner_width: Number(window.innerWidth || 0),
      inner_height: Number(window.innerHeight || 0),
      outer_width: Number(window.outerWidth || 0),
      outer_height: Number(window.outerHeight || 0),
      scroll_x: Number(window.scrollX || 0),
      scroll_y: Number(window.scrollY || 0),
      screen_x: Number(window.screenX || 0),
      screen_y: Number(window.screenY || 0),
      device_pixel_ratio: Number(window.devicePixelRatio || 1),
      visual_viewport: visualViewport
    },
    document: {
      scroll_width: scrollWidth,
      scroll_height: scrollHeight,
      client_width: Number(doc.clientWidth || 0),
      client_height: Number(doc.clientHeight || 0),
      body_scroll_width: Number(body.scrollWidth || 0),
      body_scroll_height: Number(body.scrollHeight || 0)
    }
  };
})();`;

function selectorClipScript(selector) {
  return `return await (async () => {
  const selector = ${JSON.stringify(selector)};
  const node = document.querySelector(selector);
  if (!node) {
    return { ok: false, reason: "selector_not_found", selector };
  }
  node.scrollIntoView({ block: "center", inline: "center" });
  await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  const rect = node.getBoundingClientRect();
  const page = (() => {
    const doc = document.documentElement || {};
    const body = document.body || {};
    const visualViewport = window.visualViewport ? {
      width: window.visualViewport.width,
      height: window.visualViewport.height,
      offset_left: window.visualViewport.offsetLeft,
      offset_top: window.visualViewport.offsetTop,
      page_left: window.visualViewport.pageLeft,
      page_top: window.visualViewport.pageTop,
      scale: window.visualViewport.scale
    } : null;
    return {
      url: String(location.href || ""),
      title: String(document.title || ""),
      viewport: {
        inner_width: Number(window.innerWidth || 0),
        inner_height: Number(window.innerHeight || 0),
        outer_width: Number(window.outerWidth || 0),
        outer_height: Number(window.outerHeight || 0),
        scroll_x: Number(window.scrollX || 0),
        scroll_y: Number(window.scrollY || 0),
        screen_x: Number(window.screenX || 0),
        screen_y: Number(window.screenY || 0),
        device_pixel_ratio: Number(window.devicePixelRatio || 1),
        visual_viewport: visualViewport
      },
      document: {
        scroll_width: Math.max(Number(doc.scrollWidth || 0), Number(body.scrollWidth || 0), Number(doc.clientWidth || 0), Number(window.innerWidth || 0)),
        scroll_height: Math.max(Number(doc.scrollHeight || 0), Number(body.scrollHeight || 0), Number(doc.clientHeight || 0), Number(window.innerHeight || 0)),
        client_width: Number(doc.clientWidth || 0),
        client_height: Number(doc.clientHeight || 0)
      }
    };
  })();
  return {
    ok: true,
    selector,
    rect: {
      x: rect.x,
      y: rect.y,
      left: rect.left,
      top: rect.top,
      right: rect.right,
      bottom: rect.bottom,
      width: rect.width,
      height: rect.height
    },
    page
  };
})();`;
}

function layoutMetricsScript(selectors) {
  return `return (() => {
  const selectors = ${JSON.stringify(selectors)};
  const doc = document.documentElement || {};
  const body = document.body || {};
  const viewport = {
    inner_width: Number(window.innerWidth || 0),
    inner_height: Number(window.innerHeight || 0),
    device_pixel_ratio: Number(window.devicePixelRatio || 1),
    scroll_x: Number(window.scrollX || 0),
    scroll_y: Number(window.scrollY || 0),
    visual_viewport: window.visualViewport ? {
      width: window.visualViewport.width,
      height: window.visualViewport.height,
      offset_left: window.visualViewport.offsetLeft,
      offset_top: window.visualViewport.offsetTop,
      page_left: window.visualViewport.pageLeft,
      page_top: window.visualViewport.pageTop,
      scale: window.visualViewport.scale
    } : null
  };
  const documentMetrics = {
    scroll_width: Math.max(Number(doc.scrollWidth || 0), Number(body.scrollWidth || 0), Number(doc.clientWidth || 0), Number(window.innerWidth || 0)),
    scroll_height: Math.max(Number(doc.scrollHeight || 0), Number(body.scrollHeight || 0), Number(doc.clientHeight || 0), Number(window.innerHeight || 0)),
    client_width: Number(doc.clientWidth || 0),
    client_height: Number(doc.clientHeight || 0),
    body_scroll_width: Number(body.scrollWidth || 0),
    body_scroll_height: Number(body.scrollHeight || 0)
  };
  const selectorMetrics = {};
  for (const [name, selector] of Object.entries(selectors || {})) {
    const key = String(name || selector || "selector");
    const cssSelector = String(selector || "").trim();
    if (!cssSelector) {
      selectorMetrics[key] = { found: false, selector: cssSelector, reason: "empty_selector" };
      continue;
    }
    const node = document.querySelector(cssSelector);
    if (!node) {
      selectorMetrics[key] = { found: false, selector: cssSelector, reason: "selector_not_found" };
      continue;
    }
    const rect = node.getBoundingClientRect();
    const style = window.getComputedStyle(node);
    selectorMetrics[key] = {
      found: true,
      selector: cssSelector,
      rect: {
        x: rect.x,
        y: rect.y,
        top: rect.top,
        left: rect.left,
        right: rect.right,
        bottom: rect.bottom,
        width: rect.width,
        height: rect.height
      },
      computed: {
        display: style.display,
        visibility: style.visibility,
        position: style.position,
        overflow_x: style.overflowX,
        overflow_y: style.overflowY,
        outline_width: style.outlineWidth,
        outline_style: style.outlineStyle,
        outline_color: style.outlineColor
      }
    };
  }
  return {
    url: String(location.href || ""),
    title: String(document.title || ""),
    viewport,
    document: documentMetrics,
    horizontal_overflow: documentMetrics.scroll_width > viewport.inner_width + 1,
    selectors: selectorMetrics
  };
})();`;
}

function unwrapJsValue(value) {
  if (value && typeof value === "object" && Object.prototype.hasOwnProperty.call(value, "ok")) {
    const hasWrapperPayload = Object.prototype.hasOwnProperty.call(value, "data")
      || Object.prototype.hasOwnProperty.call(value, "results")
      || Object.prototype.hasOwnProperty.call(value, "error");
    if (!hasWrapperPayload) {
      return value;
    }
    if (value.ok === false) {
      throw createToolError(
        "EXECUTION_ERROR",
        String(value.error?.message ?? value.error ?? "page script failed"),
        { retryable: false },
      );
    }
    return Object.prototype.hasOwnProperty.call(value, "data") ? value.data : value.results;
  }
  return value;
}

function extractScreenshotData(executed = {}) {
  const raw = executed.raw;
  const value = executed.value;
  return value?.data
    ?? value?.result?.data
    ?? raw?.data?.data
    ?? raw?.result?.data
    ?? raw?.data
    ?? raw?.result;
}

async function evaluatePageScript(args, preferred, script) {
  if (preferred.transport === "tmwd_ws" || preferred.transport === "tmwd_link") {
    const tmwd = await executeTmwdJsWithFallback(args ?? {}, preferred.context, script);
    return {
      value: unwrapJsValue(tmwd.executed.value),
      preferred: {
        ...preferred,
        transport: normalizeTmwdTransportLabel(tmwd.context.tmwd_transport),
        context: tmwd.context,
      },
      transport_attempts: tmwd.transport_attempts,
    };
  }
  const executed = await cdpEvaluateScript({
    ...args,
    switch_tab_id: preferred.context.target.id,
  }, script);
  return {
    value: unwrapJsValue(executed.result.value),
    preferred,
    transport_attempts: [],
  };
}

async function runCdpScreenshot(args, preferred, params) {
  if (preferred.transport === "tmwd_ws" || preferred.transport === "tmwd_link") {
    const tmwd = await executeTmwdJsWithFallback(args ?? {}, preferred.context, {
      cmd: "cdp",
      method: "Page.captureScreenshot",
      params,
    });
    const base64 = extractScreenshotData(tmwd.executed);
    return {
      base64,
      preferred: {
        ...preferred,
        transport: normalizeTmwdTransportLabel(tmwd.context.tmwd_transport),
        context: tmwd.context,
      },
      transport_attempts: tmwd.transport_attempts,
    };
  }
  const command = await cdpRunCommand({
    ...args,
    switch_tab_id: preferred.context.target.id,
  }, "Page.captureScreenshot", params);
  return {
    base64: command.result.response?.data,
    preferred,
    transport_attempts: [],
  };
}

async function runCdpBrowserCommand(args, preferred, method, params = {}) {
  if (preferred.transport === "tmwd_ws" || preferred.transport === "tmwd_link") {
    const tmwd = await executeTmwdJsWithFallback(args ?? {}, preferred.context, {
      cmd: "cdp",
      method,
      params,
    });
    return {
      value: tmwd.executed.value,
      preferred: {
        ...preferred,
        transport: normalizeTmwdTransportLabel(tmwd.context.tmwd_transport),
        context: tmwd.context,
      },
      transport_attempts: tmwd.transport_attempts,
    };
  }
  const command = await cdpRunCommand({
    ...args,
    switch_tab_id: preferred.context.target.id,
  }, method, params);
  return {
    value: command.result.response,
    preferred,
    transport_attempts: [],
  };
}

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

async function captureBrowserScreenshot(args = {}) {
  const target = String(args.target ?? "viewport").trim() || "viewport";
  const format = String(args.format ?? "png").trim() || "png";
  if (format !== "png") {
    throw createToolError("INVALID_ARGUMENT", "browser_screenshot_ops only supports format=png in v1", {
      retryable: false,
      details: { format },
    });
  }
  if (!["viewport", "clip", "selector", "full_page"].includes(target)) {
    throw createToolError("INVALID_ARGUMENT", `unknown screenshot target: ${target}`, {
      retryable: false,
      details: { accepted_targets: ["viewport", "clip", "selector", "full_page"] },
    });
  }
  if (target === "clip" && (!args.clip || typeof args.clip !== "object")) {
    throw createToolError("INVALID_ARGUMENT", "target=clip requires clip", {
      retryable: false,
      details: { required_fields: ["clip.x", "clip.y", "clip.width", "clip.height"] },
    });
  }
  if (target === "selector" && !String(args.selector ?? "").trim()) {
    throw createToolError("INVALID_ARGUMENT", "target=selector requires selector", {
      retryable: false,
      details: { required_fields: ["selector"] },
    });
  }

  const maxPixels = normalizeMaxPixels(args.max_pixels);
  const viewportOverride = normalizeViewportOverride(args.viewport);
  const layoutSelectors = normalizeLayoutSelectors(args.layout_selectors);
  const includeLayoutMetrics = args.include_layout_metrics === true || Object.keys(layoutSelectors).length > 0;
  let preferred = await resolvePreferredBrowserContext(args ?? {});
  let transportAttempts = Array.isArray(preferred.transport_attempts) ? preferred.transport_attempts : [];
  let page = null;
  let layoutMetrics = null;
  let clip = null;
  let cdpClip = null;
  let selector = null;
  let selectorRect = null;
  let captureBeyondViewport = false;
  let viewportOverrideResult = null;
  let viewportCleanupResult = null;

  try {
    if (viewportOverride) {
      const applied = await runCdpBrowserCommand(
        args,
        preferred,
        "Emulation.setDeviceMetricsOverride",
        viewportOverride.cdp_params,
      );
      preferred = applied.preferred;
      transportAttempts = mergeTransportAttempts(transportAttempts, applied.transport_attempts);
      viewportOverrideResult = {
        applied: true,
        requested: viewportOverride.requested,
        cdp_params: viewportOverride.cdp_params,
      };
    }

    const pageEval = await evaluatePageScript(args, preferred, PAGE_METADATA_SCRIPT);
    preferred = pageEval.preferred;
    transportAttempts = mergeTransportAttempts(transportAttempts, pageEval.transport_attempts);
    page = pageEval.value;

    if (includeLayoutMetrics) {
      const metricsEval = await evaluatePageScript(args, preferred, layoutMetricsScript(layoutSelectors));
      preferred = metricsEval.preferred;
      transportAttempts = mergeTransportAttempts(transportAttempts, metricsEval.transport_attempts);
      layoutMetrics = metricsEval.value;
    }

    if (target === "clip") {
      const normalized = normalizeClip(args.clip, { maxPixels, label: "clip" });
      clip = normalized.clip;
      cdpClip = normalized.clip;
    } else if (target === "selector") {
      const selectorEval = await evaluatePageScript(args, preferred, selectorClipScript(String(args.selector ?? "").trim()));
      preferred = selectorEval.preferred;
      transportAttempts = mergeTransportAttempts(transportAttempts, selectorEval.transport_attempts);
      const selectorResult = selectorEval.value;
      const selectorClip = buildSelectorClip(selectorResult, maxPixels);
      if (!selectorClip.ok) {
        return {
          ok: false,
          status: "not_found",
          tool: "browser_screenshot_ops",
          action: "capture",
          target,
          selector: selectorClip.selector ?? String(args.selector ?? ""),
          reason: selectorClip.reason,
          page,
          layout_metrics: layoutMetrics ?? undefined,
          viewport_override: viewportOverrideResult ?? undefined,
          transport: preferred.transport,
          tab_id: preferred.context?.target?.id,
          session_id: preferred.context?.target?.id,
          transport_attempts: transportAttempts,
        };
      }
      selector = selectorResult.selector;
      selectorRect = selectorClip.rect;
      page = selectorClip.page;
      clip = selectorClip.clip;
      cdpClip = selectorClip.clip;
    } else if (target === "full_page") {
      cdpClip = buildFullPageClip(page, maxPixels);
      clip = cdpClip;
      captureBeyondViewport = true;
    }

    const params = {
      format: "png",
      fromSurface: true,
      captureBeyondViewport,
      ...(cdpClip ? { clip: cdpClip } : {}),
    };
    const screenshot = await runCdpScreenshot(args, preferred, params);
    preferred = screenshot.preferred;
    transportAttempts = mergeTransportAttempts(transportAttempts, screenshot.transport_attempts);
    if (typeof screenshot.base64 !== "string" || screenshot.base64.length < 16) {
      throw createToolError("EXECUTION_ERROR", "Page.captureScreenshot did not return PNG data", {
        retryable: false,
      });
    }
    const bytes = Buffer.from(screenshot.base64, "base64");
    const artifact = await writeScreenshotArtifact({
      args,
      bytes,
      target,
      title: args.title ?? page?.title ?? "",
      clip,
      cdpClip,
    });

    return {
      ok: true,
      status: "success",
      tool: "browser_screenshot_ops",
      action: "capture",
      target,
      transport: preferred.transport,
      tab_id: preferred.context?.target?.id,
      session_id: preferred.context?.target?.id,
      selection: preferred.context?.selection,
      selection_source: preferred.context?.selection?.selected_by ?? null,
      page: args.include_page_metadata === false ? undefined : page,
      layout_metrics: layoutMetrics ?? undefined,
      viewport_override: viewportOverrideResult ?? undefined,
      selector: selector ?? undefined,
      selector_rect: selectorRect ?? undefined,
      capture: {
        method: "Page.captureScreenshot",
        format: "png",
        from_surface: true,
        capture_beyond_viewport: captureBeyondViewport,
        clip,
        max_pixels: maxPixels,
        area_css_pixels: clip ? (finiteNumber(clip.width) * finiteNumber(clip.height)) : undefined,
        returns_base64: false,
      },
      artifact: artifact.artifact,
      run: {
        run_id: artifact.run.run_id,
        group: artifact.run.group,
        workspace_key: artifact.run.workspace_key,
        task_id: artifact.run.task_id,
        run_dir: artifact.run.run_dir,
        artifacts_dir: artifact.run.artifacts_dir,
        prepared: artifact.run_prepared,
      },
      transport_attempts: transportAttempts,
    };
  } finally {
    if (viewportOverride && viewportOverride.requested.clear_after !== false) {
      try {
        const cleared = await runCdpBrowserCommand(args, preferred, "Emulation.clearDeviceMetricsOverride", {});
        preferred = cleared.preferred;
        transportAttempts = mergeTransportAttempts(transportAttempts, cleared.transport_attempts);
        viewportCleanupResult = {
          cleared: true,
          method: "Emulation.clearDeviceMetricsOverride",
        };
      } catch (error) {
        viewportCleanupResult = {
          cleared: false,
          method: "Emulation.clearDeviceMetricsOverride",
          error: String(error?.message ?? error),
        };
      }
      if (viewportOverrideResult) {
        viewportOverrideResult.cleanup = viewportCleanupResult;
      }
    }
  }
}

export {
  captureBrowserScreenshot,
};
