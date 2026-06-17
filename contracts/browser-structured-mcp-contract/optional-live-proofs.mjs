import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  buildOptionalLiveProofAudit,
  LOCAL_OPTIONAL_LIVE_PROOF_REQUIREMENTS,
  OPTIONAL_LIVE_PROOF_REQUIREMENTS,
  validateProof,
} from "../../scripts/optional-live-proof-audit.mjs";
import { buildOptionalLiveProofPlan } from "../../scripts/optional-live-proof-plan.mjs";
import { createProofTemplate } from "../../scripts/optional-live-proof-template.mjs";

function requirement(id) {
  const found = [
    ...LOCAL_OPTIONAL_LIVE_PROOF_REQUIREMENTS,
    ...OPTIONAL_LIVE_PROOF_REQUIREMENTS,
  ].find((item) => item.id === id);
  assert.ok(found, `missing optional live proof requirement: ${id}`);
  return found;
}

function validNativeProof(platform) {
  return {
    type: "native_live",
    ok: true,
    platform,
    provider_id: "native-os",
    actions: ["get_window_rect", "click", "drag"],
    checked_at: "2026-06-17T00:00:00.000Z",
    expires_at: "2099-06-17T00:00:00.000Z",
    command: "npm run check:captcha-assist-physical-live",
    evidence: {
      fixture: "local TMWD-owned managed tab",
      managed_tab_only: true,
      fullscreen_screenshot: false,
      secrets_redacted: true,
    },
  };
}

function validIdpProof(providerKind) {
  return {
    type: "idp_live",
    ok: true,
    provider_kind: providerKind,
    checked_at: "2026-06-17T00:00:00.000Z",
    expires_at: "2099-06-17T00:00:00.000Z",
    command: `npm run check:${providerKind}-live`,
    manual_required_verified: true,
    resume_verified: true,
    evidence: {
      approved_provider: "redacted test tenant",
      profile_scope: "repo-external exact-origin profile",
      secrets_redacted: true,
    },
  };
}

async function assertOptionalLiveProofContract() {
  const nativeLinux = requirement("native-live-linux");
  const nativeTemplate = createProofTemplate(nativeLinux, new Date("2026-06-17T00:00:00.000Z"));
  const nativeTemplateValidation = validateProof(nativeTemplate, nativeLinux);
  assert.equal(nativeTemplateValidation.ok, false);
  assert.ok(nativeTemplateValidation.errors.includes("requirement_match_failed"));
  assert.ok(nativeTemplateValidation.errors.includes("template_only_not_accepted"));

  const nativeValid = validateProof(validNativeProof("linux"), nativeLinux);
  assert.equal(nativeValid.ok, true, nativeValid.errors.join(","));

  const nativeMissingDrag = validateProof({
    ...validNativeProof("linux"),
    actions: ["click"],
  }, nativeLinux);
  assert.equal(nativeMissingDrag.ok, false);
  assert.ok(nativeMissingDrag.errors.includes("native_drag_action_required"));

  const nativeUnsafeEvidence = validateProof({
    ...validNativeProof("linux"),
    evidence: {
      fixture: "local TMWD-owned managed tab",
      managed_tab_only: false,
      fullscreen_screenshot: true,
      secrets_redacted: false,
    },
  }, nativeLinux);
  assert.equal(nativeUnsafeEvidence.ok, false);
  assert.ok(nativeUnsafeEvidence.errors.includes("native_managed_tab_only_must_be_true"));
  assert.ok(nativeUnsafeEvidence.errors.includes("native_fullscreen_screenshot_must_be_false"));
  assert.ok(nativeUnsafeEvidence.errors.includes("native_secrets_redacted_must_be_true"));

  const idpOauth = requirement("idp-oauth-popup");
  const idpValid = validateProof(validIdpProof("oauth_popup"), idpOauth);
  assert.equal(idpValid.ok, true, idpValid.errors.join(","));

  const idpPlaceholder = validateProof({
    ...validIdpProof("oauth_popup"),
    command: "replace with exact approved external live gate command",
  }, idpOauth);
  assert.equal(idpPlaceholder.ok, false);
  assert.ok(idpPlaceholder.errors.includes("placeholder_command_not_accepted"));

  const idpSensitive = validateProof({
    ...validIdpProof("oauth_popup"),
    evidence: {
      secrets_redacted: true,
      session_token: "redacted-but-key-is-forbidden",
    },
  }, idpOauth);
  assert.equal(idpSensitive.ok, false);
  assert.ok(idpSensitive.errors.some((error) => error.startsWith("sensitive_keys_present:")));

  const localCaptcha = requirement("captcha-assist-physical-local");
  const captchaUnsafeState = validateProof({
    type: "captcha_physical_live",
    ok: true,
    platform: process.platform,
    provider_id: "native-os",
    actions: ["drag"],
    checked_at: "2026-06-17T00:00:00.000Z",
    expires_at: "2099-06-17T00:00:00.000Z",
    command: "TMWD_CAPTCHA_ASSIST_PHYSICAL=1 TMWD_CAPTCHA_ASSIST_CONFIRM=1 npm run check:captcha-assist-physical-live",
    managed_tab_only: true,
    fixture: "local TMWD-owned managed tab",
    slider_completed: true,
    fullscreen_screenshot: false,
    js_cdp_widget_click: false,
    secrets_redacted: true,
    evidence: {
      browser_private_state_access: true,
    },
  }, localCaptcha);
  assert.equal(captchaUnsafeState.ok, false);
  assert.ok(captchaUnsafeState.errors.includes("browser_private_state_access_must_be_false"));

  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "tmwd-optional-proof-contract-"));
  try {
    await fs.writeFile(
      path.join(tmpDir, "native-live-linux.template.json"),
      `${JSON.stringify(nativeTemplate, null, 2)}\n`,
    );
    await fs.writeFile(
      path.join(tmpDir, "native-live-win32.json"),
      `${JSON.stringify(validNativeProof("win32"), null, 2)}\n`,
    );
    const audit = await buildOptionalLiveProofAudit({ proof_dir: tmpDir });
    const linux = audit.requirements.find((item) => item.id === "native-live-linux");
    assert.equal(linux?.satisfied, false);
    assert.equal(linux?.candidates?.length, 1);
    assert.ok(linux.candidates[0].validation.errors.includes("template_only_not_accepted"));
    const win32 = audit.requirements.find((item) => item.id === "native-live-win32");
    assert.equal(win32?.satisfied, true);

    const plan = await buildOptionalLiveProofPlan({ proof_dir: tmpDir });
    assert.equal(plan.action, "optional-live-proof-plan");
    assert.equal(plan.safe_defaults.includes("This plan does not move the mouse."), true);
    assert.equal(plan.safe_defaults.includes("This plan does not read browser private state."), true);
    const captchaPlan = plan.items.find((item) => item.id === "captcha-assist-physical-local");
    assert.ok(captchaPlan);
    assert.equal(captchaPlan.collection_mode, "local_gui_physical_gate");
    assert.equal(captchaPlan.commands.live_gate.includes("TMWD_CAPTCHA_ASSIST_PHYSICAL=1"), true);
    assert.equal(
      captchaPlan.safety_boundaries.includes("Do not use JS/CDP clicks on CAPTCHA widgets."),
      true,
    );
    const win32Plan = plan.items.find((item) => item.id === "native-live-win32");
    assert.equal(win32Plan?.satisfied, true);
    assert.equal(win32Plan?.proof_path?.endsWith("native-live-win32.json"), true);
    const linuxPlan = plan.items.find((item) => item.id === "native-live-linux");
    assert.equal(linuxPlan?.collection_mode, "cross_os_native_physical_gate");
    assert.equal(linuxPlan?.target_platform, "linux");
    assert.equal(linuxPlan?.commands.template, "npm run proof:optional-live-template -- --id native-live-linux --write");
    const idpPlan = plan.items.find((item) => item.id === "idp-oauth-popup");
    assert.equal(idpPlan?.status, "requires_approved_external_provider");
    assert.equal(idpPlan?.commands.local_fixture_baseline, "npm run check:auth-live");
    assert.equal(idpPlan?.evidence_requirements.includes("manual_required_verified=true"), true);
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
}

export { assertOptionalLiveProofContract };
