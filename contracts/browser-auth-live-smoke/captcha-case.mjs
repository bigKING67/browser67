import assert from "node:assert/strict";

import {
  FIXTURE_PASSWORD,
  FIXTURE_USERNAME,
} from "./fixture.mjs";
import {
  assertNoSecretLeak,
  commonArgs,
  waitFor,
} from "./helpers.mjs";

async function runCaptchaCase(context) {
  const { callTool, cli, fixture, workspaceKey } = context;
  const captchaProfile = await callTool("browser_auth_ops", {
    ...commonArgs(cli),
    action: "upsert_profile",
    profile_id: "fixture-captcha",
    origin: fixture.origin,
    username: FIXTURE_USERNAME,
    password: FIXTURE_PASSWORD,
    login_path_pattern: "/captcha-login",
    username_selector: "#captcha-username",
    password_selector: "#captcha-password",
    submit_selector: "button[type=\"submit\"]",
    success_path_not: "/captcha-login",
    confirm_write: true,
  });
  assert.equal(captchaProfile.status, "success");
  assertNoSecretLeak(captchaProfile, "captcha upsert result");

  const captchaManaged = await callTool("browser_tab_lifecycle", {
    ...commonArgs(cli),
    action: "select_or_create",
    url: `${fixture.origin}/captcha-login`,
    workspace_key: workspaceKey,
    fresh: true,
    active: false,
    wait_until: "listed",
    wait_timeout_ms: 5_000,
    wait_poll_ms: 100,
  });
  const captchaTabId = String(captchaManaged?.managed_tab?.tab_id ?? "");
  assert.ok(captchaTabId, "captcha managed tab did not return tab id");
  await clearCaptchaCookie(context, captchaTabId);
  const captchaBlocked = await assertCaptchaBlocked(context, captchaTabId);
  const captchaPlan = await assertCaptchaPlan(context, captchaTabId);
  const captchaAssistNeedsConfirm = await assertCaptchaAssistRequiresConfirmation(context, captchaTabId);
  const captchaResume = await completeAndResumeCaptcha(context, captchaTabId);

  return {
    captchaAssistNeedsConfirm,
    captchaBlocked,
    captchaPlan,
    captchaProfile,
    captchaResume,
    captchaTabId,
  };
}

async function clearCaptchaCookie({ callTool, cli, fixture }, captchaTabId) {
  const captchaCookieClear = await waitFor(async () => {
    try {
      const cleared = await callTool("browser_execute_js", {
        ...commonArgs(cli),
        tab_id: captchaTabId,
        script: `return (() => { document.cookie = ${JSON.stringify(`${fixture.cookieName}=; Max-Age=0; Path=/; SameSite=Lax`)}; return { cookie_cleared: true }; })();`,
      });
      return {
        ok: cleared?.js_return?.cookie_cleared === true,
        cleared,
      };
    } catch (error) {
      return {
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }, 5_000);
  assert.equal(
    captchaCookieClear.ok,
    true,
    `captcha tab did not accept cookie clearing script: ${JSON.stringify(captchaCookieClear)}`,
  );
}

async function assertCaptchaBlocked(context, captchaTabId) {
  const { callTool, cli, fixture, workspaceKey } = context;
  const captchaBlocked = await callTool("browser_auth_ops", {
    ...commonArgs(cli),
    action: "ensure_login",
    profile_id: "fixture-captcha",
    tab_id: captchaTabId,
    workspace_key: workspaceKey,
  });
  assert.equal(captchaBlocked.status, "blocked", "captcha page should require manual intervention");
  assert.equal(captchaBlocked.reason, "manual_required_captcha");
  assert.equal(captchaBlocked.captcha_kind, "hcaptcha");
  assert.equal(captchaBlocked.submitted, false, "captcha page should block before submit");
  assert.equal(fixture.state.login_submissions, 1, "captcha block should not submit credentials");
  assert.equal(captchaBlocked.manual_required, true, "captcha block should expose manual_required");
  assert.equal(captchaBlocked.manual_context?.kind, "captcha");
  assert.equal(captchaBlocked.manual_context?.captcha_kind, "hcaptcha");
  assert.equal(captchaBlocked.manual_context?.captcha_assist?.assist_mode, "manual_or_native_physical");
  assert.equal(captchaBlocked.manual_context?.captcha_assist?.strategy_id, "captcha_router_v2");
  assert.equal(captchaBlocked.manual_context?.captcha_assist?.policy_id, "hybrid_policy_v1");
  assert.equal(captchaBlocked.manual_context?.captcha_assist?.retry_after_ms, 5_000);
  assert.equal(captchaBlocked.manual_context?.captcha_assist?.vision_policy?.fullscreen_screenshot_allowed, false);
  assert.equal(captchaBlocked.manual_context?.captcha_assist?.native_input_policy?.mode, "physical_mouse_keyboard");
  assert.equal(
    captchaBlocked.manual_context?.captcha_assist?.prohibited_operations?.includes("js_or_cdp_click_on_captcha"),
    true,
  );
  assert.equal(
    captchaBlocked.manual_context?.captcha_assist?.prohibited_operations?.includes("full_screen_screenshot"),
    true,
  );
  assert.equal(
    captchaBlocked.manual_context?.captcha_assist?.handoff_conditions?.includes("multi_round_image_or_puzzle"),
    true,
  );
  assert.equal(captchaBlocked.manual_context?.tab_id, captchaTabId);
  assert.equal(captchaBlocked.manual_context?.workspace_key, workspaceKey);
  assert.equal(captchaBlocked.manual_context?.resume_action, "ensure_login");
  assertNoSecretLeak(captchaBlocked, "captcha block result");
  return captchaBlocked;
}

async function assertCaptchaPlan({ callTool, cli, workspaceKey }, captchaTabId) {
  const captchaPlan = await callTool("browser_auth_ops", {
    ...commonArgs(cli),
    action: "plan_captcha_assist",
    tab_id: captchaTabId,
    workspace_key: workspaceKey,
  });
  assert.equal(captchaPlan.status, "planned", "captcha assist planner should produce a dry-run plan");
  assert.equal(captchaPlan.action, "plan_captcha_assist");
  assert.equal(captchaPlan.captcha_kind, "hcaptcha");
  assert.equal(captchaPlan.executed, false);
  assert.equal(captchaPlan.coordinate_support?.dom_client_rect_available, true);
  assert.equal(captchaPlan.coordinate_support?.viewport_coordinates_are_not_screen_coordinates, true);
  assert.equal(captchaPlan.coordinate_support?.native_window_rect_action, "browser_native_input.get_window_rect");
  assert.equal(captchaPlan.coordinate_support?.caller_supplied_screen_coordinates_supported, true);
  assert.equal(typeof captchaPlan.coordinate_support?.physical_click_supported, "boolean");
  assert.equal(typeof captchaPlan.physical_input?.provider_selection?.reason, "string");
  assert.equal(captchaPlan.physical_input?.capture_provider_selection?.action, "capture_window_region");
  assert.equal(typeof captchaPlan.physical_input?.capture_provider_selection?.reason, "string");
  assert.equal(captchaPlan.physical_input?.providers?.some((provider) => provider.provider_id === "native-os"), true);
  assert.equal(captchaPlan.physical_input?.providers?.some((provider) => provider.provider_id === "ljq-ctrl"), true);
  assert.equal(captchaPlan.coordinate_transform?.source_coordinate_system, "viewport_css_pixels");
  assert.equal(captchaPlan.coordinate_transform?.target_coordinate_system, "screen_pixels");
  assert.equal(captchaPlan.coordinate_transform?.safe_to_auto_execute_without_confirmation, false);
  assert.equal(captchaPlan.coordinate_transform?.vision_correction_plan?.fullscreen_allowed, false);
  assert.equal(captchaPlan.coordinate_transform?.vision_correction_plan?.correction_status, "not_run");
  assert.equal(typeof captchaPlan.coordinate_transform?.vision_correction_plan?.executable_region_capture_available, "boolean");
  assert.equal(typeof captchaPlan.coordinate_transform?.vision_correction_plan?.screenshot_clip?.x, "number");
  assert.equal(typeof captchaPlan.coordinate_transform?.screen_estimate?.click?.x, "number");
  assert.equal(captchaPlan.captcha_policy?.strategy_id, "captcha_router_v2");
  assert.equal(captchaPlan.captcha_policy?.protocol_solver_default_enabled, false);
  assert.equal(captchaPlan.captcha_router?.selected_route?.route_type, "physical_coordinate");
  assert.equal(captchaPlan.captcha_router?.protocol_block_reason, "protocol_solver_not_requested");
  assert.equal(Array.isArray(captchaPlan.captcha_providers), true);
  assert.equal(captchaPlan.captcha_providers?.some((provider) => provider.provider_id === "jfbym"), true);
  assert.equal(captchaPlan.captcha_assist?.prohibited_operations?.includes("js_or_cdp_click_on_captcha"), true);
  assert.equal(Array.isArray(captchaPlan.candidate_targets), true);
  assert.ok(captchaPlan.candidate_targets.length >= 1, "captcha planner should return at least one target candidate");
  assert.equal(typeof captchaPlan.target?.center_client?.x, "number");
  assert.equal(typeof captchaPlan.target?.center_client?.y, "number");
  assertNoSecretLeak(captchaPlan, "captcha assist plan result");
  return captchaPlan;
}

async function assertCaptchaAssistRequiresConfirmation({ callTool, cli, workspaceKey }, captchaTabId) {
  const captchaAssistNeedsConfirm = await callTool("browser_auth_ops", {
    ...commonArgs(cli),
    action: "assist_captcha",
    tab_id: captchaTabId,
    workspace_key: workspaceKey,
  });
  assert.equal(captchaAssistNeedsConfirm.status, "blocked");
  assert.equal(captchaAssistNeedsConfirm.reason, "confirm_physical_input_required");
  assert.equal(captchaAssistNeedsConfirm.executed, false);
  assertNoSecretLeak(captchaAssistNeedsConfirm, "captcha assist confirm result");
  return captchaAssistNeedsConfirm;
}

async function completeAndResumeCaptcha(context, captchaTabId) {
  const { callTool, cli, fixture, workspaceKey } = context;
  const captchaCompleted = await callTool("browser_execute_js", {
    ...commonArgs(cli),
    tab_id: captchaTabId,
    script: "return await fetch('/captcha-complete', { method: 'POST' }).then((response) => response.json());",
  });
  assert.equal(captchaCompleted?.js_return?.ok, true, "fixture captcha completion should succeed");
  const captchaReload = await callTool("browser_execute_js", {
    ...commonArgs(cli),
    tab_id: captchaTabId,
    script: "return await fetch('/captcha-login', { cache: 'no-store' }).then(async (response) => { const html = await response.text(); document.open(); document.write(html); document.close(); history.replaceState({}, '', '/captcha-login'); return { reloading: true, path: location.pathname }; });",
  });
  assert.equal(captchaReload?.js_return?.reloading, true);
  const captchaReadyAfterComplete = await waitFor(async () => {
    const inspected = await callTool("browser_auth_ops", {
      ...commonArgs(cli),
      action: "inspect_login_page",
      profile_id: "fixture-captcha",
      tab_id: captchaTabId,
    });
    return {
      ok: inspected.pathname === "/captcha-login"
        && inspected.login_detected === true
        && inspected.captcha_detected === false,
      inspected,
    };
  }, 5_000);
  assert.equal(
    captchaReadyAfterComplete.ok,
    true,
    `captcha page did not settle after manual completion: ${JSON.stringify(captchaReadyAfterComplete.inspected)}`,
  );
  const captchaResume = await callTool("browser_auth_ops", {
    ...commonArgs(cli),
    action: "ensure_login",
    profile_id: "fixture-captcha",
    tab_id: captchaTabId,
    workspace_key: workspaceKey,
  });
  assert.equal(
    captchaResume.status,
    "success",
    `ensure_login should resume after manual captcha completion: ${JSON.stringify(captchaResume)}`,
  );
  assert.equal(
    captchaResume.submitted === true || captchaResume.already_authenticated === true || captchaResume.reason === "already_authenticated",
    true,
    `captcha resume should submit or validate already-authenticated after challenge completion: ${JSON.stringify(captchaResume)}`,
  );
  assert.equal(captchaResume.final_path, "/protected");
  assert.equal(
    fixture.state.captcha_submissions === 1 || captchaResume.reason === "already_authenticated",
    true,
    "captcha resume should either submit once or validate an already-authenticated browser state",
  );
  assert.equal(fixture.state.successful_logins >= 1, true, "fixture should retain at least one successful login");
  assertNoSecretLeak(captchaResume, "captcha resume auth result");
  return captchaResume;
}

export {
  runCaptchaCase,
};
