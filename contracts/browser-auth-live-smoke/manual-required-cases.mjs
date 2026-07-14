import assert from "node:assert/strict";

import {
  FIXTURE_PASSWORD,
  FIXTURE_USERNAME,
} from "./fixture.mjs";
import { assertNoSecretLeak, commonArgs, waitFor } from "./helpers.mjs";

async function runManualRequiredCases(context) {
  const mfa = await runMfaCase(context);
  const sso = await runSsoCase(context);
  const oauth = await runOauthPopupCase(context);
  const detection = await runAuthDetectionCoverage(context);
  const delayedPopup = await runDelayedPopupCase(context);
  return {
    additionalTabIds: [...detection.tabIds, delayedPopup.parentTabId],
    authenticatedNoise: detection.authenticatedNoise,
    continuationBlocked: detection.continuationBlocked,
    delayedPopupDetected: delayedPopup.detected,
    roleButtonBlocked: detection.roleButtonBlocked,
    mfaBlocked: mfa.mfaBlocked,
    mfaResume: mfa.mfaResume,
    mfaTabId: mfa.mfaTabId,
    oauthBlocked: oauth.oauthBlocked,
    oauthResume: oauth.oauthResume,
    oauthTabId: oauth.oauthTabId,
    ssoBlocked: sso.ssoBlocked,
    ssoResume: sso.ssoResume,
    ssoTabId: sso.ssoTabId,
  };
}

async function createManagedTab({ callTool, cli, fixture, workspaceKey }, path) {
  const managed = await callTool("browser_tab_lifecycle", {
    ...commonArgs(cli),
    action: "select_or_create",
    url: `${fixture.origin}${path}`,
    workspace_key: workspaceKey,
    fresh: true,
    active: false,
    wait_until: "listed",
    wait_timeout_ms: 5_000,
    wait_poll_ms: 100,
  });
  const tabId = String(managed?.managed_tab?.tab_id ?? "");
  assert.ok(tabId, `${path} managed tab did not return tab id`);
  return tabId;
}

async function runAuthDetectionCoverage(context) {
  const { callTool, cli, workspaceKey } = context;
  const tabIds = [];

  const roleButtonTabId = await createManagedTab(context, "/sso-role-button");
  tabIds.push(roleButtonTabId);
  const roleButtonBlocked = await callTool("browser_auth_ops", {
    ...commonArgs(cli),
    action: "ensure_login",
    tab_id: roleButtonTabId,
    workspace_key: workspaceKey,
  });
  assert.equal(roleButtonBlocked.reason, "manual_required_sso");
  assert.equal(roleButtonBlocked.sso_detected, true);
  assert.equal(roleButtonBlocked.oauth_popup_detected, false);
  assert.equal(roleButtonBlocked.manual_context?.kind, "sso");

  const continuationTabId = await createManagedTab(context, "/confirm-existing-account");
  tabIds.push(continuationTabId);
  const continuationBlocked = await callTool("browser_auth_ops", {
    ...commonArgs(cli),
    action: "ensure_login",
    tab_id: continuationTabId,
    workspace_key: workspaceKey,
  });
  assert.equal(continuationBlocked.status, "blocked");
  assert.equal(continuationBlocked.reason, "manual_required_sso");
  assert.equal(continuationBlocked.auth_continuation_detected, true);
  assert.equal(continuationBlocked.sso_detected, true);
  assert.equal(continuationBlocked.oauth_popup_detected, false);
  assert.equal(continuationBlocked.manual_context?.kind, "sso");

  const authorizationTabId = await createManagedTab(context, "/i/oauth2/authorize");
  tabIds.push(authorizationTabId);
  const authorizationBlocked = await callTool("browser_auth_ops", {
    ...commonArgs(cli),
    action: "ensure_login",
    tab_id: authorizationTabId,
    workspace_key: workspaceKey,
  });
  assert.equal(authorizationBlocked.status, "blocked");
  assert.equal(authorizationBlocked.reason, "manual_required_sso");
  assert.equal(authorizationBlocked.auth_continuation_detected, true);
  assert.equal(authorizationBlocked.oauth_popup_detected, false);
  assert.equal(authorizationBlocked.manual_context?.kind, "sso");

  const authenticatedTabId = await createManagedTab(context, "/authenticated-sso-noise");
  tabIds.push(authenticatedTabId);
  const authenticatedInspection = await callTool("browser_auth_ops", {
    ...commonArgs(cli),
    action: "inspect_login_page",
    tab_id: authenticatedTabId,
    workspace_key: workspaceKey,
  });
  assert.equal(authenticatedInspection.authenticated_surface_detected, true);
  assert.equal(authenticatedInspection.auth_continuation_detected, false);
  assert.equal(authenticatedInspection.sso_detected, false);
  assert.equal(authenticatedInspection.oauth_popup_detected, false);
  assert.equal(authenticatedInspection.manual_required, undefined);
  assert.equal(authenticatedInspection.manual_required_reason, undefined);

  const authenticatedNoise = await callTool("browser_auth_ops", {
    ...commonArgs(cli),
    action: "ensure_login",
    tab_id: authenticatedTabId,
    workspace_key: workspaceKey,
  });
  assert.equal(authenticatedNoise.status, "success");
  assert.equal(authenticatedNoise.already_authenticated, true);
  assert.equal(authenticatedNoise.authenticated_surface_detected, true);
  assert.equal(authenticatedNoise.sso_detected, false);
  assertNoSecretLeak(authenticatedNoise, "authenticated sso-noise result");

  return {
    authenticatedNoise,
    continuationBlocked,
    roleButtonBlocked,
    tabIds,
  };
}

async function runDelayedPopupCase(context) {
  const { callTool, cli, fixture, workspaceKey } = context;
  const parentTabId = await createManagedTab(context, "/delayed-popup-parent");
  await callTool("browser_auth_ops", {
    ...commonArgs(cli),
    action: "inspect_login_page",
    tab_id: parentTabId,
    workspace_key: workspaceKey,
  });
  const delayedCreate = (async () => {
    await new Promise((resolve) => setTimeout(resolve, 300));
    return callTool("browser_execute_js", {
      ...commonArgs(cli),
      tab_id: parentTabId,
      no_monitor: true,
      script: JSON.stringify({
        cmd: "tabs",
        method: "create",
        url: `${fixture.origin}/delayed-popup-child`,
        active: false,
      }),
    });
  })();
  const [detected, created] = await Promise.all([
    callTool("browser_execute_js", {
      ...commonArgs(cli),
      tab_id: parentTabId,
      script: `return await (async () => {
        document.querySelector("#popup-trigger").click();
        return { monitoring: true };
      })();`,
    }),
    delayedCreate,
  ]);
  assert.equal(created.status, "success");
  assert.equal(created.new_tab_wait_ms, 0, "no_monitor should disable new-target polling");
  assert.equal(detected.status, "success");
  assert.equal(detected.js_return?.monitoring, true);
  const popup = detected.newTabs?.find((tab) => String(tab?.url ?? "").includes("/delayed-popup-child"));
  assert.ok(popup?.id, `delayed popup was not detected: ${JSON.stringify(detected.newTabs)}`);
  assert.equal(detected.new_tab_wait_ms, 1_500);
  assert.ok(Number(detected.new_tab_waited_ms) > 0, "delayed popup detection should poll for the new target");

  const closed = await callTool("browser_execute_js", {
    ...commonArgs(cli),
    tab_id: parentTabId,
    no_monitor: true,
    script: JSON.stringify({
      cmd: "tabs",
      method: "close",
      tabId: String(popup.id),
    }),
  });
  assert.equal(closed.status, "success");
  assert.equal(closed.js_return?.closed, true, "delayed popup tab should be closed after the contract probe");

  return {
    detected,
    parentTabId,
  };
}

async function runMfaCase({ callTool, cli, fixture, workspaceKey }) {
  const mfaProfile = await callTool("browser_auth_ops", {
    ...commonArgs(cli),
    action: "upsert_profile",
    profile_id: "fixture-mfa",
    origin: fixture.origin,
    username: FIXTURE_USERNAME,
    password: FIXTURE_PASSWORD,
    login_path_pattern: "/mfa-login",
    username_selector: "#mfa-username",
    password_selector: "#mfa-password",
    submit_selector: "button[type=\"submit\"]",
    success_path_not: "/mfa-login",
    confirm_write: true,
  });
  assert.equal(mfaProfile.status, "success");
  assertNoSecretLeak(mfaProfile, "mfa upsert result");

  const mfaManaged = await callTool("browser_tab_lifecycle", {
    ...commonArgs(cli),
    action: "select_or_create",
    url: `${fixture.origin}/mfa-login`,
    workspace_key: workspaceKey,
    fresh: true,
    active: false,
    wait_until: "listed",
    wait_timeout_ms: 5_000,
    wait_poll_ms: 100,
  });
  const mfaTabId = String(mfaManaged?.managed_tab?.tab_id ?? "");
  assert.ok(mfaTabId, "mfa managed tab did not return tab id");
  const mfaBlocked = await callTool("browser_auth_ops", {
    ...commonArgs(cli),
    action: "ensure_login",
    profile_id: "fixture-mfa",
    tab_id: mfaTabId,
    workspace_key: workspaceKey,
  });
  assert.equal(mfaBlocked.status, "blocked", "mfa page should require manual intervention");
  assert.equal(mfaBlocked.reason, "manual_required_mfa");
  assert.equal(mfaBlocked.submitted, false, "mfa page should block before submit");
  assert.equal(mfaBlocked.manual_required, true);
  assert.equal(mfaBlocked.manual_context?.kind, "mfa");
  assert.equal(mfaBlocked.manual_context?.tab_id, mfaTabId);
  assert.equal(mfaBlocked.manual_context?.workspace_key, workspaceKey);
  assert.equal(mfaBlocked.manual_context?.resume_action, "ensure_login");
  assert.equal(fixture.state.mfa_submissions, 0, "mfa block should not submit credentials");
  assertNoSecretLeak(mfaBlocked, "mfa block result");
  const mfaResume = await completeManualAuthAndResume({
    callTool,
    cli,
    tabId: mfaTabId,
    workspaceKey,
    label: "mfa",
    completePath: "/mfa-complete",
    completeMethod: "POST",
    profile_id: "fixture-mfa",
  });
  assert.equal(fixture.state.mfa_completed, true, "mfa manual completion should update fixture state");
  assert.equal(fixture.state.mfa_submissions, 0, "mfa resume should not submit credentials after manual completion");
  return {
    mfaBlocked,
    mfaProfile,
    mfaResume,
    mfaTabId,
  };
}

async function runSsoCase({ callTool, cli, fixture, workspaceKey }) {
  const ssoManaged = await callTool("browser_tab_lifecycle", {
    ...commonArgs(cli),
    action: "select_or_create",
    url: `${fixture.origin}/sso-login`,
    workspace_key: workspaceKey,
    fresh: true,
    active: false,
    wait_until: "listed",
    wait_timeout_ms: 5_000,
    wait_poll_ms: 100,
  });
  const ssoTabId = String(ssoManaged?.managed_tab?.tab_id ?? "");
  assert.ok(ssoTabId, "sso managed tab did not return tab id");
  const ssoBlocked = await callTool("browser_auth_ops", {
    ...commonArgs(cli),
    action: "ensure_login",
    tab_id: ssoTabId,
    workspace_key: workspaceKey,
  });
  assert.equal(ssoBlocked.status, "blocked", "sso-only page should require manual intervention");
  assert.equal(ssoBlocked.reason, "manual_required_sso");
  assert.equal(ssoBlocked.submitted, false);
  assert.equal(ssoBlocked.manual_required, true);
  assert.equal(ssoBlocked.manual_context?.kind, "sso");
  assert.equal(ssoBlocked.manual_context?.tab_id, ssoTabId);
  assert.equal(ssoBlocked.manual_context?.workspace_key, workspaceKey);
  assert.equal(ssoBlocked.manual_context?.resume_action, "ensure_login");
  assert.equal(fixture.state.sso_submissions, 0, "sso block should not submit credentials");
  assertNoSecretLeak(ssoBlocked, "sso block result");
  const ssoResume = await completeManualAuthAndResume({
    callTool,
    cli,
    tabId: ssoTabId,
    workspaceKey,
    label: "sso",
    completePath: "/sso-complete",
    completeMethod: "POST",
  });
  assert.equal(fixture.state.sso_completed, true, "sso manual completion should update fixture state");
  assert.equal(fixture.state.sso_submissions, 0, "sso resume should not submit credentials after manual completion");
  return {
    ssoBlocked,
    ssoResume,
    ssoTabId,
  };
}

async function runOauthPopupCase({ callTool, cli, fixture, workspaceKey }) {
  const oauthManaged = await callTool("browser_tab_lifecycle", {
    ...commonArgs(cli),
    action: "select_or_create",
    url: `${fixture.origin}/oauth-login`,
    workspace_key: workspaceKey,
    fresh: true,
    active: false,
    wait_until: "listed",
    wait_timeout_ms: 5_000,
    wait_poll_ms: 100,
  });
  const oauthTabId = String(oauthManaged?.managed_tab?.tab_id ?? "");
  assert.ok(oauthTabId, "oauth managed tab did not return tab id");
  const oauthBlocked = await callTool("browser_auth_ops", {
    ...commonArgs(cli),
    action: "ensure_login",
    tab_id: oauthTabId,
    workspace_key: workspaceKey,
  });
  assert.equal(oauthBlocked.status, "blocked", "oauth popup page should require manual intervention");
  assert.equal(oauthBlocked.reason, "manual_required_sso");
  assert.equal(oauthBlocked.submitted, false);
  assert.equal(oauthBlocked.manual_required, true);
  assert.equal(oauthBlocked.manual_context?.kind, "oauth_popup");
  assert.equal(oauthBlocked.manual_context?.tab_id, oauthTabId);
  assert.equal(oauthBlocked.manual_context?.workspace_key, workspaceKey);
  assert.equal(oauthBlocked.manual_context?.resume_action, "ensure_login");
  assertNoSecretLeak(oauthBlocked, "oauth block result");
  const oauthResume = await completeManualAuthAndResume({
    callTool,
    cli,
    tabId: oauthTabId,
    workspaceKey,
    label: "oauth popup",
    completePath: "/oauth-callback",
    completeMethod: "GET",
  });
  assert.equal(fixture.state.oauth_completed, true, "oauth manual completion should update fixture state");
  return {
    oauthBlocked,
    oauthResume,
    oauthTabId,
  };
}

async function completeManualAuthAndResume({
  callTool,
  cli,
  tabId,
  workspaceKey,
  label,
  completePath,
  completeMethod,
  profile_id,
}) {
  const completed = await callTool("browser_execute_js", {
    ...commonArgs(cli),
    tab_id: tabId,
    script: `return await (async () => {
      const completedResponse = await fetch(${JSON.stringify(completePath)}, {
        method: ${JSON.stringify(completeMethod)},
        cache: "no-store",
        credentials: "same-origin",
        redirect: "follow"
      });
      const protectedResponse = await fetch("/protected", {
        cache: "no-store",
        credentials: "same-origin"
      });
      const html = await protectedResponse.text();
      document.open();
      document.write(html);
      document.close();
      history.replaceState({}, "", "/protected");
      return {
        completed_ok: completedResponse.ok,
        protected_ok: protectedResponse.ok,
        path: location.pathname,
        title: document.title
      };
    })();`,
  });
  assert.equal(
    completed?.js_return?.completed_ok,
    true,
    `${label} manual completion endpoint should succeed`,
  );
  assert.equal(
    completed?.js_return?.protected_ok,
    true,
    `${label} manual completion should unlock protected page`,
  );
  assert.equal(completed?.js_return?.path, "/protected");

  const resumeWait = await waitFor(async () => {
    const resumed = await callTool("browser_auth_ops", {
      ...commonArgs(cli),
      action: "ensure_login",
      ...(profile_id ? { profile_id } : {}),
      tab_id: tabId,
      workspace_key: workspaceKey,
    });
    return {
      ok: resumed.status === "success"
        && resumed.already_authenticated === true
        && resumed.submitted === false
        && resumed.pathname === "/protected",
      resumed,
    };
  }, 5_000);
  assert.equal(
    resumeWait.ok,
    true,
    `${label} ensure_login should resume after manual completion: ${JSON.stringify(resumeWait.resumed)}`,
  );
  assertNoSecretLeak(resumeWait.resumed, `${label} resume result`);
  return resumeWait.resumed;
}

export {
  runManualRequiredCases,
};
