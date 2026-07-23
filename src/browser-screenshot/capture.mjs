import { createToolError } from "../runtime/tool-errors.mjs";
import { mergeTransportAttempts } from "../runtime/transport-attempts.mjs";
import { resolvePreferredBrowserContext } from "../tmwd-runtime/index.mjs";
import { writeScreenshotArtifact } from "./artifact.mjs";
import {
  buildFullPageClip,
  buildSelectorClip,
  resolveSelectorFallback,
  responseLayoutMetrics,
  selectorFailureStatus,
} from "./capture-targets.mjs";
import {
  finiteNumber,
  normalizeClip,
} from "./clip.mjs";
import {
  PAGE_METADATA_SCRIPT,
  layoutMetricsScript,
  selectorClipScript,
  viewportOverrideSettleScript,
} from "./page-scripts.mjs";
import { normalizeScreenshotRequest } from "./request.mjs";
import {
  evaluatePageScript,
  runCdpBrowserCommand,
  runCdpScreenshot,
} from "./transport.mjs";
import {
  assertViewportOverrideArtifactVerification,
  assertViewportOverridePageVerification,
  buildViewportOverrideVerification,
} from "./verification.mjs";

function absorbTransportResult(state, result) {
  state.preferred = result.preferred;
  state.transportAttempts = mergeTransportAttempts(
    state.transportAttempts,
    result.transport_attempts,
  );
  return result;
}

async function applyViewportOverride(args, request, state) {
  if (!request.viewportOverride) return;

  const applied = absorbTransportResult(state, await runCdpBrowserCommand(
    args,
    state.preferred,
    "Emulation.setDeviceMetricsOverride",
    request.viewportOverride.cdp_params,
    state.runtimeOptions,
  ));
  state.viewportOverrideResult = {
    applied: true,
    requested: request.viewportOverride.requested,
    cdp_params: request.viewportOverride.cdp_params,
  };
  const settled = absorbTransportResult(state, await evaluatePageScript(
    args,
    applied.preferred,
    viewportOverrideSettleScript(request.viewportOverride.requested),
    state.runtimeOptions,
  ));
  state.viewportOverrideResult.settle = settled.value;
}

async function readPageState(args, request, state) {
  const pageEval = absorbTransportResult(
    state,
    await evaluatePageScript(args, state.preferred, PAGE_METADATA_SCRIPT, state.runtimeOptions),
  );
  state.page = pageEval.value;
  if (state.viewportOverrideResult) {
    const pageVerification = buildViewportOverrideVerification({
      page: state.page,
      target: request.target,
      viewportOverrideResult: state.viewportOverrideResult,
    });
    state.viewportOverrideResult.verification = {
      page: pageVerification?.page,
    };
    assertViewportOverridePageVerification(pageVerification?.page);
  }

  if (request.includeLayoutMetrics) {
    const metricsEval = absorbTransportResult(
      state,
      await evaluatePageScript(
        args,
        state.preferred,
        layoutMetricsScript(request.effectiveLayoutSelectors),
        state.runtimeOptions,
      ),
    );
    state.layoutMetrics = metricsEval.value;
  }
}

function selectorFailureResponse(request, state, selectorClip) {
  return {
    ok: false,
    status: selectorFailureStatus(selectorClip.reason),
    tool: "browser_screenshot_ops",
    action: "capture",
    target: request.target,
    selector: selectorClip.selector ?? request.requestedSelector,
    reason: selectorClip.reason,
    page: state.page,
    layout_metrics: request.callerRequestedLayoutMetrics
      ? responseLayoutMetrics(state.layoutMetrics)
      : undefined,
    viewport_override: state.viewportOverrideResult ?? undefined,
    selector_fallback: {
      used: false,
      reason: "layout_metrics_unavailable_or_invalid",
    },
    transport: state.preferred.transport,
    tab_id: state.preferred.context?.target?.id,
    session_id: state.preferred.context?.target?.id,
    transport_attempts: state.transportAttempts,
  };
}

async function resolveSelectorTarget(args, request, state) {
  const selectorEval = absorbTransportResult(
    state,
    await evaluatePageScript(
      args,
      state.preferred,
      selectorClipScript(request.requestedSelector),
      state.runtimeOptions,
    ),
  );
  const selectorResult = selectorEval.value;
  const selectorClip = buildSelectorClip(selectorResult, request.maxPixels);
  if (selectorClip.ok) {
    state.selector = selectorResult.selector;
    state.selectorRect = selectorClip.rect;
    state.page = selectorClip.page;
    state.clip = selectorClip.clip;
    state.cdpClip = selectorClip.clip;
    return null;
  }

  const fallback = resolveSelectorFallback({
    layoutMetrics: state.layoutMetrics,
    maxPixels: request.maxPixels,
    primaryReason: selectorClip.reason,
    selector: request.requestedSelector,
  });
  if (!fallback) {
    return selectorFailureResponse(request, state, selectorClip);
  }
  state.selectorFallback = {
    used: true,
    source: fallback.source,
    metric_name: fallback.metric_name,
    original_reason: fallback.original_reason,
    metric: fallback.metric,
  };
  state.selector = request.requestedSelector;
  state.selectorRect = fallback.rect;
  state.page = fallback.page;
  state.clip = fallback.clip;
  state.cdpClip = fallback.clip;
  return null;
}

async function resolveCaptureTarget(args, request, state) {
  if (request.target === "clip") {
    const normalized = normalizeClip(args.clip, {
      maxPixels: request.maxPixels,
      label: "clip",
    });
    state.clip = normalized.clip;
    state.cdpClip = normalized.clip;
    return null;
  }
  if (request.target === "selector") {
    return resolveSelectorTarget(args, request, state);
  }
  if (request.target === "full_page") {
    state.cdpClip = buildFullPageClip(state.page, request.maxPixels);
    state.clip = state.cdpClip;
    state.captureBeyondViewport = true;
  }
  return null;
}

async function captureArtifact(args, request, state) {
  const screenshot = absorbTransportResult(state, await runCdpScreenshot(
    args,
    state.preferred,
    {
      format: "png",
      fromSurface: true,
      captureBeyondViewport: state.captureBeyondViewport,
      ...(state.cdpClip ? { clip: state.cdpClip } : {}),
    },
    state.runtimeOptions,
  ));
  if (typeof screenshot.base64 !== "string" || screenshot.base64.length < 16) {
    throw createToolError("EXECUTION_ERROR", "Page.captureScreenshot did not return PNG data", {
      retryable: false,
    });
  }
  const artifact = await writeScreenshotArtifact({
    args,
    bytes: Buffer.from(screenshot.base64, "base64"),
    target: request.target,
    title: args.title ?? state.page?.title ?? "",
    clip: state.clip,
    cdpClip: state.cdpClip,
  });
  if (state.viewportOverrideResult) {
    const verification = buildViewportOverrideVerification({
      artifact: artifact.artifact,
      page: state.page,
      target: request.target,
      viewportOverrideResult: state.viewportOverrideResult,
    });
    state.viewportOverrideResult.verification = verification;
    assertViewportOverrideArtifactVerification(verification, artifact.artifact);
  }
  return artifact;
}

function successResponse(args, request, state, artifact) {
  return {
    ok: true,
    status: "success",
    tool: "browser_screenshot_ops",
    action: "capture",
    target: request.target,
    transport: state.preferred.transport,
    tab_id: state.preferred.context?.target?.id,
    session_id: state.preferred.context?.target?.id,
    selection: state.preferred.context?.selection,
    selection_source: state.preferred.context?.selection?.selected_by ?? null,
    page: args.include_page_metadata === false ? undefined : state.page,
    layout_metrics: (request.callerRequestedLayoutMetrics || state.selectorFallback?.used)
      ? responseLayoutMetrics(state.layoutMetrics, {
        includeInternalSelectorMetric: state.selectorFallback?.used,
      })
      : undefined,
    viewport_override: state.viewportOverrideResult ?? undefined,
    selector: state.selector ?? undefined,
    selector_rect: state.selectorRect ?? undefined,
    selector_fallback: state.selectorFallback ?? undefined,
    capture: {
      method: "Page.captureScreenshot",
      format: "png",
      from_surface: true,
      capture_beyond_viewport: state.captureBeyondViewport,
      clip: state.clip,
      max_pixels: request.maxPixels,
      area_css_pixels: state.clip
        ? finiteNumber(state.clip.width) * finiteNumber(state.clip.height)
        : undefined,
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
    transport_attempts: state.transportAttempts,
  };
}

async function clearViewportOverride(args, request, state) {
  if (!request.viewportOverride || request.viewportOverride.requested.clear_after === false) {
    return;
  }
  let cleanup;
  try {
    const cleared = absorbTransportResult(state, await runCdpBrowserCommand(
      args,
      state.preferred,
      "Emulation.clearDeviceMetricsOverride",
      {},
      state.runtimeOptions,
    ));
    cleanup = {
      cleared: true,
      method: "Emulation.clearDeviceMetricsOverride",
    };
    state.preferred = cleared.preferred;
  } catch (error) {
    cleanup = {
      cleared: false,
      method: "Emulation.clearDeviceMetricsOverride",
      error: String(error?.message ?? error),
    };
  }
  if (state.viewportOverrideResult) {
    state.viewportOverrideResult.cleanup = cleanup;
  }
}

async function captureBrowserScreenshot(args = {}, runtimeOptions = {}) {
  const request = normalizeScreenshotRequest(args);
  const preferred = await resolvePreferredBrowserContext(args ?? {}, runtimeOptions);
  const state = {
    runtimeOptions,
    preferred,
    transportAttempts: Array.isArray(preferred.transport_attempts)
      ? preferred.transport_attempts
      : [],
    page: null,
    layoutMetrics: null,
    clip: null,
    cdpClip: null,
    selector: null,
    selectorRect: null,
    selectorFallback: null,
    captureBeyondViewport: false,
    viewportOverrideResult: null,
  };

  try {
    await applyViewportOverride(args, request, state);
    await readPageState(args, request, state);
    const targetFailure = await resolveCaptureTarget(args, request, state);
    if (targetFailure) return targetFailure;
    const artifact = await captureArtifact(args, request, state);
    return successResponse(args, request, state, artifact);
  } finally {
    await clearViewportOverride(args, request, state);
  }
}

export {
  captureBrowserScreenshot,
};
