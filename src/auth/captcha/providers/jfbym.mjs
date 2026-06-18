import {
  kindAllowed,
  loadJfbymProviderConfig,
  originAllowed,
} from "./config.mjs";

const JFBYM_COORDINATE_MODES = Object.freeze([
  "checkbox",
  "slider",
  "image_click",
  "rotate",
  "hcaptcha",
  "recaptcha",
  "turnstile",
]);

const JFBYM_PROTOCOL_MODES = Object.freeze([
  "hcaptcha",
  "recaptcha",
  "turnstile",
]);

function providerModeStatus(config, pageState = {}) {
  const origin = pageState.origin || "";
  const kind = pageState.captcha_kind || "";
  const allowedOrigin = originAllowed(config, origin);
  const allowedKind = kindAllowed(config, kind);
  return {
    coordinate_mode: {
      available: config.configured === true
        && config.coordinate_solver_enabled === true
        && allowedOrigin
        && allowedKind
        && JFBYM_COORDINATE_MODES.includes(kind),
      configured: config.configured === true,
      enabled: config.coordinate_solver_enabled === true,
      allowed_origin: allowedOrigin,
      allowed_kind: allowedKind,
      supported_kinds: [...JFBYM_COORDINATE_MODES],
      requires_origin_allowlist: true,
      requires_confirm_provider_coordinates: true,
    },
    protocol_mode: {
      available: config.configured === true
        && config.protocol_solver_enabled === true
        && allowedOrigin
        && allowedKind
        && JFBYM_PROTOCOL_MODES.includes(kind),
      configured: config.configured === true,
      enabled: config.protocol_solver_enabled === true,
      allowed_origin: allowedOrigin,
      allowed_kind: allowedKind,
      supported_kinds: [...JFBYM_PROTOCOL_MODES],
      requires_confirm_protocol_solver: true,
    },
  };
}

async function buildJfbymProviderStatus(args = {}, pageState = {}) {
  const config = await loadJfbymProviderConfig(args);
  const modes = providerModeStatus(config, pageState);
  return {
    provider_id: "jfbym",
    display_name: "JFBYM/Yunma CAPTCHA provider",
    status: config.configured ? "configured" : "not_configured",
    configured: config.configured,
    enabled: config.enabled,
    token_configured: config.token_configured,
    config_file_present: config.config_file_present,
    config_path: config.config_path,
    base_url: config.base_url,
    timeout_ms: config.timeout_ms,
    max_attempts: config.max_attempts,
    min_confidence: config.min_confidence,
    allowed_origins: config.allowed_origins,
    allowed_kinds: config.allowed_kinds,
    coordinate_type_ids: config.coordinate_type_ids,
    coordinate_extra_configured: config.coordinate_extra_configured,
    slider_result_mode: config.slider_result_mode,
    coordinate_mode: modes.coordinate_mode,
    protocol_mode: modes.protocol_mode,
    secrets_redacted: true,
  };
}

export {
  JFBYM_COORDINATE_MODES,
  JFBYM_PROTOCOL_MODES,
  buildJfbymProviderStatus,
  providerModeStatus,
};
