import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  buildCheckboxPhysicalAssistAttemptPlan,
  buildPhysicalAssistAttemptPlan,
  physicalAttemptOptionsFromEnv,
} from "../browser-captcha-assist-live-smoke/physical-gate.mjs";
import {
  DEFAULT_PHYSICAL_CHILD_TIMEOUT_MS,
  buildNativeLiveProof,
  nativeLiveCommand,
  physicalChildArgs,
  proofIdForPlatform,
  runNativeLiveProofGate,
} from "../../scripts/native-live-proof-gate.mjs";
import {
  OPTIONAL_LIVE_PROOF_REQUIREMENTS,
  validateProof,
} from "../../scripts/optional-live-proof-audit.mjs";

function assertNotCalled(label) {
  return () => {
    throw new Error(`${label} should not be called`);
  };
}

function readyPointer(platform = "linux") {
  return {
    ok: true,
    status: "pointer_ready",
    platform,
    driver: platform === "win32" ? "windows-powershell" : "linux-xdotool",
    supports_click: true,
    supports_drag: true,
    requirements: [],
  };
}

function missingPointer(platform = "linux") {
  return {
    ok: false,
    status: "requirements_missing",
    platform,
    supports_click: false,
    supports_drag: false,
    requirements: ["install target OS pointer provider"],
  };
}

function successfulPhysicalPayload(platform = "linux", overrides = {}) {
  return {
    ok: true,
    physical_assist_provider_id: "native-os",
    checkbox_physical_assist_provider_id: "native-os",
    physical_completion: {
      slider_completed: true,
      slider_visual_offset: 260,
      slider_delta_live: "260",
      handle_transform: "translateX(260px)",
    },
    checkbox_physical_completion: {
      checkbox_completed: true,
      checkbox_click_inside: true,
      status_text: "completed",
    },
    native_live_window_rect: {
      status: "success",
      platform,
      driver: platform === "win32" ? "windows-powershell" : "linux-xdotool",
      width: 1280,
      height: 800,
    },
    finalized_closed: 2,
    ...overrides,
  };
}

function requirement(id) {
  const found = OPTIONAL_LIVE_PROOF_REQUIREMENTS.find((item) => item.id === id);
  assert.ok(found, `missing optional live proof requirement: ${id}`);
  return found;
}

function successfulPhysicalRunner(parsed) {
  return async (options) => {
    assert.equal(options.env.TMWD_NATIVE_LIVE_PROOF, "1");
    assert.equal(options.env.TMWD_CAPTCHA_ASSIST_PHYSICAL, "1");
    assert.equal(options.env.TMWD_CAPTCHA_ASSIST_CONFIRM, "1");
    const proof = await options.writePhysicalProof(parsed);
    return {
      exitCode: 0,
      payload: {
        ok: true,
        status: "passed",
        check: "captcha-assist-physical-live",
        child_tab_id: "contract-managed-tab",
        proof,
      },
    };
  };
}

async function assertNativeLiveProofGateContract() {
  assert.equal(proofIdForPlatform("linux"), "native-live-linux");
  assert.equal(proofIdForPlatform("win32"), "native-live-win32");
  assert.equal(proofIdForPlatform("darwin"), undefined);
  assert.match(nativeLiveCommand("linux"), /TMWD_NATIVE_LIVE_PHYSICAL=1/);
  assert.match(nativeLiveCommand("win32"), /\$env:TMWD_NATIVE_LIVE_PHYSICAL=/);
  assert.deepEqual(physicalChildArgs([]), [
    "--timeout-ms",
    String(DEFAULT_PHYSICAL_CHILD_TIMEOUT_MS),
  ]);
  assert.deepEqual(
    physicalChildArgs(["--timeout-ms", "90000", "--tmwd-mode", "tmwd"]),
    ["--timeout-ms", "90000", "--tmwd-mode", "tmwd"],
  );

  const linuxProof = buildNativeLiveProof(successfulPhysicalPayload("linux"), {
    platform: "linux",
    checked_at: "2026-07-13T00:00:00.000Z",
    expires_at: "2099-07-13T00:00:00.000Z",
  });
  assert.deepEqual(linuxProof.actions, ["get_window_rect", "click", "drag"]);
  assert.equal(linuxProof.provider_id, "native-os");
  assert.equal(linuxProof.evidence.window_rect_verified, true);
  assert.equal(linuxProof.evidence.drag_completed, true);
  assert.equal(linuxProof.evidence.click_completed, true);
  assert.equal(linuxProof.evidence.browser_private_state_access, false);
  assert.equal(validateProof(linuxProof, requirement("native-live-linux")).ok, true);

  const windowsProof = buildNativeLiveProof(successfulPhysicalPayload("win32"), {
    platform: "win32",
    checked_at: "2026-07-13T00:00:00.000Z",
    expires_at: "2099-07-13T00:00:00.000Z",
  });
  assert.equal(windowsProof.platform, "win32");
  assert.match(windowsProof.command, /npm run proof:native-live/);
  assert.equal(validateProof(windowsProof, requirement("native-live-win32")).ok, true);

  const missingRectAction = validateProof({
    ...linuxProof,
    actions: ["click", "drag"],
  }, requirement("native-live-linux"));
  assert.equal(missingRectAction.ok, false);
  assert.ok(missingRectAction.errors.includes("native_get_window_rect_action_required"));

  const unsafeEvidence = validateProof({
    ...linuxProof,
    evidence: {
      ...linuxProof.evidence,
      managed_tab_only: false,
      fullscreen_screenshot: true,
      secrets_redacted: false,
      window_rect_verified: false,
      drag_completed: false,
      click_completed: false,
      browser_private_state_access: true,
    },
  }, requirement("native-live-linux"));
  assert.equal(unsafeEvidence.ok, false);
  assert.ok(unsafeEvidence.errors.includes("native_managed_tab_only_must_be_true"));
  assert.ok(unsafeEvidence.errors.includes("native_fullscreen_screenshot_must_be_false"));
  assert.ok(unsafeEvidence.errors.includes("native_secrets_redacted_must_be_true"));
  assert.ok(unsafeEvidence.errors.includes("native_window_rect_verified_must_be_true"));
  assert.ok(unsafeEvidence.errors.includes("native_drag_completed_must_be_true"));
  assert.ok(unsafeEvidence.errors.includes("native_click_completed_must_be_true"));
  assert.ok(unsafeEvidence.errors.includes("native_browser_private_state_access_must_be_false"));

  assert.throws(
    () => buildNativeLiveProof(successfulPhysicalPayload("linux", {
      native_live_window_rect: undefined,
    }), { platform: "linux" }),
    /get_window_rect/,
  );
  assert.throws(
    () => buildNativeLiveProof(successfulPhysicalPayload("linux", {
      physical_assist_provider_id: "ljq-ctrl",
    }), { platform: "linux" }),
    /native-os drag provider/,
  );

  const previousNativeProofFlag = process.env.TMWD_NATIVE_LIVE_PROOF;
  try {
    process.env.TMWD_NATIVE_LIVE_PROOF = "1";
    const attemptOptions = physicalAttemptOptionsFromEnv();
    assert.equal(attemptOptions.physicalInputProvider, "native-os");
    assert.equal(
      buildPhysicalAssistAttemptPlan(1, null, attemptOptions).args.physical_input_provider,
      "native-os",
    );
    assert.equal(
      buildCheckboxPhysicalAssistAttemptPlan(1, null, null, attemptOptions).args.physical_input_provider,
      "native-os",
    );
  } finally {
    if (previousNativeProofFlag === undefined) {
      delete process.env.TMWD_NATIVE_LIVE_PROOF;
    } else {
      process.env.TMWD_NATIVE_LIVE_PROOF = previousNativeProofFlag;
    }
  }

  const readiness = await runNativeLiveProofGate({
    argv: [],
    env: {},
    platform: "linux",
    nativePointerPreflight: async () => readyPointer("linux"),
    runPhysicalLiveGate: assertNotCalled("physical live gate"),
  });
  assert.equal(readiness.exitCode, 0);
  assert.equal(readiness.payload.status, "ready_for_explicit_opt_in");
  assert.equal(readiness.payload.physical_input_executed, false);
  assert.equal(readiness.payload.pointer_moved, false);

  const readinessBlocked = await runNativeLiveProofGate({
    argv: [],
    env: {},
    platform: "linux",
    nativePointerPreflight: async () => missingPointer("linux"),
    runPhysicalLiveGate: assertNotCalled("physical live gate"),
  });
  assert.equal(readinessBlocked.exitCode, 0);
  assert.equal(readinessBlocked.payload.status, "blocked_by_native_pointer");
  assert.equal(readinessBlocked.payload.physical_input_attempted, false);

  const notApplicable = await runNativeLiveProofGate({
    argv: [],
    env: {},
    platform: "darwin",
    nativePointerPreflight: assertNotCalled("native pointer preflight"),
    runPhysicalLiveGate: assertNotCalled("physical live gate"),
  });
  assert.equal(notApplicable.exitCode, 0);
  assert.equal(notApplicable.payload.status, "not_applicable");
  assert.equal(notApplicable.payload.pointer_moved, false);

  const platformMismatch = await runNativeLiveProofGate({
    argv: ["--write"],
    env: {
      TMWD_NATIVE_LIVE_PHYSICAL: "1",
      TMWD_NATIVE_LIVE_CONFIRM: "1",
    },
    platform: "darwin",
    nativePointerPreflight: assertNotCalled("native pointer preflight"),
    runPhysicalLiveGate: assertNotCalled("physical live gate"),
  });
  assert.equal(platformMismatch.exitCode, 1);
  assert.equal(platformMismatch.payload.status, "blocked");
  assert.equal(platformMismatch.payload.reason, "native_live_target_platform_required");

  const missingConfirm = await runNativeLiveProofGate({
    argv: ["--write"],
    env: { TMWD_NATIVE_LIVE_PHYSICAL: "1" },
    platform: "linux",
    nativePointerPreflight: assertNotCalled("native pointer preflight"),
    runPhysicalLiveGate: assertNotCalled("physical live gate"),
  });
  assert.equal(missingConfirm.exitCode, 1);
  assert.match(missingConfirm.payload.reason, /CONFIRM=1/);
  assert.equal(missingConfirm.payload.pointer_moved, false);

  const missingWrite = await runNativeLiveProofGate({
    argv: [],
    env: {
      TMWD_NATIVE_LIVE_PHYSICAL: "1",
      TMWD_NATIVE_LIVE_CONFIRM: "1",
    },
    platform: "linux",
    nativePointerPreflight: assertNotCalled("native pointer preflight"),
    runPhysicalLiveGate: assertNotCalled("physical live gate"),
  });
  assert.equal(missingWrite.exitCode, 1);
  assert.match(missingWrite.payload.reason, /--write/);

  const pointerMissing = await runNativeLiveProofGate({
    argv: ["--write"],
    env: {
      TMWD_NATIVE_LIVE_PHYSICAL: "1",
      TMWD_NATIVE_LIVE_CONFIRM: "1",
    },
    platform: "linux",
    pathExists: async () => false,
    nativePointerPreflight: async () => missingPointer("linux"),
    runPhysicalLiveGate: assertNotCalled("physical live gate"),
  });
  assert.equal(pointerMissing.exitCode, 1);
  assert.equal(pointerMissing.payload.reason, "native_pointer_requirements_missing");
  assert.equal(pointerMissing.payload.physical_input_attempted, false);

  const proofDir = await fs.mkdtemp(path.join(os.tmpdir(), "browser67-native-live-gate-contract-"));
  try {
    const success = await runNativeLiveProofGate({
      argv: ["--write", "--proof-dir", proofDir],
      env: {
        TMWD_NATIVE_LIVE_PHYSICAL: "1",
        TMWD_NATIVE_LIVE_CONFIRM: "1",
      },
      platform: "linux",
      checked_at: "2026-07-13T00:00:00.000Z",
      expires_at: "2099-07-13T00:00:00.000Z",
      pathExists: async () => false,
      nativePointerPreflight: async () => readyPointer("linux"),
      runPhysicalLiveGate: successfulPhysicalRunner(successfulPhysicalPayload("linux")),
    });
    assert.equal(success.exitCode, 0);
    assert.equal(success.payload.status, "passed");
    assert.equal(success.payload.physical_input_executed, true);
    assert.equal(success.payload.pointer_moved, true);
    assert.equal(success.payload.proof.id, "native-live-linux");
    assert.equal(success.payload.proof.validation.ok, true);
    assert.equal(success.payload.proof.redaction_checklist.ok, true);
    const persistedPath = path.join(proofDir, "native-live-linux.json");
    const persisted = JSON.parse(await fs.readFile(persistedPath, "utf8"));
    assert.equal(persisted.platform, "linux");
    assert.equal(persisted.evidence.window_rect_verified, true);

    const existingBlocked = await runNativeLiveProofGate({
      argv: ["--write", "--proof-dir", proofDir],
      env: {
        TMWD_NATIVE_LIVE_PHYSICAL: "1",
        TMWD_NATIVE_LIVE_CONFIRM: "1",
      },
      platform: "linux",
      nativePointerPreflight: assertNotCalled("native pointer preflight"),
      runPhysicalLiveGate: assertNotCalled("physical live gate"),
    });
    assert.equal(existingBlocked.exitCode, 1);
    assert.equal(existingBlocked.payload.reason, "native_live_proof_already_exists");
    assert.equal(existingBlocked.payload.physical_input_attempted, false);
  } finally {
    await fs.rm(proofDir, { recursive: true, force: true });
  }
}

export { assertNativeLiveProofGateContract };
