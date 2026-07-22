import { runPhysicalInputAction } from "../../physical-input/index.mjs";
import {
  clientPointToNativeWindowScreen,
  finiteNumber,
} from "../captcha/coordinates.mjs";
import { CAPTCHA_ASSIST_REASONS } from "../captcha/reasons.mjs";

function coordinateRefreshSkipped(reason) {
  return {
    performed: false,
    reason,
  };
}

function coordinateRefreshPerformed(initialPlan, refreshedPlan) {
  return {
    performed: true,
    reason: "post_activation_viewport_metrics",
    initial_viewport: initialPlan.viewport,
    refreshed_viewport: refreshedPlan.viewport,
    initial_coordinate_transform: initialPlan.coordinate_transform,
    refreshed_coordinate_transform: refreshedPlan.coordinate_transform,
  };
}

function visionCorrectionBlock(plan) {
  const correctionConfidence = finiteNumber(plan.coordinate_transform?.vision_correction?.confidence);
  const correctionMinimumConfidence = finiteNumber(
    plan.coordinate_transform?.vision_correction?.minimum_confidence_to_execute,
  ) ?? 0.85;
  if (
    plan.coordinate_transform?.vision_correction?.correction_status === "success"
    && correctionConfidence !== null
    && correctionConfidence >= correctionMinimumConfidence
  ) {
    return null;
  }
  return {
    reason: correctionConfidence === null
      ? CAPTCHA_ASSIST_REASONS.VISION_CORRECTION_UNAVAILABLE
      : CAPTCHA_ASSIST_REASONS.VISION_CORRECTION_CONFIDENCE_TOO_LOW,
    correction_confidence: correctionConfidence,
    correction_minimum_confidence: correctionMinimumConfidence,
  };
}

function firstEnabledCoordinate({
  explicit,
  correctedEnabled,
  correctedNative,
  correctedEstimate,
  estimatedEnabled,
  estimatedNative,
  estimated,
}) {
  return finiteNumber(explicit)
    ?? (correctedEnabled ? finiteNumber(correctedNative) : null)
    ?? (correctedEnabled ? finiteNumber(correctedEstimate) : null)
    ?? (estimatedEnabled ? finiteNumber(estimatedNative) : null)
    ?? (estimatedEnabled ? finiteNumber(estimated) : null);
}

function coordinateSource({ explicitCoordinates, nativeCoordinates, autoScreenCoordinates, useCorrectedCoordinates }) {
  if (explicitCoordinates) return "caller_supplied";
  if (useCorrectedCoordinates) {
    return nativeCoordinates
      ? "vision_corrected_native_window_rect"
      : "vision_corrected_region_capture";
  }
  if (autoScreenCoordinates) {
    return nativeCoordinates
      ? "coordinate_transform_native_window_rect"
      : "coordinate_transform_estimate";
  }
  return "caller_supplied";
}

function selectScreenCoordinates(args, plan, {
  autoScreenCoordinates = false,
  nativeWindowRect = null,
  useCorrectedCoordinates = false,
} = {}) {
  const slider = plan.assist_target === "slider";
  const estimatedClick = plan.coordinate_transform?.screen_estimate?.click;
  const estimatedDrag = plan.coordinate_transform?.screen_estimate?.drag;
  const correctedClick = plan.coordinate_transform?.vision_correction?.screen_estimate?.click;
  const correctedDrag = plan.coordinate_transform?.vision_correction?.screen_estimate?.drag;
  const correctedClientClick = plan.coordinate_transform?.vision_correction?.corrected_coordinates?.click;
  const correctedClientDrag = plan.coordinate_transform?.vision_correction?.corrected_coordinates?.drag;
  const estimatedClientClick = plan.checkbox_click_hint?.click_client ?? plan.target?.center_client;
  const estimatedClientDrag = plan.slider_drag_hint;
  const nativeCorrectedClick = correctedClientClick
    ? clientPointToNativeWindowScreen(correctedClientClick, plan.viewport, nativeWindowRect)
    : null;
  const nativeCorrectedDragFrom = correctedClientDrag?.from
    ? clientPointToNativeWindowScreen(correctedClientDrag.from, plan.viewport, nativeWindowRect)
    : null;
  const nativeCorrectedDragTo = correctedClientDrag?.to
    ? clientPointToNativeWindowScreen(correctedClientDrag.to, plan.viewport, nativeWindowRect)
    : null;
  const nativeEstimatedClick = estimatedClientClick
    ? clientPointToNativeWindowScreen(estimatedClientClick, plan.viewport, nativeWindowRect)
    : null;
  const nativeEstimatedDragFrom = estimatedClientDrag?.from_client
    ? clientPointToNativeWindowScreen(estimatedClientDrag.from_client, plan.viewport, nativeWindowRect)
    : null;
  const nativeEstimatedDragTo = estimatedClientDrag?.to_client
    ? clientPointToNativeWindowScreen(estimatedClientDrag.to_client, plan.viewport, nativeWindowRect)
    : null;
  const explicitScreenX = finiteNumber(args?.screen_x);
  const explicitScreenY = finiteNumber(args?.screen_y);
  const screenX = firstEnabledCoordinate({
    explicit: explicitScreenX,
    correctedEnabled: useCorrectedCoordinates,
    correctedNative: slider ? nativeCorrectedDragFrom?.x : nativeCorrectedClick?.x,
    correctedEstimate: slider ? correctedDrag?.from?.x : correctedClick?.x,
    estimatedEnabled: autoScreenCoordinates,
    estimatedNative: slider ? nativeEstimatedDragFrom?.x : nativeEstimatedClick?.x,
    estimated: slider ? estimatedDrag?.from?.x : estimatedClick?.x,
  });
  const screenY = firstEnabledCoordinate({
    explicit: explicitScreenY,
    correctedEnabled: useCorrectedCoordinates,
    correctedNative: slider ? nativeCorrectedDragFrom?.y : nativeCorrectedClick?.y,
    correctedEstimate: slider ? correctedDrag?.from?.y : correctedClick?.y,
    estimatedEnabled: autoScreenCoordinates,
    estimatedNative: slider ? nativeEstimatedDragFrom?.y : nativeEstimatedClick?.y,
    estimated: slider ? estimatedDrag?.from?.y : estimatedClick?.y,
  });
  const screenToX = firstEnabledCoordinate({
    explicit: args?.screen_to_x,
    correctedEnabled: useCorrectedCoordinates,
    correctedNative: nativeCorrectedDragTo?.x,
    correctedEstimate: correctedDrag?.to?.x,
    estimatedEnabled: autoScreenCoordinates,
    estimatedNative: nativeEstimatedDragTo?.x,
    estimated: estimatedDrag?.to?.x,
  });
  const screenToY = firstEnabledCoordinate({
    explicit: args?.screen_to_y,
    correctedEnabled: useCorrectedCoordinates,
    correctedNative: nativeCorrectedDragTo?.y,
    correctedEstimate: correctedDrag?.to?.y,
    estimatedEnabled: autoScreenCoordinates,
    estimatedNative: nativeEstimatedDragTo?.y,
    estimated: estimatedDrag?.to?.y,
  });
  const explicitCoordinates = explicitScreenX !== null || explicitScreenY !== null;
  const nativeCoordinates = slider
    ? (useCorrectedCoordinates ? nativeCorrectedDragFrom : nativeEstimatedDragFrom)
    : (useCorrectedCoordinates ? nativeCorrectedClick : nativeEstimatedClick);
  return {
    screenX,
    screenY,
    screenToX,
    screenToY,
    source: coordinateSource({
      explicitCoordinates,
      nativeCoordinates,
      autoScreenCoordinates,
      useCorrectedCoordinates,
    }),
    coordinate_calibration: explicitCoordinates ? undefined : nativeCoordinates?.calibration,
  };
}

function windowSelectorSource({
  explicitWindowPid,
  explicitWindowTitle,
  managedWindowPid,
  managedWindowTabId,
  managedWindowTitle,
  managedWindowUrl,
}) {
  if (explicitWindowPid !== null || explicitWindowTitle) return "caller_window_selector";
  if (managedWindowTabId !== null) return "native_managed_tab_id";
  if (managedWindowUrl) return "native_managed_tab_url";
  if (managedWindowPid !== null || managedWindowTitle) return "native_managed_window_activation";
  return "foreground_window";
}

async function getForegroundNativeWindowRect(args, activation = {}) {
  const explicitWindowPid = finiteNumber(args?.window_pid);
  const explicitWindowTitle = String(args?.window_title ?? "").trim();
  const managedActivation = activation.native_window_activation ?? {};
  const managedWindowPid = finiteNumber(managedActivation.pid);
  const managedWindowTabId = finiteNumber(managedActivation.window_tab_id);
  const managedWindowTitle = String(managedActivation.window_title ?? managedActivation.title ?? "").trim();
  const managedWindowUrl = String(managedActivation.window_url ?? "").trim();
  const windowPid = explicitWindowPid ?? managedWindowPid;
  const windowTitle = explicitWindowTitle || (windowPid === null ? managedWindowTitle : "");
  try {
    const physicalInput = await runPhysicalInputAction("get_window_rect", {
      window_pid: windowPid ?? undefined,
      window_title: windowTitle || undefined,
      window_tab_id: managedWindowTabId ?? undefined,
      window_url: managedWindowUrl || undefined,
      window_application: managedActivation.application_name || undefined,
      timeout_ms: args?.timeout_ms,
    }, {
      preferred_provider: args?.physical_input_provider,
    });
    if (physicalInput.result?.status !== "success") {
      return {
        status: "unavailable",
        reason: physicalInput.result?.reason ?? "native_window_rect_failed",
        provider: physicalInput.provider,
        provider_selection: physicalInput.provider_selection,
      };
    }
    return {
      ...physicalInput.result,
      selector_source: windowSelectorSource({
        explicitWindowPid,
        explicitWindowTitle,
        managedWindowPid,
        managedWindowTabId,
        managedWindowTitle,
        managedWindowUrl,
      }),
      provider: physicalInput.provider,
      provider_selection: physicalInput.provider_selection,
    };
  } catch (error) {
    return {
      status: "unavailable",
      reason: "native_window_rect_failed",
      error: String(error?.message ?? error),
    };
  }
}

function coordinateBlock(plan, coordinates, autoScreenCoordinates) {
  if (coordinates.screenX === null || coordinates.screenY === null) {
    return {
      reason: autoScreenCoordinates
        ? CAPTCHA_ASSIST_REASONS.AUTO_SCREEN_COORDINATES_UNAVAILABLE
        : CAPTCHA_ASSIST_REASONS.SCREEN_COORDINATES_REQUIRED,
      required_coordinates: plan.assist_target === "slider"
        ? ["screen_x", "screen_y", "screen_to_x", "screen_to_y"]
        : ["screen_x", "screen_y"],
    };
  }
  if (
    plan.assist_target === "slider"
    && (coordinates.screenToX === null || coordinates.screenToY === null)
  ) {
    return {
      reason: CAPTCHA_ASSIST_REASONS.SCREEN_DRAG_COORDINATES_REQUIRED,
      required_coordinates: ["screen_x", "screen_y", "screen_to_x", "screen_to_y"],
    };
  }
  return null;
}

export {
  coordinateBlock,
  coordinateRefreshPerformed,
  coordinateRefreshSkipped,
  getForegroundNativeWindowRect,
  selectScreenCoordinates,
  visionCorrectionBlock,
};
