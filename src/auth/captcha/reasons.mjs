const CAPTCHA_ASSIST_REASONS = Object.freeze({
  PLANNED: "captcha_assist_planned",
  CAPTCHA_NOT_DETECTED: "captcha_not_detected",
  MANAGED_TAB_REQUIRED: "managed_tab_required",
  CONFIRM_PHYSICAL_INPUT_REQUIRED: "confirm_physical_input_required",
  CONFIRM_AUTO_COORDINATES_REQUIRED: "confirm_auto_coordinates_required",
  CONFIRM_CORRECTED_COORDINATES_REQUIRED: "confirm_corrected_coordinates_required",
  AUTO_SCREEN_COORDINATES_UNAVAILABLE: "auto_screen_coordinates_unavailable",
  VISION_CORRECTION_UNAVAILABLE: "vision_correction_unavailable",
  VISION_CORRECTION_CONFIDENCE_TOO_LOW: "vision_correction_confidence_too_low",
  SCREEN_COORDINATES_REQUIRED: "screen_coordinates_required",
  NATIVE_DRAG_NOT_SUPPORTED: "native_drag_not_supported",
  PHYSICAL_INPUT_PROVIDER_UNAVAILABLE: "physical_input_provider_unavailable",
  SCREEN_DRAG_COORDINATES_REQUIRED: "screen_drag_coordinates_required",
  CROSS_ORIGIN_FRAME_HANDOFF_REQUIRED: "cross_origin_frame_handoff_required",
  MANAGED_TAB_ACTIVATION_FAILED: "managed_tab_activation_failed",
  PHYSICAL_DRAG_SENT: "physical_drag_sent",
  PHYSICAL_INPUT_SENT: "physical_input_sent",
});

export { CAPTCHA_ASSIST_REASONS };
