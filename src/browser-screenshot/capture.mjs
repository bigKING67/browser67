import { createToolError } from "../runtime/tool-errors.mjs";
import { createOperationDeadline } from "../runtime/operation-deadline.mjs";
import { mergeTransportAttempts } from "../runtime/transport-attempts.mjs";
import { resolvePreferredBrowserContext } from "../tmwd-runtime/index.mjs";
import { readPngDimensions } from "../image/png-lite.mjs";
import { writeScreenshotArtifact } from "./artifact.mjs";
import {
  buildFullPageClip,
  buildSelectorClip,
  resolveSelectorFallback,
  responseLayoutMetrics,
  selectorFailureStatus,
} from "./capture-targets.mjs";
import {
  assertBitmapPixelBudget,
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
  isTmwdTransport,
  runCdpBrowserCommand,
  runCdpScreenshot,
  runTmwdViewportScreenshotBatch,
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

function phaseArgs(args, state, phase) {
  state.phase = phase;
  return state.deadline.argsFor(args, phase);
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

function shouldUseAtomicViewportCapture(request, state) {
  return request.viewportOverride !== null
    && request.viewportOverride?.requested?.clear_after !== false
    && (isTmwdTransport(state.preferred) || state.preferred?.transport === "cdp");
}

function assertCapturePixelBudget(request, state) {
  const source = state.cdpClip ?? {};
  const viewport = state.page?.viewport ?? {};
  const requestedViewport = request.viewportOverride?.requested ?? {};
  const width = state.cdpClip
    ? source.width
    : finiteNumber(viewport.inner_width) ?? requestedViewport.width;
  const height = state.cdpClip
    ? source.height
    : finiteNumber(viewport.inner_height) ?? requestedViewport.height;
  const dpr = finiteNumber(viewport.device_pixel_ratio)
    ?? finiteNumber(requestedViewport.dpr)
    ?? 1;
  const scale = state.cdpClip ? finiteNumber(source.scale) ?? 1 : 1;
  const budget = assertBitmapPixelBudget(width, height, request.maxPixels, {
    dpr,
    label: request.target,
    scale,
  });
  state.pixelBudget = budget;
  return budget;
}

function selectorFailureResponse(request, state, selectorClip) {
  const target = state.preferred.context?.target ?? {};
  const tabId = String(target.tab_id ?? target.tabId ?? target.id ?? "").trim();
  const sessionId = String(target.session_key ?? target.sessionKey ?? target.id ?? tabId).trim();
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
    browser_instance_id: target.browser_instance_id || undefined,
    tab_id: tabId,
    session_id: sessionId,
    transport_attempts: state.transportAttempts,
  };
}

function acceptSelectorTarget(request, state, selectorResult) {
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
  return acceptSelectorTarget(request, state, selectorEval.value);
}

async function resolveCaptureTarget(args, request, state) {
  if (request.target === "clip") {
    const normalized = normalizeClip(args.clip, {
      dpr: finiteNumber(state.page?.viewport?.device_pixel_ratio) ?? 1,
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

function screenshotParams(state) {
  return {
    format: "png",
    fromSurface: true,
    captureBeyondViewport: state.captureBeyondViewport,
    ...(state.cdpClip ? { clip: state.cdpClip } : {}),
  };
}

async function writeCapturedArtifact(args, request, state, base64) {
  if (typeof base64 !== "string" || base64.length < 16) {
    throw createToolError("SCREENSHOT_CAPTURE_EMPTY", "Page.captureScreenshot did not return PNG data", {
      retryable: true,
      details: {
        failed_phase: "capture_png",
        page_visibility_state: state.page?.visibility_state,
        transport: state.preferred?.transport,
      },
    });
  }
  const bytes = Buffer.from(base64, "base64");
  const dimensions = readPngDimensions(bytes);
  state.actualPixelBudget = assertBitmapPixelBudget(
    dimensions.width,
    dimensions.height,
    request.maxPixels,
    { label: `${request.target} PNG` },
  );
  state.phase = "artifact_write";
  state.deadline.remaining(state.phase);
  const artifact = await writeScreenshotArtifact({
    args,
    bytes,
    target: request.target,
    title: args.title ?? state.page?.title ?? "",
    clip: state.clip,
    cdpClip: state.cdpClip,
  });
  if (state.viewportOverrideResult) {
    const verification = buildViewportOverrideVerification({
      artifact: artifact.artifact,
      captureClip: state.cdpClip,
      page: state.page,
      target: request.target,
      viewportOverrideResult: state.viewportOverrideResult,
    });
    state.viewportOverrideResult.verification = verification;
    assertViewportOverrideArtifactVerification(verification, artifact.artifact);
  }
  return artifact;
}

async function captureArtifact(args, request, state) {
  const screenshot = absorbTransportResult(state, await runCdpScreenshot(
    args,
    state.preferred,
    screenshotParams(state),
    state.runtimeOptions,
  ));
  return writeCapturedArtifact(args, request, state, screenshot.base64);
}

async function prepareAtomicViewportTarget(args, request, state) {
  if (request.target === "viewport") return null;
  if (request.target === "clip") {
    const normalized = normalizeClip(args.clip, {
      dpr: finiteNumber(request.viewportOverride?.requested?.dpr) ?? 1,
      maxPixels: request.maxPixels,
      label: "clip",
    });
    state.clip = normalized.clip;
    state.cdpClip = normalized.clip;
    return null;
  }

  const preflight = absorbTransportResult(state, await runTmwdViewportScreenshotBatch(
    phaseArgs(args, state, "viewport_preflight"),
    state.preferred,
    {
      viewportParams: request.viewportOverride.cdp_params,
      settleScript: viewportOverrideSettleScript(request.viewportOverride.requested),
      pageMetadataScript: PAGE_METADATA_SCRIPT,
      layoutMetricsScript: request.includeLayoutMetrics
        ? layoutMetricsScript(request.effectiveLayoutSelectors)
        : null,
      targetScript: request.target === "selector"
        ? selectorClipScript(request.requestedSelector)
        : null,
      screenshotParams: null,
    },
    state.runtimeOptions,
  ));
  state.viewportOverrideCleanupHandled = preflight.cleanup?.cleared === true;
  state.viewportOverrideResult = {
    applied: true,
    requested: request.viewportOverride.requested,
    cdp_params: request.viewportOverride.cdp_params,
    preflight: {
      settle: preflight.settle,
      cleanup: preflight.cleanup,
    },
    cleanup: preflight.cleanup,
  };
  state.page = preflight.page;
  state.layoutMetrics = preflight.layout_metrics;
  const pageVerification = buildViewportOverrideVerification({
    page: state.page,
    target: request.target,
    viewportOverrideResult: state.viewportOverrideResult,
  });
  state.viewportOverrideResult.verification = {
    page: pageVerification?.page,
  };
  try {
    assertViewportOverridePageVerification(pageVerification?.page);
  } catch (error) {
    error.details = {
      ...(error.details ?? {}),
      probe: {
        settle: preflight.settle,
        viewport: state.page?.viewport,
      },
    };
    throw error;
  }
  if (request.target === "selector") {
    return acceptSelectorTarget(request, state, preflight.target);
  }
  if (request.target === "full_page") {
    state.cdpClip = buildFullPageClip(state.page, request.maxPixels);
    state.clip = state.cdpClip;
    state.captureBeyondViewport = true;
  }
  return null;
}

async function captureAtomicViewport(args, request, state) {
  const targetFailure = await prepareAtomicViewportTarget(args, request, state);
  if (targetFailure) return { targetFailure };
  assertCapturePixelBudget(request, state);
  const shouldRefreshLayout = request.target !== "selector" && request.includeLayoutMetrics;
  state.viewportOverrideCleanupHandled = false;
  const batch = absorbTransportResult(state, await runTmwdViewportScreenshotBatch(
    phaseArgs(args, state, "viewport_capture"),
    state.preferred,
    {
      viewportParams: request.viewportOverride.cdp_params,
      settleScript: viewportOverrideSettleScript(request.viewportOverride.requested),
      pageMetadataScript: PAGE_METADATA_SCRIPT,
      layoutMetricsScript: shouldRefreshLayout
        ? layoutMetricsScript(request.effectiveLayoutSelectors)
        : null,
      screenshotParams: screenshotParams(state),
    },
    state.runtimeOptions,
  ));
  state.viewportOverrideCleanupHandled = batch.cleanup?.cleared === true;
  state.viewportOverrideResult = {
    ...(state.viewportOverrideResult ?? {}),
    applied: true,
    requested: request.viewportOverride.requested,
    cdp_params: request.viewportOverride.cdp_params,
    settle: batch.settle,
    cleanup: batch.cleanup,
  };
  state.page = batch.page;
  if (batch.layout_metrics) state.layoutMetrics = batch.layout_metrics;
  const pageVerification = buildViewportOverrideVerification({
    page: state.page,
    target: request.target,
    viewportOverrideResult: state.viewportOverrideResult,
  });
  state.viewportOverrideResult.verification = {
    page: pageVerification?.page,
  };
  try {
    assertViewportOverridePageVerification(pageVerification?.page);
  } catch (error) {
    error.details = {
      ...(error.details ?? {}),
      probe: {
        settle: batch.settle,
        viewport: state.page?.viewport,
      },
    };
    throw error;
  }
  return { artifact: await writeCapturedArtifact(args, request, state, batch.base64) };
}

function successResponse(args, request, state, artifact) {
  const target = state.preferred.context?.target ?? {};
  const tabId = String(target.tab_id ?? target.tabId ?? target.id ?? "").trim();
  const sessionId = String(target.session_key ?? target.sessionKey ?? target.id ?? tabId).trim();
  const pixelCount = Number(artifact.artifact?.width ?? 0) * Number(artifact.artifact?.height ?? 0);
  const deadlineSnapshot = state.deadline.snapshot("completed");
  return {
    ok: true,
    status: "success",
    tool: "browser_screenshot_ops",
    action: "capture",
    target: request.target,
    transport: state.preferred.transport,
    browser_instance_id: target.browser_instance_id || undefined,
    tab_id: tabId,
    session_id: sessionId,
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
      area_css_pixels: state.pixelBudget?.area_css_pixels,
      device_pixel_ratio: state.pixelBudget?.device_pixel_ratio,
      capture_scale: state.pixelBudget?.capture_scale,
      predicted_bitmap_width: state.pixelBudget?.bitmap_width,
      predicted_bitmap_height: state.pixelBudget?.bitmap_height,
      predicted_bitmap_pixels: state.pixelBudget?.area_bitmap_pixels,
      actual_bitmap_pixels: state.actualPixelBudget?.area_bitmap_pixels,
      returns_base64: false,
    },
    artifact: artifact.artifact,
    context_budget: {
      inline_image_data: false,
      artifact_reference_only: true,
      pixel_count: Number.isFinite(pixelCount) ? pixelCount : undefined,
      prefer_selector_or_clip: Number.isFinite(pixelCount) && pixelCount > 4_000_000,
      guidance: "Pass the artifact path to an image viewer only when visual inspection is required; prefer selector or clip captures for narrow evidence.",
    },
    run: {
      run_id: artifact.run.run_id,
      group: artifact.run.group,
      workspace_key: artifact.run.workspace_key,
      task_id: artifact.run.task_id,
      run_dir: artifact.run.run_dir,
      artifacts_dir: artifact.run.artifacts_dir,
      prepared: artifact.run_prepared,
      terminalized: artifact.run_terminalized,
      run_requires_finish: artifact.run_requires_finish,
      status: artifact.run.status,
      finished_at: artifact.run.finished_at,
    },
    deadline: {
      timeout_ms: deadlineSnapshot.timeout_ms,
      elapsed_ms: deadlineSnapshot.elapsed_ms,
      remaining_ms: deadlineSnapshot.remaining_ms,
      deadline_at: deadlineSnapshot.deadline_at,
    },
    transport_attempts: state.transportAttempts,
  };
}

async function clearViewportOverride(args, request, state) {
  if (state.viewportOverrideCleanupHandled) return;
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
  const deadline = createOperationDeadline(args.timeout_ms);
  let phase = "resolve_context";
  let preferred;
  try {
    preferred = await resolvePreferredBrowserContext(deadline.argsFor(args, phase), runtimeOptions);
  } catch (error) {
    throw deadline.annotate(error, phase);
  }
  const state = {
    deadline,
    phase,
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
    viewportOverrideCleanupHandled: false,
    pixelBudget: null,
    actualPixelBudget: null,
  };

  try {
    if (shouldUseAtomicViewportCapture(request, state)) {
      const atomic = await captureAtomicViewport(args, request, state);
      if (atomic.targetFailure) return atomic.targetFailure;
      return successResponse(args, request, state, atomic.artifact);
    }
    await applyViewportOverride(phaseArgs(args, state, "viewport_apply"), request, state);
    await readPageState(phaseArgs(args, state, "page_state"), request, state);
    const targetFailure = await resolveCaptureTarget(
      phaseArgs(args, state, "target_resolution"),
      request,
      state,
    );
    if (targetFailure) return targetFailure;
    assertCapturePixelBudget(request, state);
    const artifact = await captureArtifact(
      phaseArgs(args, state, "capture_png"),
      request,
      state,
    );
    return successResponse(args, request, state, artifact);
  } catch (error) {
    throw state.deadline.annotate(error, error?.details?.failed_phase ?? state.phase);
  } finally {
    await clearViewportOverride(args, request, state);
  }
}

export {
  captureBrowserScreenshot,
};
