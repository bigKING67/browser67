import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";

async function writeFakePythonProbe(dir, name, payload) {
  const file = path.join(dir, name);
  await fs.writeFile(
    file,
    [
      "#!/bin/sh",
      "cat <<'TMWD_LJQCTRL_JSON'",
      JSON.stringify(payload),
      "TMWD_LJQCTRL_JSON",
      "",
    ].join("\n"),
    { mode: 0o700 },
  );
  await fs.chmod(file, 0o700);
  return file;
}

async function writeLocalCaptchaPhysicalProof(dir) {
  const checkedAt = new Date().toISOString();
  const expiresAt = new Date(Date.now() + 90 * 24 * 60 * 60 * 1000).toISOString();
  const file = path.join(dir, "captcha-assist-physical-local.json");
  await fs.writeFile(
    file,
    `${JSON.stringify({
      type: "captcha_physical_live",
      ok: true,
      platform: process.platform,
      provider_id: "native-os",
      actions: ["drag", "click"],
      checked_at: checkedAt,
      expires_at: expiresAt,
      command: "TMWD_CAPTCHA_ASSIST_PHYSICAL=1 TMWD_CAPTCHA_ASSIST_CONFIRM=1 npm run check:captcha-assist-physical-live",
      managed_tab_only: true,
      fixture: "local browser67-owned managed tab",
      slider_completed: true,
      checkbox_completed: true,
      fullscreen_screenshot: false,
      js_cdp_widget_click: false,
      secrets_redacted: true,
      evidence: {
        assist_target: "slider",
        assist_targets: ["slider", "checkbox"],
        slider_visual_offset: 260,
        slider_delta_live: "260",
        handle_transform: "translateX(260px)",
        checkbox_click_inside: true,
        checkbox_status_text: "completed",
        browser_private_state_access: false,
      },
    }, null, 2)}\n`,
  );
  return file;
}

function runReadinessAudit(env = {}) {
  const result = spawnSync("node", ["scripts/readiness-audit.mjs", "--json"], {
    cwd: process.cwd(),
    encoding: "utf8",
    env: {
      ...process.env,
      ...env,
    },
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  return JSON.parse(result.stdout.trim());
}

function findGap(audit, id) {
  return audit.optional_gaps.find((gap) => gap.id === id);
}

function assertPermissionRecoveryPlan(plan) {
  assert.equal(plan?.status, "permission_required");
  assert.equal(plan?.blocker, "macos_accessibility_for_current_terminal");
  assert.deepEqual(plan?.affected_actions, ["click", "drag"]);
  assert.equal(plan?.settings_path, "System Settings -> Privacy & Security -> Accessibility");
  assert.match(plan?.open_settings_command ?? "", /Privacy_Accessibility/);
  assert.equal(Array.isArray(plan?.manual_steps), true);
  assert.equal(
    plan?.manual_steps.some((step) => step.includes("npm run check:native-pointer")),
    true,
  );
  assert.equal(
    plan?.manual_steps.some((step) => step.includes("TMWD_CAPTCHA_ASSIST_PHYSICAL=1")),
    true,
  );
  assert.equal(
    plan?.safe_defaults.includes("This report does not move the mouse."),
    true,
  );
  assert.equal(
    plan?.safe_defaults.includes("This report does not open Chrome or create a managed tab."),
    true,
  );
  assert.equal(
    plan?.safe_defaults.includes("This report does not read browser private state."),
    true,
  );
}

async function assertReadinessLjqCtrlProbeContract() {
  if (process.platform === "win32") {
    return;
  }

  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "tmwd-readiness-ljqctrl-"));
  try {
    const defaultProofDir = path.join(tmpDir, "default-empty-proofs");
    const defaultAudit = runReadinessAudit({
      TMWD_LJQCTRL_PYTHON: "",
      TMWD_LJQCTRL_PYTHON_CANDIDATES: "",
      TMWD_LJQCTRL_EXECUTE: "",
      TMWD_OPTIONAL_PROOF_DIR: defaultProofDir,
    });
    if (process.platform === "win32") {
      assert.ok(
        findGap(defaultAudit, "ljqctrl_not_configured")
        || findGap(defaultAudit, "ljqctrl_probe_available_execution_gated")
        || findGap(defaultAudit, "ljqctrl_execution_bridge_available"),
      );
    } else {
      const platformGap = findGap(defaultAudit, "ljqctrl_platform_not_applicable");
      assert.equal(platformGap?.deduction, 0);
      assert.match(platformGap?.evidence ?? "", /platform_supported=false/);
      assert.equal(findGap(defaultAudit, "ljqctrl_not_configured"), undefined);
    }
    const defaultNativePointerGap = findGap(defaultAudit, "native_pointer_actions_unavailable");
    if (defaultNativePointerGap?.permission_recovery) {
      assertPermissionRecoveryPlan(defaultNativePointerGap.permission_recovery);
    }
    const defaultCaptchaBlockedGap = findGap(defaultAudit, "captcha_physical_live_gate_blocked_by_native_pointer");
    const defaultCaptchaProofGap = defaultCaptchaBlockedGap
      ?? findGap(defaultAudit, "captcha_physical_live_gate_not_executed");
    if (defaultCaptchaBlockedGap?.permission_recovery) {
      assertPermissionRecoveryPlan(defaultCaptchaBlockedGap.permission_recovery);
      assert.equal(
        defaultCaptchaBlockedGap.permission_recovery.blocker,
        defaultNativePointerGap?.permission_recovery?.blocker,
      );
    }
    assert.equal(defaultCaptchaProofGap?.proof_plan?.command, "npm run plan:optional-live-proofs -- --json");
    assert.equal(
      defaultCaptchaProofGap?.proof_plan?.missing.includes("captcha-assist-physical-local"),
      true,
    );
    const crossOsGap = findGap(defaultAudit, "cross_os_native_live_not_proven");
    assert.equal(crossOsGap?.proof_plan?.command, "npm run plan:optional-live-proofs -- --json");
    assert.equal(crossOsGap?.proof_plan?.missing.includes("native-live-linux"), true);
    const idpGap = findGap(defaultAudit, "complex_idp_optional_live_not_proven");
    assert.equal(idpGap?.proof_plan?.missing.includes("idp-oauth-popup"), true);

    const proofDir = path.join(tmpDir, "proofs");
    await fs.mkdir(proofDir, { recursive: true });
    await writeLocalCaptchaPhysicalProof(proofDir);
    const provenPhysicalAudit = runReadinessAudit({
      TMWD_OPTIONAL_PROOF_DIR: proofDir,
      TMWD_CAPTCHA_ASSIST_PHYSICAL: "",
      TMWD_CAPTCHA_ASSIST_CONFIRM: "",
      TMWD_LJQCTRL_PYTHON: "",
      TMWD_LJQCTRL_PYTHON_CANDIDATES: "",
      TMWD_LJQCTRL_EXECUTE: "",
    });
    const physicalProvenGap = findGap(provenPhysicalAudit, "captcha_physical_live_gate_proven");
    assert.equal(physicalProvenGap?.deduction, 0);
    assert.match(physicalProvenGap?.evidence ?? "", /captcha-assist-physical-local\.json/);
    assert.equal(findGap(provenPhysicalAudit, "captcha_physical_live_gate_not_executed"), undefined);
    assert.equal(findGap(provenPhysicalAudit, "captcha_physical_live_gate_blocked_by_native_pointer"), undefined);
    assert.equal(findGap(provenPhysicalAudit, "captcha_physical_live_gate_proof_missing"), undefined);

    const emptyProofDir = path.join(tmpDir, "empty-proofs");
    await fs.mkdir(emptyProofDir, { recursive: true });
    const optInUnprovenAudit = runReadinessAudit({
      TMWD_OPTIONAL_PROOF_DIR: emptyProofDir,
      TMWD_CAPTCHA_ASSIST_PHYSICAL: "1",
      TMWD_CAPTCHA_ASSIST_CONFIRM: "1",
      TMWD_LJQCTRL_PYTHON: "",
      TMWD_LJQCTRL_PYTHON_CANDIDATES: "",
      TMWD_LJQCTRL_EXECUTE: "",
    });
    assert.equal(findGap(optInUnprovenAudit, "captcha_physical_live_gate_not_executed"), undefined);
    const localCaptchaUnprovenGap = findGap(optInUnprovenAudit, "captcha_physical_live_gate_blocked_by_native_pointer")
      || findGap(optInUnprovenAudit, "captcha_physical_live_gate_proof_missing");
    assert.equal(localCaptchaUnprovenGap?.deduction, 0.006);

    const failingPython = await writeFakePythonProbe(tmpDir, "python-no-ljqctrl", {
      ok: false,
      reason: "No module named 'ljqCtrl'",
    });
    const workingPython = await writeFakePythonProbe(tmpDir, "python-with-ljqctrl", {
      ok: true,
      has_click: true,
      has_press: true,
      has_find_block: true,
      has_grab_window: true,
      has_grab_window_bg: false,
      has_mouse_dclick: false,
      dpi_scale: 1,
    });

    const availableAudit = runReadinessAudit({
      TMWD_LJQCTRL_PYTHON_CANDIDATES: [failingPython, workingPython].join(path.delimiter),
      TMWD_LJQCTRL_EXECUTE: "",
    });
    const availableGap = findGap(availableAudit, "ljqctrl_probe_available_execution_gated");
    assert.equal(availableGap?.deduction, 0);
    assert.match(availableGap?.evidence ?? "", /importable=true/);
    assert.match(availableGap?.evidence ?? "", /execution_bridge_enabled=false/);
    assert.equal(findGap(availableAudit, "ljqctrl_not_configured"), undefined);
    assert.equal(findGap(availableAudit, "ljqctrl_config_invalid"), undefined);

    const executableAudit = runReadinessAudit({
      TMWD_LJQCTRL_PYTHON_CANDIDATES: [failingPython, workingPython].join(path.delimiter),
      TMWD_LJQCTRL_EXECUTE: "1",
    });
    const executableGap = findGap(executableAudit, "ljqctrl_execution_bridge_available");
    assert.equal(executableGap?.deduction, 0);
    assert.match(executableGap?.evidence ?? "", /execution_bridge_enabled=true/);

    const invalidAudit = runReadinessAudit({
      TMWD_LJQCTRL_PYTHON: failingPython,
      TMWD_LJQCTRL_PYTHON_CANDIDATES: "",
      TMWD_LJQCTRL_EXECUTE: "",
    });
    const invalidGap = findGap(invalidAudit, "ljqctrl_config_invalid");
    assert.equal(invalidGap?.deduction, 0.006);
    assert.match(invalidGap?.evidence ?? "", /source=TMWD_LJQCTRL_PYTHON/);
    assert.match(invalidGap?.evidence ?? "", /importable=false/);
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
}

export { assertReadinessLjqCtrlProbeContract };
