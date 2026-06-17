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
  return {
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
