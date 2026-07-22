import assert from "node:assert/strict";
import { stat } from "node:fs/promises";
import path from "node:path";

import {
  FIXTURE_PASSWORD,
  FIXTURE_USERNAME,
} from "./fixture.mjs";
import {
  assertNoSecretLeak,
  commonArgs,
  waitFor,
} from "./helpers.mjs";

async function runProfileLoginCase(context) {
  const { callTool, cli, fixture, profileDir, workspaceKey } = context;
  const managed = await callTool("browser_tab_lifecycle", {
    ...commonArgs(cli),
    action: "select_or_create",
    url: `${fixture.origin}/login?redirect=${encodeURIComponent("/protected")}`,
    workspace_key: workspaceKey,
    active: false,
    wait_until: "listed",
    wait_timeout_ms: 5_000,
    wait_poll_ms: 100,
  });
  const managedTabId = String(managed?.managed_tab?.tab_id ?? "");
  assert.ok(managedTabId, "managed lifecycle create did not return tab id");
  assert.equal(managed.created, true, "auth live smoke should create an isolated managed tab");

  const loginPage = await waitFor(async () => {
    const inspected = await callTool("browser_auth_ops", {
      ...commonArgs(cli),
      action: "inspect_login_page",
      tab_id: managedTabId,
    });
    return {
      ok: inspected.pathname === "/login"
        && inspected.login_detected === true
        && inspected.password_input_count === 1
        && inspected.username_like_input_count === 1,
      inspected,
    };
  }, 5_000);
  assert.equal(
    loginPage.ok,
    true,
    `managed tab did not settle on the login page: ${JSON.stringify(loginPage.inspected)}`,
  );
  assertNoSecretLeak(loginPage.inspected, "login page inspection result");

  const blockedWithoutProfile = await callTool("browser_auth_ops", {
    ...commonArgs(cli),
    action: "ensure_login",
    tab_id: managedTabId,
  });
  assert.equal(blockedWithoutProfile.status, "blocked", "login page without a profile should block");
  assert.equal(blockedWithoutProfile.reason, "no_matching_login_profile");
  assert.equal(blockedWithoutProfile.login_detected, true);
  assertNoSecretLeak(blockedWithoutProfile, "blocked auth result");

  const suggested = await callTool("browser_auth_ops", {
    ...commonArgs(cli),
    action: "suggest_profile",
    tab_id: managedTabId,
    profile_id: "fixture-live",
  });
  assert.equal(suggested.status, "success", "suggest_profile should inspect the live login page");
  assert.equal(suggested.profile?.profile_id, "fixture-live");
  assert.equal(suggested.profile?.allowed_origins?.[0], fixture.origin);
  assert.equal(suggested.profile?.username_selector, "#username");
  assert.equal(suggested.profile?.password_selector, "#password");
  assert.equal(suggested.profile?.has_username, false);
  assert.equal(suggested.profile?.has_password, false);
  assertNoSecretLeak(suggested, "suggest_profile result");

  const upserted = await callTool("browser_auth_ops", {
    ...commonArgs(cli),
    action: "upsert_profile",
    profile_id: "fixture-live",
    origin: fixture.origin,
    username: FIXTURE_USERNAME,
    password: FIXTURE_PASSWORD,
    login_path_pattern: "/login",
    username_selector: suggested.profile?.username_selector,
    password_selector: suggested.profile?.password_selector,
    submit_selector: suggested.profile?.submit_selector,
    success_path_not: "/login",
    success_text: "fixture secret page",
    confirm_write: true,
  });
  assert.equal(upserted.status, "success", "upsert_profile should save the fixture profile");
  assert.equal(upserted.created, true);
  assert.equal(upserted.updated, false);
  if (process.platform !== "win32") {
    assert.equal(upserted.profile?.file_mode, "600");
  }
  assert.equal(upserted.profile?.insecure_file_permissions, false);
  assertNoSecretLeak(upserted, "upsert_profile result");
  const fixtureProfileStat = await stat(path.join(profileDir, "fixture-live.env"));
  if (process.platform !== "win32") {
    assert.equal((fixtureProfileStat.mode & 0o777).toString(8).padStart(3, "0"), "600");
  } else {
    assert.equal(fixtureProfileStat.isFile(), true);
  }

  const auth = await callTool("browser_auth_ops", {
    ...commonArgs(cli),
    action: "ensure_login",
    tab_id: managedTabId,
  });
  assert.equal(
    auth.status,
    "success",
    `ensure_login should authenticate the fixture: ${JSON.stringify({ auth, fixture_state: fixture.state })}`,
  );
  assert.equal(auth.submitted, true, "ensure_login should submit the login form");
  assert.equal(auth.final_path, "/protected", "ensure_login should land on protected page");
  assert.equal(auth.success_text_matched, true, "ensure_login should observe protected page success text");
  assert.equal(fixture.state.login_submissions, 1, "fixture did not receive exactly one login submission");
  assert.equal(fixture.state.successful_logins, 1, "fixture did not receive exactly one successful login");
  assertNoSecretLeak(auth, "ensure_login result");

  const alreadyAuthenticated = await callTool("browser_auth_ops", {
    ...commonArgs(cli),
    action: "ensure_login",
    tab_id: managedTabId,
  });
  assert.equal(alreadyAuthenticated.status, "success", "already authenticated page should be accepted");
  assert.equal(alreadyAuthenticated.already_authenticated, true);
  assert.equal(alreadyAuthenticated.submitted, false);
  assert.equal(fixture.state.login_submissions, 1, "already authenticated ensure_login should not resubmit");
  assertNoSecretLeak(alreadyAuthenticated, "already authenticated result");

  const profilesAfterAuth = await callTool("browser_auth_ops", {
    ...commonArgs(cli),
    action: "list_profiles",
  });
  const liveProfileAfterAuth = profilesAfterAuth?.profiles?.find((entry) => entry?.profile_id === "fixture-live");
  assert.equal(liveProfileAfterAuth?.lifecycle?.last_status, "success", "successful auth should update lifecycle metadata");
  assert.equal(liveProfileAfterAuth?.lifecycle?.last_reason, "already_authenticated");
  assert.equal(typeof liveProfileAfterAuth?.lifecycle?.last_used_at, "string");
  assert.equal(typeof liveProfileAfterAuth?.lifecycle?.last_validated_at, "string");
  assertNoSecretLeak(profilesAfterAuth, "profile lifecycle result");

  return {
    alreadyAuthenticated,
    auth,
    blockedWithoutProfile,
    liveProfileAfterAuth,
    managedTabId,
    suggested,
    upserted,
  };
}

export {
  runProfileLoginCase,
};
