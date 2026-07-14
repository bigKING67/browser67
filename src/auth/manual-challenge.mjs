const CAPTCHA_ASSIST_SOP_REFS = Object.freeze([
  {
    id: "sophub-hcaptcha-physical",
    kind: "hcaptcha",
    url: "https://fudankw.cn/sophub/sops/69f207e9ba77d8b04fb0b9bb",
    title: "hCaptcha physical native-input SOP",
  },
  {
    id: "sophub-vision-api",
    kind: "vision",
    url: "https://fudankw.cn/sophub/sops/6a2d8e2adfeb2bc50c32fbe0",
    title: "Vision API window-scoped screenshot SOP",
  },
]);

const CAPTCHA_ASSIST_MODE = "manual_or_native_physical";
const CAPTCHA_ASSIST_STRATEGY_ID = "captcha_router_v2";
const CAPTCHA_ASSIST_POLICY_ID = "hybrid_policy_v1";
const CAPTCHA_ASSIST_RETRY_AFTER_MS = 5_000;

const CAPTCHA_ASSIST_ALLOWED_OPERATIONS = Object.freeze([
  "bring_tab_to_front",
  "window_scoped_screenshot",
  "native_mouse_keyboard_input",
  "allowlisted_provider_coordinate_solver",
  "allowlisted_provider_protocol_solver",
]);

const CAPTCHA_ASSIST_PROHIBITED_OPERATIONS = Object.freeze([
  "js_or_cdp_click_on_captcha",
  "captcha_token_or_cookie_extraction",
  "browser_token_or_cookie_extraction",
  "rapid_retry",
  "full_screen_screenshot",
]);

const CAPTCHA_ASSIST_CDP_ALLOWED_FOR = Object.freeze([
  "bring_tab_to_front",
  "window_scoped_screenshot",
]);

const CAPTCHA_ASSIST_HANDOFF_CONDITIONS = Object.freeze([
  "multi_round_image_or_puzzle",
  "repeated_failure",
  "unknown_or_high_risk_challenge",
]);

const MANUAL_CHALLENGE_DETECTOR_JS = String.raw`
const detectManualChallenge = () => {
  const hasSelector = (selector) => {
    try {
      return Boolean(document.querySelector(selector));
    } catch {
      return false;
    }
  };
  const iframeSources = Array.from(document.querySelectorAll("iframe"))
    .map((frame) => String(frame.getAttribute("src") || ""))
    .join(" ");
  const bodyText = String(document.body?.innerText || "");
  const hits = [];
  const addHit = (kind, indicator) => {
    if (!hits.some((hit) => hit.kind === kind && hit.indicator === indicator)) {
      hits.push({ kind, indicator });
    }
  };

  if (hasSelector('.h-captcha, [data-hcaptcha-widget-id], iframe[src*="hcaptcha" i], textarea[name="h-captcha-response"], input[name="h-captcha-response"]')
    || /hcaptcha/i.test(iframeSources)) {
    addHit("hcaptcha", "hcaptcha_widget");
  }
  if (hasSelector('.g-recaptcha, [data-recaptcha-widget-id], iframe[src*="recaptcha" i], textarea[name="g-recaptcha-response"], input[name="g-recaptcha-response"]')
    || /recaptcha/i.test(iframeSources)) {
    addHit("recaptcha", "recaptcha_widget");
  }
  if (hasSelector('.cf-turnstile, [data-cf-turnstile], iframe[src*="turnstile" i], iframe[src*="challenges.cloudflare.com" i], input[name="cf-turnstile-response"], textarea[name="cf-turnstile-response"]')
    || /turnstile|challenges\.cloudflare\.com/i.test(iframeSources)) {
    addHit("turnstile", "turnstile_widget");
  }
  if (/checking if the site connection is secure|verify you are human|are you human|just a moment/i.test(bodyText)
    || /cloudflare/i.test(document.title || "")) {
    addHit("cloudflare", "challenge_text");
  }
  if (hasSelector('[class*="slider" i], [id*="slider" i], [class*="slide" i][class*="captcha" i], [id*="slide" i][id*="captcha" i]')
    || /请按住|拖动|滑块|slide to verify|drag.*slider|drag.*verify/i.test(bodyText)) {
    addHit("slider", "slider_marker");
  }
  if (hasSelector('[class*="captcha" i], [id*="captcha" i]:not(input):not(label):not(form):not(p), iframe[src*="captcha" i], [data-sitekey], [data-captcha]')) {
    addHit("generic", "captcha_marker");
  }

  const priority = ["hcaptcha", "recaptcha", "turnstile", "cloudflare", "slider", "generic"];
  const captchaKind = priority.find((kind) => hits.some((hit) => hit.kind === kind)) || "";
  return {
    challenge_detected: hits.length > 0,
    captcha_detected: hits.length > 0,
    captcha_kind: captchaKind,
    captcha_indicators: hits.map((hit) => hit.indicator).slice(0, 8),
  };
};
`;

const SSO_CHALLENGE_DETECTOR_JS = String.raw`
const detectSsoChallenge = () => {
  const queryAll = (selector) => {
    try {
      return Array.from(document.querySelectorAll(selector));
    } catch {
      return [];
    }
  };
  const attributeText = (el) => [
    el?.textContent,
    el?.getAttribute?.("aria-label"),
    el?.getAttribute?.("title"),
    el?.getAttribute?.("href"),
  ].filter(Boolean).join(" ");
  const pathname = String(location.pathname || "");
  const bodyText = String(document.body?.innerText || "");
  const continuationPathDetected = /(?:^|\/)(?:confirm-existing-account|(?:i\/)?oauth2?\/authorize|oauth\/authorize|authorize|consent)(?:\/|$)/i.test(pathname);
  const continuationTextDetected = /existing account|found an existing account|use (?:your )?original sign-in method|authorize (?:this )?(?:app|application)|找到现有账户|使用\s*x\s*登录|授权应用/i.test(bodyText);
  const authContinuationDetected = continuationPathDetected || continuationTextDetected;
  const providerPattern = /\b(?:sso|single sign(?:-|\s)?on|google|github|microsoft|okta|saml|oauth|apple)\b|continue with x|sign in with x|使用\s*x\s*登录/i;
  const ssoElements = queryAll('a, button, [role="button"]').filter((el) => providerPattern.test(attributeText(el)));
  const authenticatedIndicators = [];
  const addAuthenticatedIndicator = (indicator) => {
    if (!authenticatedIndicators.includes(indicator)) {
      authenticatedIndicators.push(indicator);
    }
  };
  const bodyClasses = Array.from(document.body?.classList || []);
  if (bodyClasses.some((name) => /^(?:logged[-_]?in|authenticated|is[-_]?authenticated)$/i.test(String(name)))) {
    addAuthenticatedIndicator("body_authenticated_class");
  }
  const userLoginMeta = document.querySelector('meta[name="user-login" i]');
  if (String(userLoginMeta?.getAttribute("content") || "").trim()) {
    addAuthenticatedIndicator("user_login_meta");
  }
  if (document.querySelector('form[action*="/logout" i], a[href*="/logout" i], a[href*="/signout" i], [data-testid*="logout" i]')) {
    addAuthenticatedIndicator("logout_control");
  }
  if (document.querySelector('[aria-label*="account menu" i], [aria-label*="profile menu" i], [data-testid*="account-menu" i], [data-testid*="profile-menu" i]')) {
    addAuthenticatedIndicator("account_navigation");
  }
  const passwordInputCount = queryAll('input[type="password"]').length;
  const authenticatedSurfaceDetected = authenticatedIndicators.length > 0
    && passwordInputCount === 0
    && !authContinuationDetected;
  const oauthPopupDetected = !authenticatedSurfaceDetected && ssoElements.some((el) => {
    const dataPopup = String(el.getAttribute("data-oauth-popup") || "").trim().toLowerCase();
    const target = String(el.getAttribute("target") || "").trim().toLowerCase();
    const explicitText = [
      el.textContent,
      el.getAttribute("aria-label"),
      el.getAttribute("title"),
    ].filter(Boolean).join(" ");
    const openingCode = [
      el.getAttribute("onclick"),
      el.getAttribute("href"),
    ].filter(Boolean).join(" ");
    return ["true", "1", "yes"].includes(dataPopup)
      || target === "_blank"
      || /(?:oauth\s+)?popup|opens? in (?:a )?new (?:window|tab)/i.test(explicitText)
      || /window\.open\s*\(/i.test(openingCode);
  });
  const ssoDetected = !authenticatedSurfaceDetected
    && (ssoElements.length > 0 || authContinuationDetected);
  return {
    sso_detected: ssoDetected,
    oauth_popup_detected: oauthPopupDetected,
    authenticated_surface_detected: authenticatedSurfaceDetected,
    auth_continuation_detected: authContinuationDetected,
    sso_indicators: [
      ...(ssoElements.length > 0 ? ["provider_control"] : []),
      ...(continuationPathDetected ? ["continuation_path"] : []),
      ...(continuationTextDetected ? ["continuation_text"] : []),
    ],
    authenticated_indicators: authenticatedIndicators.slice(0, 8),
  };
};
`;

function captchaAssistPolicy(captchaKind = "") {
  return {
    captcha_kind: String(captchaKind || "unknown"),
    assist_mode: CAPTCHA_ASSIST_MODE,
    strategy_id: CAPTCHA_ASSIST_STRATEGY_ID,
    policy_id: CAPTCHA_ASSIST_POLICY_ID,
    next_step: "complete_challenge_then_ensure_login",
    allowed_operations: CAPTCHA_ASSIST_ALLOWED_OPERATIONS,
    prohibited_operations: CAPTCHA_ASSIST_PROHIBITED_OPERATIONS,
    cdp_allowed_for: CAPTCHA_ASSIST_CDP_ALLOWED_FOR,
    hybrid_router_policy: {
      default_route: "manual_or_physical_coordinate",
      coordinate_solver_enabled: true,
      protocol_solver_default_enabled: false,
      protocol_solver_requires_allowlist: true,
      protocol_solver_requires_confirmation: true,
      protocol_solver_apply_supported: false,
      provider_config_repo_external_only: true,
      js_cdp_widget_click_allowed: false,
      token_cookie_extraction_allowed: false,
    },
    vision_policy: {
      last_resort: true,
      target_window_required: true,
      fullscreen_screenshot_allowed: false,
      prefer_region_over_window: true,
    },
    native_input_policy: {
      mode: "physical_mouse_keyboard",
      prefer_natural_cursor_path: true,
      avoid_fast_retry: true,
    },
    retry_after_ms: CAPTCHA_ASSIST_RETRY_AFTER_MS,
    escalation: "manual_user_handoff",
    handoff_conditions: CAPTCHA_ASSIST_HANDOFF_CONDITIONS,
    sop_refs: CAPTCHA_ASSIST_SOP_REFS,
  };
}

function manualCaptchaContextFields(pageState = {}) {
  if (pageState?.captcha_detected !== true && pageState?.challenge_detected !== true) {
    return {};
  }
  return {
    captcha_kind: pageState.captcha_kind || "unknown",
    captcha_assist: captchaAssistPolicy(pageState.captcha_kind),
  };
}

function publicChallengeFields(pageState = {}) {
  const indicators = Array.isArray(pageState?.captcha_indicators)
    ? pageState.captcha_indicators.filter(Boolean).slice(0, 8)
    : [];
  return {
    challenge_detected: pageState?.challenge_detected === true || undefined,
    captcha_detected: pageState?.captcha_detected === true,
    captcha_kind: pageState?.captcha_kind || undefined,
    captcha_indicators: indicators.length > 0 ? indicators : undefined,
  };
}

export {
  CAPTCHA_ASSIST_ALLOWED_OPERATIONS,
  CAPTCHA_ASSIST_CDP_ALLOWED_FOR,
  CAPTCHA_ASSIST_HANDOFF_CONDITIONS,
  CAPTCHA_ASSIST_MODE,
  CAPTCHA_ASSIST_POLICY_ID,
  CAPTCHA_ASSIST_PROHIBITED_OPERATIONS,
  CAPTCHA_ASSIST_RETRY_AFTER_MS,
  CAPTCHA_ASSIST_SOP_REFS,
  CAPTCHA_ASSIST_STRATEGY_ID,
  MANUAL_CHALLENGE_DETECTOR_JS,
  SSO_CHALLENGE_DETECTOR_JS,
  captchaAssistPolicy,
  manualCaptchaContextFields,
  publicChallengeFields,
};
