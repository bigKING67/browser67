const HYBRID_CAPTCHA_STRATEGY_ID = "captcha_router_v2";
const HYBRID_CAPTCHA_POLICY_ID = "hybrid_policy_v1";

const CAPTCHA_SOLVER_MODES = Object.freeze([
  "auto",
  "coordinate_only",
  "protocol_allowed",
  "manual_only",
]);

const CAPTCHA_LOCATOR_PROVIDERS = Object.freeze([
  "auto",
  "local",
  "vision",
  "jfbym",
]);

const PROTOCOL_CAPTCHA_KINDS = new Set([
  "hcaptcha",
  "recaptcha",
  "turnstile",
]);

const COORDINATE_CAPTCHA_KINDS = new Set([
  "checkbox",
  "slider",
  "image_click",
  "rotate",
  "generic",
]);

const MANUAL_HANDOFF_CONDITIONS = Object.freeze([
  "multi_round_image_or_puzzle",
  "repeated_failure",
  "unknown_or_high_risk_challenge",
  "cross_origin_frame_uninspectable",
  "low_solver_confidence",
  "provider_unavailable",
]);

function normalizeCaptchaSolverMode(raw) {
  const value = String(raw ?? "auto").trim().toLowerCase();
  return CAPTCHA_SOLVER_MODES.includes(value) ? value : "auto";
}

function normalizeCaptchaLocatorProvider(raw) {
  const value = String(raw ?? "auto").trim().toLowerCase();
  return CAPTCHA_LOCATOR_PROVIDERS.includes(value) ? value : "auto";
}

function normalizeCaptchaKind(raw) {
  const value = String(raw ?? "").trim().toLowerCase();
  return value || "unknown";
}

function isProtocolCaptchaKind(kind) {
  return PROTOCOL_CAPTCHA_KINDS.has(normalizeCaptchaKind(kind));
}

function isCoordinateCaptchaKind(kind) {
  return COORDINATE_CAPTCHA_KINDS.has(normalizeCaptchaKind(kind));
}

function buildHybridCaptchaPolicy(args = {}, captchaKind = "unknown") {
  const solverMode = normalizeCaptchaSolverMode(args.captcha_solver_mode);
  const locatorProvider = normalizeCaptchaLocatorProvider(args.captcha_locator_provider);
  const normalizedKind = normalizeCaptchaKind(captchaKind);
  const manualOnly = solverMode === "manual_only";
  const coordinateSolverEnabled = !manualOnly;
  const protocolSolverRequested = solverMode === "protocol_allowed";
  const protocolSolverConfirmed = args.confirm_protocol_solver === true;
  return {
    strategy_id: HYBRID_CAPTCHA_STRATEGY_ID,
    policy_id: HYBRID_CAPTCHA_POLICY_ID,
    captcha_kind: normalizedKind,
    solver_mode: solverMode,
    locator_provider: locatorProvider,
    coordinate_solver_enabled: coordinateSolverEnabled,
    protocol_solver_default_enabled: false,
    protocol_solver_requested: protocolSolverRequested,
    protocol_solver_requires_allowlist: true,
    protocol_solver_requires_confirmation: true,
    protocol_solver_confirmed: protocolSolverConfirmed,
    protocol_solver_candidate: isProtocolCaptchaKind(normalizedKind),
    protocol_solver_apply_supported: false,
    coordinate_solver_candidate: isCoordinateCaptchaKind(normalizedKind),
    fullscreen_screenshot_allowed: false,
    js_cdp_widget_click_allowed: false,
    token_cookie_extraction_allowed: false,
    provider_response_injection_default_enabled: false,
    manual_handoff_conditions: [...MANUAL_HANDOFF_CONDITIONS],
    safe_defaults: [
      "planning_only_until_explicit_execution_action",
      "bounded_window_or_region_screenshot_only",
      "physical_input_for_visible_ui_challenges",
      "allowlisted_protocol_solver_only_when_explicitly_confirmed",
      "manual_handoff_on_unknown_or_escalated_challenge",
    ],
  };
}

export {
  CAPTCHA_LOCATOR_PROVIDERS,
  CAPTCHA_SOLVER_MODES,
  COORDINATE_CAPTCHA_KINDS,
  HYBRID_CAPTCHA_POLICY_ID,
  HYBRID_CAPTCHA_STRATEGY_ID,
  MANUAL_HANDOFF_CONDITIONS,
  PROTOCOL_CAPTCHA_KINDS,
  buildHybridCaptchaPolicy,
  isCoordinateCaptchaKind,
  isProtocolCaptchaKind,
  normalizeCaptchaKind,
  normalizeCaptchaLocatorProvider,
  normalizeCaptchaSolverMode,
};
