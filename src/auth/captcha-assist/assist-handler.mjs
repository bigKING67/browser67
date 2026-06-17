import { runPhysicalInputAction } from "../../physical-input/index.mjs";
import {
  finiteNumber,
  normalizeDragDurationMs,
  normalizeDragSteps,
  normalizeWaitAfterMs,
} from "../captcha/coordinates.mjs";
import { CAPTCHA_ASSIST_REASONS } from "../captcha/reasons.mjs";
import {
  activateManagedTabForPhysicalInput,
  getManagedTabContext,
  sleep,
} from "./context.mjs";
import { handlePlanCaptchaAssist } from "./plan-handler.mjs";

async function handleAssistCaptcha(args) {
  const planned = await handlePlanCaptchaAssist(args);
  const managedTab = await getManagedTabContext(args);
  if (planned.status !== "planned") {
    return {
      ...planned,
      status: "blocked",
      action: "assist_captcha",
      reason: planned.reason || CAPTCHA_ASSIST_REASONS.CAPTCHA_NOT_DETECTED,
      executed: false,
    };
  }
  if (!managedTab.managed) {
    return {
      ...planned,
      status: "blocked",
      action: "assist_captcha",
      reason: CAPTCHA_ASSIST_REASONS.MANAGED_TAB_REQUIRED,
      executed: false,
    };
  }
  if (planned.manual_handoff_required === true || planned.degraded_mode === true) {
    return {
      ...planned,
      status: "blocked",
      action: "assist_captcha",
      reason: CAPTCHA_ASSIST_REASONS.CROSS_ORIGIN_FRAME_HANDOFF_REQUIRED,
      executed: false,
      escalation: "manual_user_handoff",
    };
  }
  if (args?.confirm_physical_input !== true) {
    return {
      ...planned,
      status: "blocked",
      action: "assist_captcha",
      reason: CAPTCHA_ASSIST_REASONS.CONFIRM_PHYSICAL_INPUT_REQUIRED,
      executed: false,
    };
  }
  const autoScreenCoordinates = args?.auto_screen_coordinates === true;
  const useCorrectedCoordinates = args?.use_vision_corrected_coordinates === true;
  if (autoScreenCoordinates && args?.confirm_auto_coordinates !== true) {
    return {
      ...planned,
      status: "blocked",
      action: "assist_captcha",
      reason: CAPTCHA_ASSIST_REASONS.CONFIRM_AUTO_COORDINATES_REQUIRED,
      executed: false,
      required_confirmations: ["confirm_physical_input:true", "confirm_auto_coordinates:true"],
    };
  }
  if (useCorrectedCoordinates && args?.confirm_corrected_coordinates !== true) {
    return {
      ...planned,
      status: "blocked",
      action: "assist_captcha",
      reason: CAPTCHA_ASSIST_REASONS.CONFIRM_CORRECTED_COORDINATES_REQUIRED,
      executed: false,
      required_confirmations: [
        "confirm_physical_input:true",
        "confirm_corrected_coordinates:true",
      ],
    };
  }
  const estimatedClick = planned.coordinate_transform?.screen_estimate?.click;
  const estimatedDrag = planned.coordinate_transform?.screen_estimate?.drag;
  const correctedClick = planned.coordinate_transform?.vision_correction?.screen_estimate?.click;
  const correctedDrag = planned.coordinate_transform?.vision_correction?.screen_estimate?.drag;
  const correctionConfidence = finiteNumber(planned.coordinate_transform?.vision_correction?.confidence);
  const correctionMinimumConfidence = finiteNumber(
    planned.coordinate_transform?.vision_correction?.minimum_confidence_to_execute,
  ) ?? 0.85;
  if (useCorrectedCoordinates && (
    planned.coordinate_transform?.vision_correction?.correction_status !== "success"
    || correctionConfidence === null
    || correctionConfidence < correctionMinimumConfidence
  )) {
    return {
      ...planned,
      status: "blocked",
      action: "assist_captcha",
      reason: correctionConfidence === null
        ? CAPTCHA_ASSIST_REASONS.VISION_CORRECTION_UNAVAILABLE
        : CAPTCHA_ASSIST_REASONS.VISION_CORRECTION_CONFIDENCE_TOO_LOW,
      executed: false,
      required_one_of: [
        "explicit screen_x/screen_y coordinates",
        "run_vision_correction:true with confidence above threshold",
        "manual_user_handoff",
      ],
    };
  }
  const screenX = finiteNumber(args?.screen_x)
    ?? (useCorrectedCoordinates ? finiteNumber(
      planned.assist_target === "slider" ? correctedDrag?.from?.x : correctedClick?.x,
    ) : null)
    ?? (autoScreenCoordinates ? finiteNumber(
      planned.assist_target === "slider" ? estimatedDrag?.from?.x : estimatedClick?.x,
    ) : null);
  const screenY = finiteNumber(args?.screen_y)
    ?? (useCorrectedCoordinates ? finiteNumber(
      planned.assist_target === "slider" ? correctedDrag?.from?.y : correctedClick?.y,
    ) : null)
    ?? (autoScreenCoordinates ? finiteNumber(
      planned.assist_target === "slider" ? estimatedDrag?.from?.y : estimatedClick?.y,
    ) : null);
  if (screenX === null || screenY === null) {
    return {
      ...planned,
      status: "blocked",
      action: "assist_captcha",
      reason: autoScreenCoordinates
        ? CAPTCHA_ASSIST_REASONS.AUTO_SCREEN_COORDINATES_UNAVAILABLE
        : CAPTCHA_ASSIST_REASONS.SCREEN_COORDINATES_REQUIRED,
      executed: false,
      required_coordinates: planned.assist_target === "slider"
        ? ["screen_x", "screen_y", "screen_to_x", "screen_to_y"]
        : ["screen_x", "screen_y"],
    };
  }
  const screenToX = finiteNumber(args?.screen_to_x)
    ?? (useCorrectedCoordinates ? finiteNumber(correctedDrag?.to?.x) : null)
    ?? (autoScreenCoordinates ? finiteNumber(estimatedDrag?.to?.x) : null);
  const screenToY = finiteNumber(args?.screen_to_y)
    ?? (useCorrectedCoordinates ? finiteNumber(correctedDrag?.to?.y) : null)
    ?? (autoScreenCoordinates ? finiteNumber(estimatedDrag?.to?.y) : null);
  if (planned.assist_target === "slider") {
    if (planned.coordinate_support?.physical_drag_supported !== true) {
      return {
        ...planned,
        status: "blocked",
        action: "assist_captcha",
        reason: CAPTCHA_ASSIST_REASONS.NATIVE_DRAG_NOT_SUPPORTED,
        executed: false,
        escalation: "manual_user_handoff",
      };
    }
    if (screenToX === null || screenToY === null) {
      return {
        ...planned,
        status: "blocked",
        action: "assist_captcha",
        reason: CAPTCHA_ASSIST_REASONS.SCREEN_DRAG_COORDINATES_REQUIRED,
        executed: false,
        required_coordinates: ["screen_x", "screen_y", "screen_to_x", "screen_to_y"],
      };
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
        return {
          ...planned,
          status: "blocked",
          action: "assist_captcha",
          reason: CAPTCHA_ASSIST_REASONS.MANAGED_TAB_ACTIVATION_FAILED,
          executed: false,
          activation_error: String(error?.message ?? error),
          required_one_of: [
            "TMWD tabs.switch on managed tab",
            "window_title",
            "window_pid",
            "window_active_confirmed:true",
          ],
        };
      }
    }
  }

  const physicalInput = planned.assist_target === "slider"
    ? await runPhysicalInputAction("drag", {
      from_x: screenX,
      from_y: screenY,
      to_x: screenToX,
      to_y: screenToY,
      button: "left",
      duration_ms: normalizeDragDurationMs(args?.drag_duration_ms),
      steps: normalizeDragSteps(args?.drag_steps),
      timeout_ms: args?.timeout_ms,
    }, {
      preferred_provider: args?.physical_input_provider,
    })
    : await runPhysicalInputAction("click", {
      x: screenX,
      y: screenY,
      button: "left",
      timeout_ms: args?.timeout_ms,
    }, {
      preferred_provider: args?.physical_input_provider,
    });
  const nativeInput = physicalInput.result;
  if (nativeInput?.status === "blocked") {
    return {
      ...planned,
      status: "blocked",
      action: "assist_captcha",
      reason: CAPTCHA_ASSIST_REASONS.PHYSICAL_INPUT_PROVIDER_UNAVAILABLE,
      executed: false,
      activation,
      physical_input_provider: physicalInput.provider,
      physical_input_provider_selection: physicalInput.provider_selection,
      provider_error: nativeInput,
    };
  }
  const waitAfterMs = normalizeWaitAfterMs(args?.wait_after_ms);
  await sleep(waitAfterMs);
  return {
    ...planned,
    status: "success",
    action: "assist_captcha",
    reason: planned.assist_target === "slider"
      ? CAPTCHA_ASSIST_REASONS.PHYSICAL_DRAG_SENT
      : CAPTCHA_ASSIST_REASONS.PHYSICAL_INPUT_SENT,
    executed: true,
    activation,
    native_input: nativeInput,
    physical_input_provider: physicalInput.provider,
    physical_input_provider_selection: physicalInput.provider_selection,
    screen_coordinates: {
      x: Math.round(screenX),
      y: Math.round(screenY),
      to_x: screenToX === null ? undefined : Math.round(screenToX),
      to_y: screenToY === null ? undefined : Math.round(screenToY),
      coordinate_system: "screen_pixels",
      source: useCorrectedCoordinates
        ? "vision_corrected_region_capture"
        : (autoScreenCoordinates ? "coordinate_transform_estimate" : "caller_supplied"),
    },
    waited_ms: waitAfterMs,
    next_step: "browser_auth_ops.ensure_login",
    secrets_redacted: true,
  };
}

export {
  handleAssistCaptcha,
};
