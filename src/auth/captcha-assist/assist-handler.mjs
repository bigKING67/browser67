import { runPhysicalInputAction } from "../../physical-input/index.mjs";
import {
  finiteNumber,
  normalizeDragDurationMs,
  normalizeDragSteps,
  normalizePreInputSettleMs,
  normalizeWaitAfterMs,
} from "../captcha/coordinates.mjs";
import { solveJfbymCoordinateChallenge } from "../captcha/providers/jfbym-coordinate.mjs";
import { CAPTCHA_ASSIST_REASONS } from "../captcha/reasons.mjs";
import {
  getManagedTabContext,
  sleep,
} from "./context.mjs";
import { activateCaptchaTarget } from "./activation.mjs";
import {
  coordinateBlock,
  coordinateRefreshPerformed,
  coordinateRefreshSkipped,
  getForegroundNativeWindowRect,
  selectScreenCoordinates,
  visionCorrectionBlock,
} from "./input-coordinates.mjs";
import { assistBlocked } from "./outcome.mjs";
import { handlePlanCaptchaAssist } from "./plan-handler.mjs";
import { prepareAssistRequest } from "./preflight.mjs";

async function handleAssistCaptcha(args) {
  const planned = await handlePlanCaptchaAssist(args);
  const managedTab = await getManagedTabContext(args);
  const preflight = prepareAssistRequest(args, planned, managedTab);
  if (!preflight.ok) return preflight.outcome;
  const {
    autoScreenCoordinates,
    useCorrectedCoordinates,
    useProviderCoordinates,
  } = preflight;

  const activationResult = await activateCaptchaTarget(args, planned, managedTab);
  if (!activationResult.ok) return activationResult.outcome;
  const activation = activationResult.activation;

  const preInputSettleMs = normalizePreInputSettleMs(args?.pre_input_settle_ms);
  if (preInputSettleMs > 0) {
    await sleep(preInputSettleMs);
  }

  let planForInput = planned;
  let coordinateRefresh = coordinateRefreshSkipped("caller_supplied_screen_coordinates");
  if (useProviderCoordinates) {
    coordinateRefresh = coordinateRefreshSkipped("provider_coordinate_region_capture");
  }
  if (autoScreenCoordinates || useCorrectedCoordinates || useProviderCoordinates) {
    const refreshed = await handlePlanCaptchaAssist(args);
    coordinateRefresh = coordinateRefreshPerformed(planned, refreshed);
    if (refreshed.status !== "planned") {
      return assistBlocked(
        refreshed,
        refreshed.reason || CAPTCHA_ASSIST_REASONS.CAPTCHA_NOT_DETECTED,
        { activation, pre_input_settle_ms: preInputSettleMs, coordinate_refresh: coordinateRefresh },
      );
    }
    if (refreshed.manual_handoff_required === true || refreshed.degraded_mode === true) {
      return assistBlocked(refreshed, CAPTCHA_ASSIST_REASONS.CROSS_ORIGIN_FRAME_HANDOFF_REQUIRED, {
        activation,
        pre_input_settle_ms: preInputSettleMs,
        coordinate_refresh: coordinateRefresh,
        escalation: "manual_user_handoff",
      });
    }
    planForInput = refreshed;
  }
  const refreshedRoute = planForInput.captcha_router?.selected_route;
  if (useProviderCoordinates && refreshedRoute?.solver_provider !== "jfbym") {
    return assistBlocked(planForInput, CAPTCHA_ASSIST_REASONS.PROVIDER_COORDINATES_ROUTE_UNAVAILABLE, {
      activation,
      pre_input_settle_ms: preInputSettleMs,
      coordinate_refresh: coordinateRefresh,
      captcha_router_route_id: refreshedRoute?.route_id,
      captcha_router_provider_coordinate_block_reason: planForInput.captcha_router?.provider_coordinate_block_reason,
    });
  }

  const refreshedVisionBlock = useCorrectedCoordinates ? visionCorrectionBlock(planForInput) : null;
  if (refreshedVisionBlock) {
    return assistBlocked(planForInput, refreshedVisionBlock.reason, {
      activation,
      pre_input_settle_ms: preInputSettleMs,
      coordinate_refresh: coordinateRefresh,
      correction_confidence: refreshedVisionBlock.correction_confidence,
      correction_minimum_confidence: refreshedVisionBlock.correction_minimum_confidence,
      required_one_of: [
        "explicit screen_x/screen_y coordinates",
        "run_vision_correction:true with confidence above threshold",
        "manual_user_handoff",
      ],
    });
  }
  const nativeWindowRect = autoScreenCoordinates || useCorrectedCoordinates
    ? await getForegroundNativeWindowRect(args, activation)
    : {
      status: "skipped",
      reason: "caller_supplied_or_provider_coordinates",
    };
  if (coordinateRefresh.performed === true) {
    coordinateRefresh.native_window_rect = nativeWindowRect;
  }
  let providerCoordinateResult = null;
  const selectedCoordinates = useProviderCoordinates
    ? null
    : selectScreenCoordinates(args, planForInput, {
      autoScreenCoordinates,
      nativeWindowRect: nativeWindowRect.status === "success" ? nativeWindowRect : null,
      useCorrectedCoordinates,
    });
  if (useProviderCoordinates) {
    providerCoordinateResult = await solveJfbymCoordinateChallenge({ args, plan: planForInput });
    if (providerCoordinateResult.ok !== true) {
      return assistBlocked(
        planForInput,
        providerCoordinateResult.reason || CAPTCHA_ASSIST_REASONS.PROVIDER_COORDINATE_SOLVER_FAILED,
        {
          activation,
          pre_input_settle_ms: preInputSettleMs,
          coordinate_refresh: coordinateRefresh,
          provider_coordinate_result: providerCoordinateResult,
        },
      );
    }
  }
  const inputCoordinates = useProviderCoordinates
    ? {
      screenX: finiteNumber(providerCoordinateResult.screen_coordinates?.x),
      screenY: finiteNumber(providerCoordinateResult.screen_coordinates?.y),
      screenToX: finiteNumber(providerCoordinateResult.screen_coordinates?.to_x),
      screenToY: finiteNumber(providerCoordinateResult.screen_coordinates?.to_y),
      source: "jfbym_coordinate_solver",
    }
    : selectedCoordinates;
  const refreshedCoordinateBlock = coordinateBlock(
    planForInput,
    inputCoordinates,
    autoScreenCoordinates || useProviderCoordinates,
  );
  if (refreshedCoordinateBlock) {
    return assistBlocked(planForInput, useProviderCoordinates
      ? CAPTCHA_ASSIST_REASONS.PROVIDER_COORDINATES_UNAVAILABLE
      : refreshedCoordinateBlock.reason, {
      activation,
      pre_input_settle_ms: preInputSettleMs,
      coordinate_refresh: coordinateRefresh,
      provider_coordinate_result: providerCoordinateResult ?? undefined,
      required_coordinates: refreshedCoordinateBlock.required_coordinates,
    });
  }
  if (
    planForInput.assist_target === "slider"
    && planForInput.coordinate_support?.physical_drag_supported !== true
  ) {
    return assistBlocked(planForInput, CAPTCHA_ASSIST_REASONS.NATIVE_DRAG_NOT_SUPPORTED, {
      activation,
      pre_input_settle_ms: preInputSettleMs,
      coordinate_refresh: coordinateRefresh,
      escalation: "manual_user_handoff",
    });
  }

  const physicalInput = planForInput.assist_target === "slider"
    ? await runPhysicalInputAction("drag", {
      from_x: inputCoordinates.screenX,
      from_y: inputCoordinates.screenY,
      to_x: inputCoordinates.screenToX,
      to_y: inputCoordinates.screenToY,
      button: "left",
      duration_ms: normalizeDragDurationMs(args?.drag_duration_ms),
      steps: normalizeDragSteps(args?.drag_steps),
      expected_window_hwnd: nativeWindowRect.status === "success" ? nativeWindowRect.hwnd : undefined,
      window_tab_id: activation.native_window_activation?.window_tab_id,
      window_url: activation.native_window_activation?.window_url,
      window_application: activation.native_window_activation?.application_name,
      timeout_ms: args?.timeout_ms,
    }, {
      preferred_provider: args?.physical_input_provider,
    })
    : await runPhysicalInputAction("click", {
      x: inputCoordinates.screenX,
      y: inputCoordinates.screenY,
      button: "left",
      expected_window_hwnd: nativeWindowRect.status === "success" ? nativeWindowRect.hwnd : undefined,
      window_tab_id: activation.native_window_activation?.window_tab_id,
      window_url: activation.native_window_activation?.window_url,
      window_application: activation.native_window_activation?.application_name,
      timeout_ms: args?.timeout_ms,
    }, {
      preferred_provider: args?.physical_input_provider,
    });
  const nativeInput = physicalInput.result;
  if (nativeInput?.status === "blocked") {
    return {
      ...planForInput,
      status: "blocked",
      action: "assist_captcha",
      reason: CAPTCHA_ASSIST_REASONS.PHYSICAL_INPUT_PROVIDER_UNAVAILABLE,
      executed: false,
      activation,
      coordinate_refresh: coordinateRefresh,
      provider_coordinate_result: providerCoordinateResult ?? undefined,
      physical_input_provider: physicalInput.provider,
      physical_input_provider_selection: physicalInput.provider_selection,
      provider_error: nativeInput,
    };
  }
  const waitAfterMs = normalizeWaitAfterMs(args?.wait_after_ms);
  await sleep(waitAfterMs);
  return {
    ...planForInput,
    status: "success",
    action: "assist_captcha",
    reason: planForInput.assist_target === "slider"
      ? CAPTCHA_ASSIST_REASONS.PHYSICAL_DRAG_SENT
      : CAPTCHA_ASSIST_REASONS.PHYSICAL_INPUT_SENT,
    executed: true,
    activation,
    coordinate_refresh: coordinateRefresh,
    provider_coordinate_result: providerCoordinateResult ?? undefined,
    native_input: nativeInput,
    physical_input_provider: physicalInput.provider,
    physical_input_provider_selection: physicalInput.provider_selection,
    pre_input_settle_ms: preInputSettleMs,
    screen_coordinates: {
      x: Math.round(inputCoordinates.screenX),
      y: Math.round(inputCoordinates.screenY),
      to_x: inputCoordinates.screenToX === null ? undefined : Math.round(inputCoordinates.screenToX),
      to_y: inputCoordinates.screenToY === null ? undefined : Math.round(inputCoordinates.screenToY),
      coordinate_system: inputCoordinates.coordinate_calibration?.target_coordinate_system
        ?? physicalInput.provider?.coordinate_system
        ?? "screen_pixels",
      source: inputCoordinates.source,
    },
    coordinate_calibration: inputCoordinates.coordinate_calibration,
    native_window_rect: nativeWindowRect,
    waited_ms: waitAfterMs,
    next_step: "browser_auth_ops.ensure_login",
    secrets_redacted: true,
  };
}

export {
  handleAssistCaptcha,
};
