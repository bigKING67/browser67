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
  activateManagedTabForPhysicalInput,
  getManagedTabContext,
  sleep,
} from "./context.mjs";
import { handlePlanCaptchaAssist } from "./plan-handler.mjs";

function assistBlocked(plan, reason, extras = {}) {
  return {
    ...plan,
    status: "blocked",
    action: "assist_captcha",
    reason,
    executed: false,
    ...extras,
  };
}

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

function selectScreenCoordinates(args, plan, {
  autoScreenCoordinates = false,
  useCorrectedCoordinates = false,
} = {}) {
  const estimatedClick = plan.coordinate_transform?.screen_estimate?.click;
  const estimatedDrag = plan.coordinate_transform?.screen_estimate?.drag;
  const correctedClick = plan.coordinate_transform?.vision_correction?.screen_estimate?.click;
  const correctedDrag = plan.coordinate_transform?.vision_correction?.screen_estimate?.drag;
  const screenX = finiteNumber(args?.screen_x)
    ?? (useCorrectedCoordinates ? finiteNumber(
      plan.assist_target === "slider" ? correctedDrag?.from?.x : correctedClick?.x,
    ) : null)
    ?? (autoScreenCoordinates ? finiteNumber(
      plan.assist_target === "slider" ? estimatedDrag?.from?.x : estimatedClick?.x,
    ) : null);
  const screenY = finiteNumber(args?.screen_y)
    ?? (useCorrectedCoordinates ? finiteNumber(
      plan.assist_target === "slider" ? correctedDrag?.from?.y : correctedClick?.y,
    ) : null)
    ?? (autoScreenCoordinates ? finiteNumber(
      plan.assist_target === "slider" ? estimatedDrag?.from?.y : estimatedClick?.y,
    ) : null);
  const screenToX = finiteNumber(args?.screen_to_x)
    ?? (useCorrectedCoordinates ? finiteNumber(correctedDrag?.to?.x) : null)
    ?? (autoScreenCoordinates ? finiteNumber(estimatedDrag?.to?.x) : null);
  const screenToY = finiteNumber(args?.screen_to_y)
    ?? (useCorrectedCoordinates ? finiteNumber(correctedDrag?.to?.y) : null)
    ?? (autoScreenCoordinates ? finiteNumber(estimatedDrag?.to?.y) : null);
  return {
    screenX,
    screenY,
    screenToX,
    screenToY,
    source: useCorrectedCoordinates
      ? "vision_corrected_region_capture"
      : (autoScreenCoordinates ? "coordinate_transform_estimate" : "caller_supplied"),
  };
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
  if (plan.assist_target === "slider" && (
    coordinates.screenToX === null || coordinates.screenToY === null
  )) {
    return {
      reason: CAPTCHA_ASSIST_REASONS.SCREEN_DRAG_COORDINATES_REQUIRED,
      required_coordinates: ["screen_x", "screen_y", "screen_to_x", "screen_to_y"],
    };
  }
  return null;
}

async function handleAssistCaptcha(args) {
  const planned = await handlePlanCaptchaAssist(args);
  const managedTab = await getManagedTabContext(args);
  if (planned.status !== "planned") {
    return assistBlocked(
      planned,
      planned.reason || CAPTCHA_ASSIST_REASONS.CAPTCHA_NOT_DETECTED,
    );
  }
  if (!managedTab.managed) {
    return assistBlocked(planned, CAPTCHA_ASSIST_REASONS.MANAGED_TAB_REQUIRED);
  }
  if (planned.manual_handoff_required === true || planned.degraded_mode === true) {
    return assistBlocked(planned, CAPTCHA_ASSIST_REASONS.CROSS_ORIGIN_FRAME_HANDOFF_REQUIRED, {
      escalation: "manual_user_handoff",
    });
  }
  const selectedRoute = planned.captcha_router?.selected_route;
  if (selectedRoute?.route_type === "manual_handoff") {
    return assistBlocked(planned, CAPTCHA_ASSIST_REASONS.ROUTER_MANUAL_HANDOFF_REQUIRED, {
      escalation: "manual_user_handoff",
      captcha_router_reason: selectedRoute.reason,
    });
  }
  if (selectedRoute?.route_type === "protocol_solver") {
    return assistBlocked(planned, CAPTCHA_ASSIST_REASONS.PROTOCOL_SOLVER_APPLY_NOT_IMPLEMENTED, {
      escalation: "manual_user_handoff",
      captcha_router_route_id: selectedRoute.route_id,
      protocol_solver_apply_supported: false,
      next_implementation_step: "add an allowlisted provider apply path with explicit response injection contract",
    });
  }
  const useProviderCoordinates = args?.use_provider_coordinates === true;
  if (useProviderCoordinates && selectedRoute?.solver_provider !== "jfbym") {
    return assistBlocked(planned, CAPTCHA_ASSIST_REASONS.PROVIDER_COORDINATES_ROUTE_UNAVAILABLE, {
      captcha_router_route_id: selectedRoute?.route_id,
      captcha_router_provider_coordinate_block_reason: planned.captcha_router?.provider_coordinate_block_reason,
      required_args: [
        'captcha_locator_provider:"jfbym"',
        "run_vision_correction:true",
        "confirm_provider_coordinates:true",
      ],
    });
  }
  if (args?.confirm_physical_input !== true) {
    return assistBlocked(planned, CAPTCHA_ASSIST_REASONS.CONFIRM_PHYSICAL_INPUT_REQUIRED);
  }
  const autoScreenCoordinates = args?.auto_screen_coordinates === true;
  const useCorrectedCoordinates = args?.use_vision_corrected_coordinates === true;
  if (useProviderCoordinates && args?.confirm_provider_coordinates !== true) {
    return assistBlocked(planned, CAPTCHA_ASSIST_REASONS.CONFIRM_PROVIDER_COORDINATES_REQUIRED, {
      required_confirmations: [
        "confirm_physical_input:true",
        "confirm_provider_coordinates:true",
      ],
    });
  }
  if (useProviderCoordinates && args?.run_vision_correction !== true) {
    return assistBlocked(planned, CAPTCHA_ASSIST_REASONS.PROVIDER_COORDINATE_ARTIFACT_REQUIRED, {
      required: "run_vision_correction:true",
      fullscreen_allowed: false,
    });
  }
  if (autoScreenCoordinates && args?.confirm_auto_coordinates !== true) {
    return assistBlocked(planned, CAPTCHA_ASSIST_REASONS.CONFIRM_AUTO_COORDINATES_REQUIRED, {
      required_confirmations: ["confirm_physical_input:true", "confirm_auto_coordinates:true"],
    });
  }
  if (useCorrectedCoordinates && args?.confirm_corrected_coordinates !== true) {
    return assistBlocked(planned, CAPTCHA_ASSIST_REASONS.CONFIRM_CORRECTED_COORDINATES_REQUIRED, {
      required_confirmations: [
        "confirm_physical_input:true",
        "confirm_corrected_coordinates:true",
      ],
    });
  }
  const initialVisionBlock = useCorrectedCoordinates ? visionCorrectionBlock(planned) : null;
  if (initialVisionBlock) {
    return assistBlocked(planned, initialVisionBlock.reason, {
      correction_confidence: initialVisionBlock.correction_confidence,
      correction_minimum_confidence: initialVisionBlock.correction_minimum_confidence,
      required_one_of: [
        "explicit screen_x/screen_y coordinates",
        "run_vision_correction:true with confidence above threshold",
        "manual_user_handoff",
      ],
    });
  }

  if (!useProviderCoordinates) {
    const initialCoordinates = selectScreenCoordinates(args, planned, {
      autoScreenCoordinates,
      useCorrectedCoordinates,
    });
    const initialCoordinateBlock = coordinateBlock(planned, initialCoordinates, autoScreenCoordinates);
    if (initialCoordinateBlock) {
      return assistBlocked(planned, initialCoordinateBlock.reason, {
        required_coordinates: initialCoordinateBlock.required_coordinates,
      });
    }
  }
  if (planned.assist_target === "slider") {
    if (planned.coordinate_support?.physical_drag_supported !== true) {
      return assistBlocked(planned, CAPTCHA_ASSIST_REASONS.NATIVE_DRAG_NOT_SUPPORTED, {
        escalation: "manual_user_handoff",
      });
    }
  }

  let activation = { status: "skipped" };
  const windowTitle = String(args?.window_title ?? "").trim();
  const windowPid = finiteNumber(args?.window_pid);
  if (windowTitle || windowPid !== null) {
    const activated = await runPhysicalInputAction("activate_window", {
      window_title: windowTitle || undefined,
      window_pid: windowPid ?? undefined,
      timeout_ms: args?.timeout_ms,
    }, {
      preferred_provider: args?.physical_input_provider,
    });
    activation = {
      provider_selection: activated.provider_selection,
      provider: activated.provider,
      ...activated.result,
    };
  } else {
    try {
      activation = await activateManagedTabForPhysicalInput(args, managedTab.tab_id);
    } catch (error) {
      if (args?.window_active_confirmed === true) {
        activation = {
          status: "confirmed_by_caller",
          tmwd_activation_error: String(error?.message ?? error),
        };
      } else {
        return assistBlocked(planned, CAPTCHA_ASSIST_REASONS.MANAGED_TAB_ACTIVATION_FAILED, {
          activation_error: String(error?.message ?? error),
          required_one_of: [
            "TMWD tabs.switch on managed tab",
            "window_title",
            "window_pid",
            "window_active_confirmed:true",
          ],
        });
      }
    }
  }

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
  let providerCoordinateResult = null;
  const selectedCoordinates = useProviderCoordinates
    ? null
    : selectScreenCoordinates(args, planForInput, {
      autoScreenCoordinates,
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
      timeout_ms: args?.timeout_ms,
    }, {
      preferred_provider: args?.physical_input_provider,
    })
    : await runPhysicalInputAction("click", {
      x: inputCoordinates.screenX,
      y: inputCoordinates.screenY,
      button: "left",
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
      coordinate_system: "screen_pixels",
      source: inputCoordinates.source,
    },
    waited_ms: waitAfterMs,
    next_step: "browser_auth_ops.ensure_login",
    secrets_redacted: true,
  };
}

export {
  handleAssistCaptcha,
};
