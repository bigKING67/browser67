import assert from "node:assert/strict";

import { buildPhysicalAssistAttemptPlan } from "../browser-captcha-assist-live-smoke/physical-gate.mjs";
import { parseLastJsonLine } from "../browser-captcha-assist-physical-live-gate/child-runner.mjs";
import { buildPhysicalProof } from "../browser-captcha-assist-physical-live-gate/proof.mjs";
import { runPhysicalLiveGate } from "../browser-captcha-assist-physical-live-gate/runner.mjs";
import {
  clampRectToViewport,
  clientPointToNativeWindowScreen,
} from "../../src/auth/captcha/coordinates.mjs";
import {
  buildWindowsClickScript,
  buildWindowsDragScript,
} from "../../src/native-windows/pointer.mjs";
import { buildWindowsNativePrelude } from "../../src/native-windows/powershell.mjs";

function assertNotCalled(label) {
  return () => {
    throw new Error(`${label} should not be called`);
  };
}

function readyPointer() {
  return {
    ok: true,
    status: "pointer_ready",
    supports_click: true,
    supports_drag: true,
  };
}

function missingPointer() {
  return {
    ok: false,
    status: "requirements_missing",
    supports_click: false,
    supports_drag: false,
    requirements: ["grant pointer permission"],
  };
}

function successfulChildPayload(overrides = {}) {
  return {
    ok: true,
    planning_only: false,
    physical_assist_status: "success",
    physical_assist_provider_id: "native-os",
    physical_assist_coordinates_source: "vision_corrected_region_capture",
    physical_attempt_count: 1,
    physical_attempts: [{ attempt: 1, strategy: "vision_corrected_primary" }],
    physical_completion: {
      slider_completed: true,
      slider_visual_offset: 260,
      slider_delta_live: "260",
      handle_transform: "translateX(260px)",
    },
    checkbox_physical_required: true,
    checkbox_physical_assist_status: "success",
    checkbox_physical_assist_coordinates_source: "vision_corrected_region_capture",
    checkbox_physical_attempt_count: 1,
    checkbox_physical_attempts: [{ attempt: 1, strategy: "vision_corrected_checkbox_click" }],
    checkbox_physical_completion: {
      checkbox_completed: true,
      checkbox_click_inside: true,
      status_text: "completed",
      checkbox_click: { x: 77, y: 121.5 },
    },
    matrix_results: [{ case: "slider" }],
    finalized_closed: 1,
    workspace_key: "contract-captcha",
    tab_id: 123,
    ...overrides,
  };
}

async function assertPhysicalLiveGateContract() {
  const windowsDpiPrelude = buildWindowsNativePrelude();
  assert.match(windowsDpiPrelude, /SetProcessDpiAwarenessContext/);
  assert.match(windowsDpiPrelude, /SetProcessDPIAware/);
  assert.match(windowsDpiPrelude, /SetCursorPos/);
  assert.match(windowsDpiPrelude, /GetCursorPos/);
  assert.match(windowsDpiPrelude, /SendInput/);
  assert.match(windowsDpiPrelude, /GetWindowThreadProcessId/);

  const windowsDragScript = buildWindowsDragScript({
    button: "left",
    delayMs: 30,
    downFlag: "0x0002",
    durationMs: 900,
    expectedWindowHwnd: 12345,
    fromX: 137,
    fromY: 546,
    steps: 24,
    toX: 657,
    toY: 546,
    upFlag: "0x0004",
    virtualKey: "0x01",
  });
  assert.match(windowsDragScript, /actual_from/);
  assert.match(windowsDragScript, /actual_to/);
  assert.match(windowsDragScript, /button_down_observed/);
  assert.match(windowsDragScript, /foreground_window/);
  assert.match(windowsDragScript, /foreground_window_verified/);
  assert.match(windowsDragScript, /SetForegroundWindow/);
  assert.match(windowsDragScript, /Start-Sleep -Milliseconds \$preDownSettleMs/);
  assert.match(windowsDragScript, /SendMouseInput/);

  const windowsClickScript = buildWindowsClickScript({
    button: "left",
    count: 1,
    downFlag: "0x0002",
    expectedWindowHwnd: 12345,
    upFlag: "0x0004",
    virtualKey: "0x01",
    x: 154,
    y: 742,
  });
  assert.match(windowsClickScript, /actual_point/);
  assert.match(windowsClickScript, /position_verified/);
  assert.match(windowsClickScript, /foreground_window_verified/);
  assert.match(windowsClickScript, /SendMouseInput/);

  const highDpiPoint = clientPointToNativeWindowScreen(
    { x: 75, y: 100 },
    {
      device_pixel_ratio: 2,
      inner_height: 735,
      inner_width: 1_440,
      outer_height: 912,
      outer_width: 1_440,
      visual_viewport: {
        offset_left: 0,
        offset_top: 0,
        scale: 1,
      },
    },
    {
      left: 0,
      top: 0,
      width: 2_880,
      height: 1_824,
    },
  );
  assert.equal(highDpiPoint?.x, 150);
  assert.equal(highDpiPoint?.y, 554);
  assert.equal(highDpiPoint?.coordinate_system, "physical_screen_pixels");
  assert.equal(highDpiPoint?.calibration?.browser_window_scale?.x, 2);
  assert.equal(highDpiPoint?.calibration?.content_scale?.x, 2);
  assert.equal(
    clientPointToNativeWindowScreen(
      { x: 75, y: 100 },
      {
        inner_height: 735,
        inner_width: 1_440,
        outer_height: 912,
        outer_width: 1_440,
      },
      null,
    ),
    null,
  );

  assert.deepEqual(
    clampRectToViewport({
      left: 48,
      top: 144,
      right: 370,
      bottom: 198,
    }, {
      inner_width: 0,
      inner_height: 0,
      visual_viewport: {
        width: 0,
        height: 0,
      },
    }),
    {
      x: 36,
      y: 132,
      width: 346,
      height: 78,
      scale: 1,
      coordinate_system: "viewport_css_pixels",
    },
  );

  const disabled = await runPhysicalLiveGate({
    env: {},
    nativePointerPreflight: assertNotCalled("native pointer preflight"),
    runChild: assertNotCalled("physical child runner"),
    writePhysicalProof: assertNotCalled("physical proof writer"),
  });
  assert.equal(disabled.exitCode, 0);
  assert.equal(disabled.payload.status, "skipped");
  assert.equal(disabled.payload.ok, true);
  assert.equal(disabled.payload.physical_input_attempted, false);
  assert.equal(disabled.payload.physical_input_executed, false);
  assert.equal(disabled.payload.pointer_moved, false);
  assert.match(disabled.payload.physical_gate_command, /TMWD_CAPTCHA_ASSIST_PHYSICAL=1/);

  const disabledRequired = await runPhysicalLiveGate({
    env: { TMWD_CAPTCHA_ASSIST_REQUIRE_PHYSICAL: "1" },
    nativePointerPreflight: assertNotCalled("native pointer preflight"),
    runChild: assertNotCalled("physical child runner"),
    writePhysicalProof: assertNotCalled("physical proof writer"),
  });
  assert.equal(disabledRequired.exitCode, 1);
  assert.equal(disabledRequired.payload.status, "skipped");
  assert.equal(disabledRequired.payload.ok, false);
  assert.equal(disabledRequired.payload.pointer_moved, false);

  const missingConfirm = await runPhysicalLiveGate({
    env: { TMWD_CAPTCHA_ASSIST_PHYSICAL: "1" },
    nativePointerPreflight: assertNotCalled("native pointer preflight"),
    runChild: assertNotCalled("physical child runner"),
    writePhysicalProof: assertNotCalled("physical proof writer"),
  });
  assert.equal(missingConfirm.exitCode, 1);
  assert.equal(missingConfirm.payload.status, "blocked");
  assert.match(missingConfirm.payload.reason, /CONFIRM=1/);
  assert.equal(missingConfirm.payload.physical_input_executed, false);
  assert.equal(missingConfirm.payload.pointer_moved, false);

  const pointerMissingSkip = await runPhysicalLiveGate({
    env: {
      TMWD_CAPTCHA_ASSIST_PHYSICAL: "1",
      TMWD_CAPTCHA_ASSIST_CONFIRM: "1",
    },
    nativePointerPreflight: async () => missingPointer(),
    runChild: assertNotCalled("physical child runner"),
    writePhysicalProof: assertNotCalled("physical proof writer"),
  });
  assert.equal(pointerMissingSkip.exitCode, 0);
  assert.equal(pointerMissingSkip.payload.status, "skipped");
  assert.equal(pointerMissingSkip.payload.gui_fixture_started, false);
  assert.equal(pointerMissingSkip.payload.managed_tab_created, false);
  assert.equal(pointerMissingSkip.payload.physical_input_attempted, false);
  assert.equal(pointerMissingSkip.payload.physical_input_executed, false);
  assert.equal(pointerMissingSkip.payload.pointer_moved, false);

  const pointerMissingBlocked = await runPhysicalLiveGate({
    env: {
      TMWD_CAPTCHA_ASSIST_PHYSICAL: "1",
      TMWD_CAPTCHA_ASSIST_CONFIRM: "1",
      TMWD_CAPTCHA_ASSIST_REQUIRE_PHYSICAL: "1",
    },
    nativePointerPreflight: async () => missingPointer(),
    runChild: assertNotCalled("physical child runner"),
    writePhysicalProof: assertNotCalled("physical proof writer"),
  });
  assert.equal(pointerMissingBlocked.exitCode, 1);
  assert.equal(pointerMissingBlocked.payload.status, "blocked");
  assert.equal(pointerMissingBlocked.payload.ok, false);

  const childFailure = await runPhysicalLiveGate({
    env: {
      TMWD_CAPTCHA_ASSIST_PHYSICAL: "1",
      TMWD_CAPTCHA_ASSIST_CONFIRM: "1",
    },
    nativePointerPreflight: async () => readyPointer(),
    runChild: async () => ({
      status: 7,
      stdout: `diagnostic\n${JSON.stringify({ ok: false, reason: "contract_child_failed" })}\n`,
      stderr: "contract stderr",
    }),
    writePhysicalProof: assertNotCalled("physical proof writer"),
  });
  assert.equal(childFailure.exitCode, 7);
  assert.equal(childFailure.payload.status, "failed");
  assert.equal(childFailure.payload.child_result.reason, "contract_child_failed");

  const childPayload = successfulChildPayload();
  let proofWriteCount = 0;
  const success = await runPhysicalLiveGate({
    env: {
      TMWD_CAPTCHA_ASSIST_PHYSICAL: "1",
      TMWD_CAPTCHA_ASSIST_CONFIRM: "1",
    },
    platform: "contract-os",
    nativePointerPreflight: async () => readyPointer(),
    runChild: async () => ({
      status: 0,
      stdout: `noise\n${JSON.stringify(childPayload)}\n`,
      stderr: "",
    }),
    writePhysicalProof: async (parsed, options) => {
      proofWriteCount += 1;
      assert.equal(parsed.physical_assist_status, "success");
      assert.equal(options.platform, "contract-os");
      return { written: true, id: "captcha-assist-physical-local", path: "/tmp/contract-proof.json" };
    },
  });
  assert.equal(success.exitCode, 0);
  assert.equal(success.payload.status, "passed");
  assert.equal(success.payload.proof.written, true);
  assert.equal(proofWriteCount, 1);

  const proofFailureSoft = await runPhysicalLiveGate({
    env: {
      TMWD_CAPTCHA_ASSIST_PHYSICAL: "1",
      TMWD_CAPTCHA_ASSIST_CONFIRM: "1",
    },
    nativePointerPreflight: async () => readyPointer(),
    runChild: async () => ({ status: 0, stdout: `${JSON.stringify(childPayload)}\n`, stderr: "" }),
    writePhysicalProof: async () => {
      throw new Error("contract proof unavailable");
    },
  });
  assert.equal(proofFailureSoft.exitCode, 0);
  assert.equal(proofFailureSoft.payload.ok, true);
  assert.equal(proofFailureSoft.payload.proof.written, false);

  const proofFailureHard = await runPhysicalLiveGate({
    env: {
      TMWD_CAPTCHA_ASSIST_PHYSICAL: "1",
      TMWD_CAPTCHA_ASSIST_CONFIRM: "1",
      TMWD_CAPTCHA_ASSIST_REQUIRE_PROOF: "1",
    },
    nativePointerPreflight: async () => readyPointer(),
    runChild: async () => ({ status: 0, stdout: `${JSON.stringify(childPayload)}\n`, stderr: "" }),
    writePhysicalProof: async () => {
      throw new Error("contract proof unavailable");
    },
  });
  assert.equal(proofFailureHard.exitCode, 1);
  assert.equal(proofFailureHard.payload.ok, false);
  assert.equal(proofFailureHard.payload.reason, "physical proof write failed");

  const noCompletion = await runPhysicalLiveGate({
    env: {
      TMWD_CAPTCHA_ASSIST_PHYSICAL: "1",
      TMWD_CAPTCHA_ASSIST_CONFIRM: "1",
    },
    nativePointerPreflight: async () => readyPointer(),
    runChild: async () => ({
      status: 0,
      stdout: `${JSON.stringify(successfulChildPayload({ physical_completion: { slider_completed: false } }))}\n`,
      stderr: "",
    }),
    writePhysicalProof: assertNotCalled("physical proof writer"),
  });
  assert.equal(noCompletion.exitCode, 1);
  assert.equal(noCompletion.payload.status, "failed");

  assert.equal(parseLastJsonLine("not json\n{\"ok\":true}\n")?.ok, true);
  assert.equal(parseLastJsonLine("not json"), null);

  const proof = buildPhysicalProof(childPayload, {
    platform: "contract-os",
    checked_at: "2026-01-01T00:00:00.000Z",
  });
  assert.equal(proof.platform, "contract-os");
  assert.equal(proof.slider_completed, true);
  assert.equal(proof.checkbox_completed, true);
  assert.deepEqual(proof.actions, ["drag", "click"]);
  assert.equal(proof.evidence.slider_visual_offset, 260);
  assert.equal(proof.evidence.slider_delta_live, "260");
  assert.equal(proof.evidence.handle_transform, "translateX(260px)");
  assert.equal(proof.evidence.checkbox_click_inside, true);
  assert.equal(proof.evidence.checkbox_physical_attempt_count, 1);
  assert.equal(proof.evidence.physical_attempt_count, 1);
  assert.equal(proof.managed_tab_only, true);
  assert.equal(proof.fullscreen_screenshot, false);
  assert.equal(proof.js_cdp_widget_click, false);
  assert.equal(proof.secrets_redacted, true);
  assert.equal(proof.evidence.browser_private_state_access, false);

  const primaryAttempt = buildPhysicalAssistAttemptPlan(1, null, {
    dragDurationMs: 900,
    dragSteps: 24,
    retryDragDurationMs: 1_400,
    retryDragSteps: 36,
    preInputSettleMs: 500,
  });
  assert.equal(primaryAttempt.strategy, "vision_corrected_primary");
  assert.equal(primaryAttempt.args.drag_duration_ms, 900);
  assert.equal(primaryAttempt.args.pre_input_settle_ms, 500);
  assert.equal(primaryAttempt.requested_screen_coordinates, undefined);

  const retryAttempt = buildPhysicalAssistAttemptPlan(2, {
    screen_coordinates: {
      x: 75,
      y: 314,
      to_x: 335,
      to_y: 314,
    },
    coordinate_transform: {
      vision_correction: {
        screen_estimate: {
          drag: {
            from: { x: 75, y: 314 },
            to: { x: 335, y: 314 },
          },
        },
      },
    },
  }, {
    retryDragDurationMs: 1_400,
    retryDragSteps: 36,
    preInputSettleMs: 500,
    retryOvershootX: 32,
    retryStartOffsetX: 0,
    retryStartOffsetY: 0,
    retryEndOffsetX: 0,
    retryEndOffsetY: 0,
  });
  assert.equal(retryAttempt.strategy, "retry_from_prior_vision_or_estimate_with_overshoot");
  assert.equal(retryAttempt.args.drag_duration_ms, 1_400);
  assert.equal(retryAttempt.args.drag_steps, 36);
  assert.deepEqual(retryAttempt.requested_screen_coordinates, {
    x: 75,
    y: 314,
    to_x: 367,
    to_y: 314,
    coordinate_system: "screen_pixels",
    source: "retry_from_prior_vision_or_estimate_with_overshoot",
  });
}

export { assertPhysicalLiveGateContract };
