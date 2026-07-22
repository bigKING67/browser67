import { CAPTCHA_ASSIST_REASONS } from "../captcha/reasons.mjs";
import {
  coordinateBlock,
  selectScreenCoordinates,
  visionCorrectionBlock,
} from "./input-coordinates.mjs";
import { assistBlocked } from "./outcome.mjs";

function blocked(outcome) {
  return { ok: false, outcome };
}

function visionBlockOutcome(planned, visionBlock) {
  return assistBlocked(planned, visionBlock.reason, {
    correction_confidence: visionBlock.correction_confidence,
    correction_minimum_confidence: visionBlock.correction_minimum_confidence,
    required_one_of: [
      "explicit screen_x/screen_y coordinates",
      "run_vision_correction:true with confidence above threshold",
      "manual_user_handoff",
    ],
  });
}

function prepareAssistRequest(args, planned, managedTab) {
  if (planned.status !== "planned") {
    return blocked(assistBlocked(
      planned,
      planned.reason || CAPTCHA_ASSIST_REASONS.CAPTCHA_NOT_DETECTED,
    ));
  }
  if (!managedTab.managed) {
    return blocked(assistBlocked(planned, CAPTCHA_ASSIST_REASONS.MANAGED_TAB_REQUIRED));
  }
  if (planned.manual_handoff_required === true || planned.degraded_mode === true) {
    return blocked(assistBlocked(
      planned,
      CAPTCHA_ASSIST_REASONS.CROSS_ORIGIN_FRAME_HANDOFF_REQUIRED,
      { escalation: "manual_user_handoff" },
    ));
  }

  const selectedRoute = planned.captcha_router?.selected_route;
  if (selectedRoute?.route_type === "manual_handoff") {
    return blocked(assistBlocked(planned, CAPTCHA_ASSIST_REASONS.ROUTER_MANUAL_HANDOFF_REQUIRED, {
      escalation: "manual_user_handoff",
      captcha_router_reason: selectedRoute.reason,
    }));
  }
  if (selectedRoute?.route_type === "protocol_solver") {
    return blocked(assistBlocked(
      planned,
      CAPTCHA_ASSIST_REASONS.PROTOCOL_SOLVER_APPLY_NOT_IMPLEMENTED,
      {
        escalation: "manual_user_handoff",
        captcha_router_route_id: selectedRoute.route_id,
        protocol_solver_apply_supported: false,
        next_implementation_step: "add an allowlisted provider apply path with explicit response injection contract",
      },
    ));
  }

  const useProviderCoordinates = args?.use_provider_coordinates === true;
  const autoScreenCoordinates = args?.auto_screen_coordinates === true;
  const useCorrectedCoordinates = args?.use_vision_corrected_coordinates === true;
  if (useProviderCoordinates && selectedRoute?.solver_provider !== "jfbym") {
    return blocked(assistBlocked(
      planned,
      CAPTCHA_ASSIST_REASONS.PROVIDER_COORDINATES_ROUTE_UNAVAILABLE,
      {
        captcha_router_route_id: selectedRoute?.route_id,
        captcha_router_provider_coordinate_block_reason: planned.captcha_router?.provider_coordinate_block_reason,
        required_args: [
          'captcha_locator_provider:"jfbym"',
          "run_vision_correction:true",
          "confirm_provider_coordinates:true",
        ],
      },
    ));
  }
  if (args?.confirm_physical_input !== true) {
    return blocked(assistBlocked(
      planned,
      CAPTCHA_ASSIST_REASONS.CONFIRM_PHYSICAL_INPUT_REQUIRED,
    ));
  }
  if (useProviderCoordinates && args?.confirm_provider_coordinates !== true) {
    return blocked(assistBlocked(
      planned,
      CAPTCHA_ASSIST_REASONS.CONFIRM_PROVIDER_COORDINATES_REQUIRED,
      {
        required_confirmations: [
          "confirm_physical_input:true",
          "confirm_provider_coordinates:true",
        ],
      },
    ));
  }
  if (useProviderCoordinates && args?.run_vision_correction !== true) {
    return blocked(assistBlocked(
      planned,
      CAPTCHA_ASSIST_REASONS.PROVIDER_COORDINATE_ARTIFACT_REQUIRED,
      {
        required: "run_vision_correction:true",
        fullscreen_allowed: false,
      },
    ));
  }
  if (autoScreenCoordinates && args?.confirm_auto_coordinates !== true) {
    return blocked(assistBlocked(
      planned,
      CAPTCHA_ASSIST_REASONS.CONFIRM_AUTO_COORDINATES_REQUIRED,
      {
        required_confirmations: ["confirm_physical_input:true", "confirm_auto_coordinates:true"],
      },
    ));
  }
  if (useCorrectedCoordinates && args?.confirm_corrected_coordinates !== true) {
    return blocked(assistBlocked(
      planned,
      CAPTCHA_ASSIST_REASONS.CONFIRM_CORRECTED_COORDINATES_REQUIRED,
      {
        required_confirmations: [
          "confirm_physical_input:true",
          "confirm_corrected_coordinates:true",
        ],
      },
    ));
  }

  const initialVisionBlock = useCorrectedCoordinates ? visionCorrectionBlock(planned) : null;
  if (initialVisionBlock) {
    return blocked(visionBlockOutcome(planned, initialVisionBlock));
  }
  if (!useProviderCoordinates) {
    const initialCoordinates = selectScreenCoordinates(args, planned, {
      autoScreenCoordinates,
      useCorrectedCoordinates,
    });
    const initialCoordinateBlock = coordinateBlock(
      planned,
      initialCoordinates,
      autoScreenCoordinates,
    );
    if (initialCoordinateBlock) {
      return blocked(assistBlocked(planned, initialCoordinateBlock.reason, {
        required_coordinates: initialCoordinateBlock.required_coordinates,
      }));
    }
  }
  if (
    planned.assist_target === "slider"
    && planned.coordinate_support?.physical_drag_supported !== true
  ) {
    return blocked(assistBlocked(planned, CAPTCHA_ASSIST_REASONS.NATIVE_DRAG_NOT_SUPPORTED, {
      escalation: "manual_user_handoff",
    }));
  }

  return {
    ok: true,
    autoScreenCoordinates,
    useCorrectedCoordinates,
    useProviderCoordinates,
  };
}

export {
  prepareAssistRequest,
  visionBlockOutcome,
};
