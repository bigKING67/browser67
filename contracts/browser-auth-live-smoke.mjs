#!/usr/bin/env node

import { createAuthLiveContext, initializeMcp } from "./browser-auth-live-smoke/context.mjs";
import { runCaptchaCase } from "./browser-auth-live-smoke/captcha-case.mjs";
import { runFinalizerCase } from "./browser-auth-live-smoke/finalizer-case.mjs";
import { runManualRequiredCases } from "./browser-auth-live-smoke/manual-required-cases.mjs";
import { runProfileLoginCase } from "./browser-auth-live-smoke/profile-login-case.mjs";
import { runUnknownOriginCase } from "./browser-auth-live-smoke/unknown-origin-case.mjs";
import { parseArgs } from "./browser-auth-live-smoke/helpers.mjs";

async function run() {
  const cli = parseArgs(process.argv.slice(2));
  const context = await createAuthLiveContext(cli);
  try {
    await initializeMcp(context);
    const unknown = await runUnknownOriginCase(context);
    const profile = await runProfileLoginCase(context);
    const captcha = await runCaptchaCase(context);
    const manual = await runManualRequiredCases(context);
    const finalize = await runFinalizerCase(context, {
      managedTabId: profile.managedTabId,
      captchaTabId: captcha.captchaTabId,
      mfaTabId: manual.mfaTabId,
      oauthTabId: manual.oauthTabId,
      ssoTabId: manual.ssoTabId,
      additionalTabIds: manual.additionalTabIds,
    });

    return {
      ok: true,
      auth_status: profile.auth.status,
      auth_reason: profile.auth.reason,
      submitted: profile.auth.submitted,
      final_path: profile.auth.final_path,
      suggested_profile: profile.suggested.profile?.profile_id,
      upsert_created: profile.upserted.created,
      already_authenticated: profile.alreadyAuthenticated.already_authenticated,
      lifecycle_metadata_updated: profile.liveProfileAfterAuth?.lifecycle?.last_status === "success",
      manual_required_captcha: captcha.captchaBlocked.reason === "manual_required_captcha",
      manual_required_captcha_kind: captcha.captchaBlocked.captcha_kind,
      captcha_assist_planned: captcha.captchaPlan.status === "planned",
      captcha_assist_confirm_required: captcha.captchaAssistNeedsConfirm.reason === "confirm_physical_input_required",
      captcha_resume_success: captcha.captchaResume.status === "success",
      captcha_resume_reason: captcha.captchaResume.reason,
      captcha_submissions: context.fixture.state.captcha_submissions,
      manual_required_mfa: manual.mfaBlocked.reason === "manual_required_mfa",
      mfa_resume_success: manual.mfaResume.status === "success"
        && manual.mfaResume.already_authenticated === true
        && manual.mfaResume.submitted === false,
      manual_required_sso: manual.ssoBlocked.reason === "manual_required_sso",
      sso_resume_success: manual.ssoResume.status === "success"
        && manual.ssoResume.already_authenticated === true
        && manual.ssoResume.submitted === false,
      manual_required_oauth_popup: manual.oauthBlocked.manual_context?.kind === "oauth_popup",
      oauth_popup_resume_success: manual.oauthResume.status === "success"
        && manual.oauthResume.already_authenticated === true
        && manual.oauthResume.submitted === false,
      role_button_sso_detected: manual.roleButtonBlocked.sso_detected === true,
      authenticated_sso_noise_ignored: manual.authenticatedNoise.authenticated_surface_detected === true
        && manual.authenticatedNoise.sso_detected === false,
      delayed_popup_detected: manual.delayedPopupDetected.newTabs?.length > 0,
      login_submissions: context.fixture.state.login_submissions,
      successful_logins: context.fixture.state.successful_logins,
      unknown_origin_blocked: unknown.unknownDryRun.status === "blocked",
      secrets_redacted: true,
      finalized_closed: finalize.close_unkept.closed.length,
    };
  } finally {
    await context.close();
  }
}

try {
  const result = await run();
  process.stdout.write(`${JSON.stringify(result)}\n`);
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`browser-auth-live-smoke failed: ${message}\n`);
  if (error instanceof Error && error.stack) {
    process.stderr.write(`${error.stack}\n`);
  }
  process.stdout.write(`${JSON.stringify({ ok: false, error: message })}\n`);
  process.exitCode = 1;
}
