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
import { buildOptionalLiveProofRecord } from "../../scripts/optional-live-proof-record.mjs";
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

  const recordTmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "tmwd-optional-proof-record-contract-"));
  try {
    const inputPath = path.join(recordTmpDir, "linux-proof-input.json");
    await fs.writeFile(inputPath, `${JSON.stringify(validNativeProof("linux"), null, 2)}\n`);
    const dryRunRecord = await buildOptionalLiveProofRecord({
      id: "native-live-linux",
      from_json: inputPath,
      proof_dir: recordTmpDir,
    });
    assert.equal(dryRunRecord.ok, true);
    assert.equal(dryRunRecord.status, "validated");
    assert.equal(dryRunRecord.written, false);
    await assert.rejects(
      () => fs.stat(path.join(recordTmpDir, "native-live-linux.json")),
      /ENOENT/,
    );

    const writtenRecord = await buildOptionalLiveProofRecord({
      id: "native-live-linux",
      from_json: inputPath,
      proof_dir: recordTmpDir,
      write: true,
    });
    assert.equal(writtenRecord.ok, true);
    assert.equal(writtenRecord.status, "written");
    assert.equal(writtenRecord.written, true);
    assert.equal(writtenRecord.output.sha256.length, 64);
    const persisted = JSON.parse(await fs.readFile(path.join(recordTmpDir, "native-live-linux.json"), "utf8"));
    assert.equal(persisted.platform, "linux");

    const blockedRecord = await buildOptionalLiveProofRecord({
      id: "native-live-linux",
      from_json: inputPath,
      proof_dir: recordTmpDir,
      write: true,
    });
    assert.equal(blockedRecord.ok, false);
    assert.equal(blockedRecord.status, "blocked_existing_proof");

    const templatePath = path.join(recordTmpDir, "linux-proof-template.json");
    await fs.writeFile(templatePath, `${JSON.stringify(nativeTemplate, null, 2)}\n`);
    const invalidRecord = await buildOptionalLiveProofRecord({
      id: "native-live-linux",
      from_json: templatePath,
      proof_dir: recordTmpDir,
      write: true,
      replace: true,
    });
    assert.equal(invalidRecord.ok, false);
    assert.equal(invalidRecord.status, "invalid");
    assert.ok(invalidRecord.validation.errors.includes("template_only_not_accepted"));
  } finally {
    await fs.rm(recordTmpDir, { recursive: true, force: true });
  }

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
    assert.equal(win32?.accepted?.path?.endsWith("native-live-win32.json"), true);
    assert.equal(win32?.accepted?.expires_at, "2099-06-17T00:00:00.000Z");
    assert.equal(typeof win32?.accepted?.expires_in_days, "number");

    const plan = await buildOptionalLiveProofPlan({ proof_dir: tmpDir });
    assert.equal(plan.action, "optional-live-proof-plan");
    assert.equal(plan.safe_defaults.includes("This plan does not move the mouse."), true);
    assert.equal(plan.safe_defaults.includes("This plan does not read browser private state."), true);
    const captchaPlan = plan.items.find((item) => item.id === "captcha-assist-physical-local");
    assert.ok(captchaPlan);
    assert.equal(captchaPlan.collection_mode, "local_gui_physical_gate");
    assert.equal(captchaPlan.commands.live_gate.includes("TMWD_CAPTCHA_ASSIST_PHYSICAL=1"), true);
    assert.equal(captchaPlan.evidence_requirements.includes("slider_visual_offset>=180"), true);
    assert.equal(captchaPlan.collection_steps.includes("Run the native pointer readiness check."), true);
    assert.equal(
      captchaPlan.safety_boundaries.includes("Do not use JS/CDP clicks on CAPTCHA widgets."),
      true,
    );
    const win32Plan = plan.items.find((item) => item.id === "native-live-win32");
    assert.equal(win32Plan?.satisfied, true);
    assert.equal(win32Plan?.proof_path?.endsWith("native-live-win32.json"), true);
    assert.equal(win32Plan?.accepted?.expires_at, "2099-06-17T00:00:00.000Z");
    assert.equal(typeof win32Plan?.accepted?.expires_in_days, "number");
    assert.equal(win32Plan?.next_command, `TMWD_OPTIONAL_PROOF_DIR=${tmpDir} npm run check:optional-live-proofs`);
    assert.equal(win32Plan?.commands.record_replace, "npm run proof:optional-live-record -- --id native-live-win32 --from-json <sanitized.json> --write --replace");
    const linuxPlan = plan.items.find((item) => item.id === "native-live-linux");
    assert.equal(linuxPlan?.collection_mode, "cross_os_native_physical_gate");
    assert.equal(linuxPlan?.target_platform, "linux");
    assert.equal(linuxPlan?.next_command, "Run this plan on a linux host");
    assert.equal(linuxPlan?.commands.template, "npm run proof:optional-live-template -- --id native-live-linux --write");
    assert.equal(
      linuxPlan?.commands.record,
      "npm run proof:optional-live-record -- --id native-live-linux --from-json <sanitized.json>",
    );
    assert.equal(
      linuxPlan?.commands.record_write,
      "npm run proof:optional-live-record -- --id native-live-linux --from-json <sanitized.json> --write",
    );
    const idpPlan = plan.items.find((item) => item.id === "idp-oauth-popup");
    assert.equal(idpPlan?.status, "requires_approved_external_provider");
    assert.equal(idpPlan?.next_command, "Run approved external oauth_popup handoff/resume gate");
    assert.equal(idpPlan?.commands.local_fixture_baseline, "npm run check:auth-live");
    assert.equal(idpPlan?.evidence_requirements.includes("manual_required_verified=true"), true);
    assert.equal(idpPlan?.collection_steps.includes("Resume ensure_login and record sanitized proof JSON."), true);
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
}

export { assertOptionalLiveProofContract };
