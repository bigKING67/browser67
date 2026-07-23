import { normalizeTimeoutMs } from "../runtime/config/limits.mjs";
import { createToolError } from "../runtime/tool-errors.mjs";
import { executeTmwdJsWithFallback, resolvePreferredBrowserContext } from "../tmwd-runtime/index.mjs";
import {
  MANUAL_CHALLENGE_DETECTOR_JS,
  SSO_CHALLENGE_DETECTOR_JS,
  manualCaptchaContextFields,
  publicChallengeFields,
} from "./manual-challenge.mjs";
import {
  normalizeOrigin,
  normalizePathPattern,
  normalizeProfile,
  pathMatchesAny,
  profileIdFromOrigin,
  redactProfile,
  sanitizeProfileId,
} from "./profile-store.mjs";

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function parseUrlState(rawUrl) {
  try {
    const url = new URL(String(rawUrl ?? ""));
    return {
      url: url.href,
      origin: url.origin,
      pathname: url.pathname,
    };
  } catch {
    return {
      url: String(rawUrl ?? ""),
      origin: "",
      pathname: "",
    };
  }
}

function genericLoginPathMatch(pathname) {
  return /(^|[\/_-])(login|signin|sign-in)([\/_-]|$)/i.test(String(pathname ?? ""));
}

function detectLoginFromUrl(url, profile) {
  const state = parseUrlState(url);
  const pathMatch = profile
    ? pathMatchesAny(state.pathname, profile.login_path_patterns)
    : genericLoginPathMatch(state.pathname);
  return {
    ...state,
    login_detected: pathMatch,
    detection_source: "url",
    path_match: pathMatch,
    selector_match: false,
  };
}

function detectLoginPage(pageState, profile) {
  const pathMatch = profile
    ? pathMatchesAny(pageState.pathname, profile.login_path_patterns)
    : genericLoginPathMatch(pageState.pathname);
  const selectorMatch = profile
    ? pageState.profile_selectors?.username === true && pageState.profile_selectors?.password === true
    : Number(pageState.password_input_count ?? 0) > 0;
  return {
    login_detected: pathMatch || selectorMatch,
    detection_source: pathMatch ? "path" : (selectorMatch ? "selectors" : "none"),
    path_match: pathMatch,
    selector_match: selectorMatch,
  };
}

function manualRequirementFromPageState(pageState) {
  if (pageState?.captcha_detected === true) {
    return "manual_required_captcha";
  }
  if (pageState?.mfa_detected === true || Number(pageState?.mfa_input_count ?? 0) > 0) {
    return "manual_required_mfa";
  }
  if (
    pageState?.authenticated_surface_detected === true
    && pageState?.auth_continuation_detected !== true
    && Number(pageState?.password_input_count ?? 0) === 0
  ) {
    return "";
  }
  if (pageState?.sso_detected === true && Number(pageState?.password_input_count ?? 0) === 0) {
    return "manual_required_sso";
  }
  return "";
}

function publicAuthSurfaceFields(pageState = {}) {
  return {
    authenticated_surface_detected: pageState?.authenticated_surface_detected === true,
    auth_continuation_detected: pageState?.auth_continuation_detected === true,
    sso_detected: pageState?.sso_detected === true,
    oauth_popup_detected: pageState?.oauth_popup_detected === true,
  };
}

function manualContextKind(reason, pageState = {}) {
  if (reason === "manual_required_captcha") {
    return "captcha";
  }
  if (reason === "manual_required_mfa") {
    return "mfa";
  }
  if (reason === "manual_required_sso" && pageState.oauth_popup_detected === true) {
    return "oauth_popup";
  }
  if (reason === "manual_required_sso") {
    return "sso";
  }
  return "";
}

function manualRequirementFields(reason, pageState = {}, args = {}) {
  const normalizedReason = String(reason ?? "");
  if (!normalizedReason.startsWith("manual_required_")) {
    return {};
  }
  const tabId = String(args?.tab_id ?? args?.switch_tab_id ?? args?.session_id ?? pageState?.page?.id ?? "").trim();
  const workspaceKey = String(args?.workspace_key ?? pageState?.workspace_key ?? "").trim();
  return {
    manual_required: true,
    manual_context: {
      kind: manualContextKind(normalizedReason, pageState),
      ...(
        normalizedReason === "manual_required_captcha"
          ? manualCaptchaContextFields(pageState)
          : {}
      ),
      tab_id: tabId || undefined,
      workspace_key: workspaceKey || undefined,
      resume_action: "ensure_login",
    },
  };
}

function wrapPageFunction(body, input) {
  return `return await (async (input) => {\n${body}\n})(${JSON.stringify(input ?? {})});`;
}

async function resolveAuthBrowserContext(args, options = {}) {
  const explicitTarget = String(args?.tab_id ?? args?.switch_tab_id ?? args?.session_id ?? args?.sessionId ?? "").trim();
  const timeoutMs = explicitTarget
    ? Math.min(10_000, normalizeTimeoutMs(args?.timeout_ms))
    : 0;
  const started = Date.now();
  const attemptResolve = async () => {
    try {
      const preferred = await resolvePreferredBrowserContext(args ?? {}, options);
      const selectionWarning = String(preferred.context?.selection?.warning ?? "").trim();
      if (selectionWarning) {
        throw createToolError("NO_SESSION", `browser_auth_ops target unavailable: ${selectionWarning}`, {
          retryable: true,
        });
      }
      return preferred;
    } catch (error) {
      const message = String(error?.message ?? error);
      const retryableTargetLookup = explicitTarget
        && (message.includes("tab not found") || message.includes("session_id="));
      if (!retryableTargetLookup || Date.now() - started >= timeoutMs) {
        throw error;
      }
      await sleep(250);
      return attemptResolve();
    }
  };
  return attemptResolve();
}

async function executeBrowserScript(args, body, input = {}, options = {}) {
  const script = wrapPageFunction(body, input);
  const preferred = await resolveAuthBrowserContext(args ?? {}, options);
  if (preferred.transport !== "tmwd_ws" && preferred.transport !== "tmwd_link") {
    throw createToolError(
      "TRANSPORT_UNAVAILABLE",
      `browser_auth_ops requires TMWD transport, got ${preferred.transport}`,
      { retryable: true },
    );
  }
  const result = await executeTmwdJsWithFallback(args ?? {}, preferred.context, script, options);
  return {
    transport: result.context.tmwd_transport === "ws" ? "tmwd_ws" : "tmwd_link",
    transport_attempts: result.transport_attempts,
    value: result.executed.value,
    raw: result.executed.raw,
    page: {
      id: result.context.target.id,
      url: result.context.target.url,
      title: result.context.target.title,
    },
  };
}

async function inspectCurrentPage(args, profile = null, options = {}) {
  const result = await executeBrowserScript(args, `
    const profile = input.profile || {};
    const hasSelector = (selector) => {
      if (!selector) return false;
      try {
        return Boolean(document.querySelector(selector));
      } catch {
        return false;
      }
    };
    const passwordInputs = Array.from(document.querySelectorAll('input[type="password"]'));
    const usernameLikeInputs = Array.from(document.querySelectorAll('input[type="text"], input[type="email"], input[name*="user" i], input[name*="email" i]'));
    const mfaInputs = Array.from(document.querySelectorAll('input[name*="otp" i], input[name*="totp" i], input[name*="mfa" i], input[name*="code" i], input[autocomplete="one-time-code"]'));
    ${MANUAL_CHALLENGE_DETECTOR_JS}
    const challenge = detectManualChallenge();
    ${SSO_CHALLENGE_DETECTOR_JS}
    const ssoChallenge = detectSsoChallenge();
    const bodyText = String(document.body?.innerText || "");
    return {
      url: location.href,
      origin: location.origin,
      pathname: location.pathname,
      title: document.title,
      ready_state: document.readyState,
      password_input_count: passwordInputs.length,
      username_like_input_count: usernameLikeInputs.length,
      mfa_input_count: mfaInputs.length,
      ...challenge,
      ...ssoChallenge,
      mfa_detected: mfaInputs.length > 0 || /\\b(otp|totp|mfa|two[- ]?factor|verification code|authenticator)\\b/i.test(bodyText),
      profile_selectors: {
        username: hasSelector(profile.username_selector),
        password: hasSelector(profile.password_selector),
        submit: hasSelector(profile.submit_selector)
      }
    };
  `, { profile: profile ? redactProfile(profile) : null }, options);
  return {
    ...result.value,
    transport: result.transport,
    transport_attempts: result.transport_attempts,
    page: result.page,
  };
}

async function suggestProfileFromCurrentPage(args, options = {}) {
  const result = await executeBrowserScript(args, `
    const cssEscape = (value) => {
      if (globalThis.CSS && typeof CSS.escape === "function") {
        return CSS.escape(String(value));
      }
      return String(value).replace(/[^a-zA-Z0-9_-]/g, "\\\\$&");
    };
    const queryAll = (selector, root = document) => {
      try {
        return Array.from(root.querySelectorAll(selector));
      } catch {
        return [];
      }
    };
    const uniqueInDocument = (selector, el) => {
      const matches = queryAll(selector);
      return matches.length === 1 && matches[0] === el;
    };
    const selectorFor = (el, fallbackSelectors = []) => {
      if (!el) return "";
      if (el.id) {
        const selector = "#" + cssEscape(el.id);
        if (uniqueInDocument(selector, el)) return selector;
      }
      const name = el.getAttribute("name");
      if (name) {
        const tag = String(el.tagName || "").toLowerCase();
        const selector = tag + "[name=\\"" + name.replace(/"/g, "\\\\\\"") + "\\"]";
        if (uniqueInDocument(selector, el)) return selector;
      }
      for (const selector of fallbackSelectors) {
        if (uniqueInDocument(selector, el)) return selector;
      }
      return fallbackSelectors.find((selector) => queryAll(selector).includes(el)) || "";
    };
    const passwordInputs = queryAll('input[type="password"]');
    const passwordInput = passwordInputs.length === 1 ? passwordInputs[0] : passwordInputs[0] || null;
    const form = passwordInput?.closest("form") || document.querySelector("form") || null;
    const formInputs = queryAll('input:not([type="hidden"]):not([type="password"]):not([type="submit"]):not([type="button"])', form || document);
    const scoreUsername = (el) => {
      const attrs = [
        el.id,
        el.getAttribute("name"),
        el.getAttribute("autocomplete"),
        el.getAttribute("placeholder"),
        el.getAttribute("aria-label"),
        el.type,
      ].filter(Boolean).join(" ").toLowerCase();
      let score = 0;
      if (/user(name)?/.test(attrs)) score += 6;
      if (/email|mail/.test(attrs)) score += 5;
      if (/login|account/.test(attrs)) score += 3;
      if (el.type === "email") score += 4;
      if (el.type === "text" || !el.type) score += 1;
      return score;
    };
    const usernameInput = formInputs
      .map((el) => ({ el, score: scoreUsername(el) }))
      .sort((a, b) => b.score - a.score)[0]?.el || null;
    const submitCandidates = queryAll('button[type="submit"], input[type="submit"], button:not([type]), button', form || document);
    const submitButton = submitCandidates[0] || null;
    const usernameSelector = selectorFor(usernameInput, [
      'input[name="username"]',
      'input[type="email"]',
      'input[name*="user" i]',
      'input[name*="email" i]',
      'input[type="text"]'
    ]);
    const passwordSelector = selectorFor(passwordInput, ['input[type="password"]']);
    const submitSelector = selectorFor(submitButton, ['button[type="submit"]', 'input[type="submit"]', 'button']);
    ${MANUAL_CHALLENGE_DETECTOR_JS}
    const challenge = detectManualChallenge();
    ${SSO_CHALLENGE_DETECTOR_JS}
    const ssoChallenge = detectSsoChallenge();
    const mfaInputs = queryAll('input[name*="otp" i], input[name*="totp" i], input[name*="mfa" i], input[name*="code" i], input[autocomplete="one-time-code"]');
    const bodyText = String(document.body?.innerText || "");
    return {
      url: location.href,
      origin: location.origin,
      pathname: location.pathname,
      title: document.title,
      ready_state: document.readyState,
      username_selector: usernameSelector,
      password_selector: passwordSelector,
      submit_selector: submitSelector,
      password_input_count: passwordInputs.length,
      username_like_input_count: formInputs.length,
      form_detected: Boolean(form),
      ...challenge,
      mfa_detected: mfaInputs.length > 0 || /\\b(otp|totp|mfa|two[- ]?factor|verification code|authenticator)\\b/i.test(bodyText),
      mfa_input_count: mfaInputs.length,
      ...ssoChallenge
    };
  `, {}, options);
  return {
    ...result.value,
    transport: result.transport,
    transport_attempts: result.transport_attempts,
    page: result.page,
  };
}

function makeSuggestedProfile(pageState, args = {}) {
  const origin = normalizeOrigin(args?.origin || pageState.origin);
  const requestedProfileId = String(args?.profile_id ?? "").trim();
  const profileId = requestedProfileId && requestedProfileId !== "auto"
    ? sanitizeProfileId(requestedProfileId)
    : profileIdFromOrigin(origin);
  const loginPath = normalizePathPattern(args?.login_path_pattern || pageState.pathname || "/login") || "/login";
  const profile = normalizeProfile({
    profile_id: profileId,
    source: "suggested_profile",
    source_path: "",
    allowed_origins: [origin],
    username: "",
    password: "",
    login_path_patterns: [loginPath],
    username_selector: args?.username_selector || pageState.username_selector || "#username",
    password_selector: args?.password_selector || pageState.password_selector || "#password",
    submit_selector: args?.submit_selector || pageState.submit_selector || "button[type=\"submit\"]",
    success_path_not: [loginPath],
    success_text: args?.success_text || "",
  });
  const confidence = profile.password_selector && profile.submit_selector
    ? (profile.username_selector ? "high" : "medium")
    : "low";
  return {
    profile,
    confidence,
  };
}

export {
  detectLoginFromUrl,
  detectLoginPage,
  executeBrowserScript,
  inspectCurrentPage,
  makeSuggestedProfile,
  manualRequirementFields,
  manualRequirementFromPageState,
  parseUrlState,
  publicAuthSurfaceFields,
  publicChallengeFields,
  suggestProfileFromCurrentPage,
};
