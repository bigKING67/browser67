import { normalizeTimeoutMs } from "../common.mjs";
import { executeBrowserScript } from "./login-detect.mjs";

const DEFAULT_LOGIN_TIMEOUT_MS = 12_000;

async function submitLoginForm(args, profile) {
  const timeoutMs = normalizeTimeoutMs(args?.timeout_ms ?? DEFAULT_LOGIN_TIMEOUT_MS);
  const result = await executeBrowserScript(args, `
    const profile = input.profile;
    const timeoutMs = input.timeout_ms;
    const missingSelectors = [];
    const query = (selector) => {
      if (!selector) return null;
      try {
        return document.querySelector(selector);
      } catch {
        return null;
      }
    };
    const usernameInput = query(profile.username_selector);
    const passwordInput = query(profile.password_selector);
    const submitButton = query(profile.submit_selector);
    if (!usernameInput) missingSelectors.push(profile.username_selector);
    if (!passwordInput) missingSelectors.push(profile.password_selector);
    if (!submitButton) missingSelectors.push(profile.submit_selector);
    const pathMatches = (pathname, pattern) => {
      if (!pattern) return false;
      const normalizedPattern = pattern.startsWith("/") ? pattern : "/" + pattern;
      return pathname === normalizedPattern || pathname.startsWith(normalizedPattern + "/");
    };
    const successPathNot = Array.isArray(profile.success_path_not) ? profile.success_path_not : [];
    const isStillBlockedPath = () => successPathNot.some((pattern) => pathMatches(location.pathname, pattern));
    const detectManualRequirement = () => {
      const bodyText = String(document.body?.innerText || "");
      const captchaDetected = Boolean(document.querySelector('[class*="captcha" i], [id*="captcha" i], iframe[src*="captcha" i], iframe[src*="recaptcha" i]'));
      const mfaInputs = Array.from(document.querySelectorAll('input[name*="otp" i], input[name*="totp" i], input[name*="mfa" i], input[name*="code" i], input[autocomplete="one-time-code"]'));
      const ssoElements = Array.from(document.querySelectorAll('a, button')).filter((el) => /sso|single sign|google|github|microsoft|okta|saml|oauth/i.test(String(el.textContent || "")));
      const ssoDetected = ssoElements.length > 0;
      const oauthPopupDetected = ssoElements.some((el) => {
        const haystack = [
          el.textContent,
          el.getAttribute("href"),
          el.getAttribute("target"),
          el.getAttribute("data-oauth-popup"),
          el.getAttribute("aria-label")
        ].filter(Boolean).join(" ");
        return /oauth|popup|_blank/i.test(haystack);
      });
      const mfaDetected = mfaInputs.length > 0 || /\\b(otp|totp|mfa|two[- ]?factor|verification code|authenticator)\\b/i.test(bodyText);
      return {
        captcha_detected: captchaDetected,
        mfa_detected: mfaDetected,
        mfa_input_count: mfaInputs.length,
        sso_detected: ssoDetected,
        oauth_popup_detected: oauthPopupDetected,
        manual_required_reason: captchaDetected
          ? "manual_required_captcha"
          : (mfaDetected ? "manual_required_mfa" : (ssoDetected && !document.querySelector('input[type="password"]') ? "manual_required_sso" : ""))
      };
    };
    let successTextMatched = profile.success_text ? String(document.body?.innerText || "").includes(profile.success_text) : true;
    const refreshSuccessText = () => {
      successTextMatched = profile.success_text ? String(document.body?.innerText || "").includes(profile.success_text) : true;
      return successTextMatched;
    };
    const waitForAuthReady = async (started) => {
      refreshSuccessText();
      if (!isStillBlockedPath() && successTextMatched) {
        return;
      }
      if (Date.now() - started >= timeoutMs) {
        return;
      }
      await new Promise((resolve) => setTimeout(resolve, 250));
      return waitForAuthReady(started);
    };
    if ((!usernameInput || !passwordInput) && !isStillBlockedPath()) {
      const started = Date.now();
      await waitForAuthReady(started);
      const blockedPath = isStillBlockedPath();
      refreshSuccessText();
      const manualRequirement = detectManualRequirement();
      return {
        ok: !blockedPath && successTextMatched && !manualRequirement.manual_required_reason,
        reason: manualRequirement.manual_required_reason || (!blockedPath && successTextMatched ? "already_authenticated" : "authenticated_state_not_confirmed"),
        submitted: false,
        waited_ms: Date.now() - started,
        final_url: location.href,
        final_origin: location.origin,
        final_path: location.pathname,
        title: document.title,
        blocked_path: blockedPath,
        success_text_matched: successTextMatched,
        ...manualRequirement,
        missing_selectors: missingSelectors.filter(Boolean)
      };
    }
    if (!usernameInput || !passwordInput) {
      return {
        ok: false,
        reason: "login_selector_not_found",
        missing_selectors: missingSelectors.filter(Boolean),
        final_url: location.href,
        final_path: location.pathname
      };
    }
    const setValue = (el, value) => {
      const proto = el instanceof HTMLTextAreaElement
        ? HTMLTextAreaElement.prototype
        : HTMLInputElement.prototype;
      const descriptor = Object.getOwnPropertyDescriptor(proto, "value");
      if (descriptor?.set) {
        descriptor.set.call(el, value);
      } else {
        el.value = value;
      }
      for (const type of ["input", "change"]) {
        el.dispatchEvent(new Event(type, { bubbles: true }));
      }
    };
    setValue(usernameInput, profile.username);
    setValue(passwordInput, profile.password);
    const form = usernameInput.closest("form") || passwordInput.closest("form") || submitButton?.closest("form") || document.querySelector("form");
    let submit_method = "none";
    if (form && typeof form.requestSubmit === "function") {
      if (submitButton instanceof HTMLElement && form.contains(submitButton)) {
        form.requestSubmit(submitButton);
      } else {
        form.requestSubmit();
      }
      submit_method = "form.requestSubmit";
    } else if (submitButton instanceof HTMLElement) {
      submitButton.click();
      submit_method = "button.click";
    } else {
      return {
        ok: false,
        reason: "login_submit_not_found",
        missing_selectors: missingSelectors.filter(Boolean),
        final_url: location.href,
        final_path: location.pathname
      };
    }
    const started = Date.now();
    successTextMatched = profile.success_text ? false : true;
    await waitForAuthReady(started);
    const blockedPath = isStillBlockedPath();
    refreshSuccessText();
    const manualRequirement = detectManualRequirement();
    return {
      ok: !blockedPath && successTextMatched && !manualRequirement.manual_required_reason,
      reason: manualRequirement.manual_required_reason || (!blockedPath && successTextMatched ? "logged_in" : "login_not_completed"),
      submitted: true,
      submit_method,
      waited_ms: Date.now() - started,
      final_url: location.href,
      final_origin: location.origin,
      final_path: location.pathname,
      title: document.title,
      blocked_path: blockedPath,
      success_text_matched: successTextMatched,
      ...manualRequirement,
      missing_selectors: missingSelectors.filter(Boolean)
    };
  `, {
    timeout_ms: timeoutMs,
    profile: {
      profile_id: profile.profile_id,
      username_selector: profile.username_selector,
      password_selector: profile.password_selector,
      submit_selector: profile.submit_selector,
      username: profile.username,
      password: profile.password,
      success_path_not: profile.success_path_not,
      success_text: profile.success_text,
    },
  });
  return {
    transport: result.transport,
    transport_attempts: result.transport_attempts,
    page: result.page,
    result: result.value,
  };
}

export {
  submitLoginForm,
};
