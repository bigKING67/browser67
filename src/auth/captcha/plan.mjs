import {
  CAPTCHA_ASSIST_RETRY_AFTER_MS,
  captchaAssistPolicy,
} from "../manual-challenge.mjs";
import {
  buildCoordinateTransformPlan,
  buildSliderDragHint,
} from "./coordinates.mjs";

const ASSIST_TARGETS = new Set(["auto", "checkbox", "slider"]);

function normalizeAssistTarget(raw) {
  const value = String(raw ?? "auto").trim().toLowerCase();
  return ASSIST_TARGETS.has(value) ? value : "auto";
}

function buildCoordinateSupport(pageState = {}, nativeCapabilities = {}, physicalInput = {}) {
  const target = pageState.target ?? null;
  const supportedActions = Array.isArray(nativeCapabilities.supported_actions)
    ? nativeCapabilities.supported_actions
    : [];
  const selectedProviderActions = Array.isArray(physicalInput.selected_provider?.supported_actions)
    ? physicalInput.selected_provider.supported_actions
    : [];
  const physicalProviders = Array.isArray(physicalInput.providers) ? physicalInput.providers : [];
  const providerSupportsWindowRegionCapture = physicalProviders.some(
    (provider) => provider?.supports_window_region_capture === true,
  );
  return {
    dom_client_rect_available: Boolean(target?.rect),
    returned_coordinate_system: "viewport_css_pixels",
    viewport_coordinates_are_not_screen_coordinates: true,
    native_window_rect_available: supportedActions.includes("get_window_rect"),
    native_window_rect_action: "browser_native_input.get_window_rect",
    screen_coordinate_requires_window_rect_and_viewport_offset: true,
    native_click_supported: supportedActions.includes("click"),
    native_drag_supported: supportedActions.includes("drag"),
    physical_input_provider_id: physicalInput.selected_provider?.provider_id,
    physical_click_supported: selectedProviderActions.includes("click"),
    physical_drag_supported: selectedProviderActions.includes("drag"),
    physical_window_region_capture_supported: providerSupportsWindowRegionCapture,
    native_drag_action: "browser_native_input.drag",
    native_drag_note: supportedActions.includes("drag")
      ? "browser_native_input can send an explicitly confirmed physical drag when caller supplies screen start/end coordinates."
      : "browser_native_input.drag is not available on this host/driver.",
    physical_input_action: "physical_input_provider",
    caller_supplied_screen_coordinates_supported: true,
  };
}

function buildPlan(pageState = {}, nativeCapabilities = {}, args = {}, physicalInput = {}) {
  const target = pageState.target ?? null;
  const assistTarget = normalizeAssistTarget(args.assist_target);
  const effectiveTarget = assistTarget !== "auto" ? assistTarget : String(target?.role ?? "auto");
  const degradedMode = target?.degraded_mode === true || target?.frame_access === "cross_origin_uninspectable";
  const coordinateSupport = buildCoordinateSupport(pageState, nativeCapabilities, physicalInput);
  const captchaKind = pageState.captcha_kind || (effectiveTarget === "slider" ? "slider" : "unknown");
  const sliderDragHint = buildSliderDragHint(target);
  const coordinateTransform = buildCoordinateTransformPlan(pageState, target, sliderDragHint, physicalInput);
  const plan = degradedMode ? [
    {
      step: "bring_tab_to_front",
      method: "tmwd_tabs_activate_or_native_activate_window",
    },
    {
      step: "window_scoped_screenshot",
      method: "ljq_driver_or_native_window_capture",
      fullscreen_allowed: false,
    },
    {
      step: "manual_user_handoff",
      method: "cross_origin_frame_cannot_be_safely_inspected_or_clicked",
      requires_confirmation: false,
    },
    {
      step: "resume",
      method: "browser_auth_ops.ensure_login",
    },
  ] : [
    {
      step: "bring_tab_to_front",
      method: "tmwd_tabs_activate_or_native_activate_window",
    },
    {
      step: "window_scoped_screenshot",
      method: "ljq_driver_or_native_window_capture",
      fullscreen_allowed: false,
    },
    {
      step: "locate_challenge_control",
      method: "dom_rect_or_vision_region_without_clicking",
    },
    {
      step: effectiveTarget === "slider" ? "native_mouse_drag" : "native_mouse_click",
      method: "physical_input_provider",
      requires_confirmation: true,
      requires_screen_coordinates: true,
      requires_screen_destination_coordinates: effectiveTarget === "slider",
      can_use_auto_coordinate_estimate: coordinateTransform.can_use_with_explicit_confirmation,
    },
    {
      step: "wait",
      duration_ms: CAPTCHA_ASSIST_RETRY_AFTER_MS,
    },
    {
      step: "resume",
      method: "browser_auth_ops.ensure_login",
    },
  ];
  const blockedIf = [
    "multi_round_image_or_puzzle",
    "unknown_challenge",
    "target_window_not_active",
  ];
  if (degradedMode) {
    blockedIf.push("cross_origin_frame_uninspectable", "manual_user_handoff_required");
  }
  if (effectiveTarget === "slider" && coordinateSupport.physical_drag_supported !== true) {
    blockedIf.push("physical_drag_not_available");
  }
  return {
    captcha_kind: captchaKind,
    assist_target: effectiveTarget,
    captcha_assist: captchaAssistPolicy(captchaKind),
    degraded_mode: degradedMode || undefined,
    manual_handoff_required: degradedMode || undefined,
    degraded_reason: degradedMode ? "cross_origin_frame_uninspectable" : undefined,
    coordinate_support: coordinateSupport,
    slider_drag_hint: sliderDragHint,
    coordinate_transform: coordinateTransform,
    plan,
    blocked_if: blockedIf,
  };
}

export {
  buildCoordinateSupport,
  buildPlan,
  normalizeAssistTarget,
};
