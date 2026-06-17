import assert from "node:assert/strict";

import { waitFor } from "./fixtures.mjs";

async function runCrossOriginIframeCase({
  callTool,
  fixture,
  matrixResults,
  toolArgs,
  workspaceKey,
}) {
  const testCase = {
    name: "cross_origin_iframe",
    path: "/slider-login-cross-origin-iframe",
  };
  const managed = await callTool("browser_tab_lifecycle", {
    ...toolArgs,
    action: "select_or_create",
    url: `${fixture.origin}${testCase.path}`,
    workspace_key: workspaceKey,
    fresh: true,
    active: true,
    wait_until: "listed",
    wait_timeout_ms: 5_000,
    wait_poll_ms: 100,
  });
  const matrixTabId = String(managed?.managed_tab?.tab_id ?? "");
  assert.ok(matrixTabId, `${testCase.name} did not return managed tab id`);
  const ready = await waitFor(async () => {
    try {
      const inspected = await callTool("browser_execute_js", {
        ...toolArgs,
        tab_id: matrixTabId,
        script: `
          const frame = document.querySelector("#captcha-frame");
          return {
            path: location.pathname,
            has_frame: Boolean(frame),
            frame_src: frame?.src || null,
            cross_origin: Boolean(frame?.src) && new URL(frame.src).origin !== location.origin,
            title: document.title
          };
        `,
      });
      return {
        ok: inspected?.js_return?.path === testCase.path
          && inspected?.js_return?.has_frame === true
          && inspected?.js_return?.cross_origin === true,
        inspected,
      };
    } catch (error) {
      return {
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }, 5_000);
  assert.equal(ready.ok, true, `${testCase.name} fixture did not settle: ${JSON.stringify(ready.inspected)}`);
  const degradedPlan = await callTool("browser_auth_ops", {
    ...toolArgs,
    action: "plan_captcha_assist",
    tab_id: matrixTabId,
    workspace_key: workspaceKey,
  });
  assert.equal(degradedPlan.status, "planned", `${testCase.name} should produce a degraded plan`);
  assert.equal(degradedPlan.target?.frame_access, "cross_origin_uninspectable");
  assert.equal(degradedPlan.target?.degraded_mode, true);
  assert.equal(degradedPlan.degraded_mode, true);
  assert.equal(degradedPlan.manual_handoff_required, true);
  assert.equal(degradedPlan.degraded_reason, "cross_origin_frame_uninspectable");
  assert.equal(degradedPlan.coordinate_transform?.vision_correction_plan?.fullscreen_allowed, false);
  assert.equal(typeof degradedPlan.coordinate_transform?.vision_correction_plan?.screenshot_clip?.x, "number");
  assert.equal(degradedPlan.plan?.some((step) => step.step === "manual_user_handoff"), true);
  assert.equal(degradedPlan.plan?.some((step) => step.step === "native_mouse_click"), false);
  assert.equal(degradedPlan.plan?.some((step) => step.step === "native_mouse_drag"), false);
  assert.equal(degradedPlan.blocked_if?.includes("cross_origin_frame_uninspectable"), true);
  assert.equal(degradedPlan.blocked_if?.includes("manual_user_handoff_required"), true);
  const blockedAssist = await callTool("browser_auth_ops", {
    ...toolArgs,
    action: "assist_captcha",
    tab_id: matrixTabId,
    workspace_key: workspaceKey,
    confirm_physical_input: true,
    auto_screen_coordinates: true,
    confirm_auto_coordinates: true,
  });
  assert.equal(blockedAssist.status, "blocked", `${testCase.name} assist should block`);
  assert.equal(blockedAssist.reason, "cross_origin_frame_handoff_required");
  assert.equal(blockedAssist.executed, false);
  matrixResults.push({
    name: testCase.name,
    path: testCase.path,
    tab_id: matrixTabId,
    frame_access: degradedPlan.target?.frame_access,
    degraded_mode: degradedPlan.degraded_mode,
    manual_handoff_required: degradedPlan.manual_handoff_required,
    assist_block_reason: blockedAssist.reason,
    screenshot_clip_available: typeof degradedPlan.coordinate_transform?.vision_correction_plan?.screenshot_clip?.x === "number",
  });
  return degradedPlan;
}

export {
  runCrossOriginIframeCase,
};
