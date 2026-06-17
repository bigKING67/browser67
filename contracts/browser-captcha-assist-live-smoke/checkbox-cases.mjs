import assert from "node:assert/strict";
import { stat } from "node:fs/promises";

import { waitFor } from "./fixtures.mjs";

function pointInsideRect(point, rect) {
  return point?.x >= rect?.left
    && point?.x <= rect?.right
    && point?.y >= rect?.top
    && point?.y <= rect?.bottom;
}

async function runCheckboxMatrixCase({
  callTool,
  fixture,
  matrixResults,
  testCase,
  toolArgs,
  workspaceKey,
}) {
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
        script: "return { path: location.pathname, has_checkbox: Boolean(document.querySelector('.cf-turnstile, [data-captcha=\"turnstile\"]')), title: document.title };",
      });
      return {
        ok: inspected?.js_return?.path === testCase.path && inspected?.js_return?.has_checkbox === true,
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
  const checkboxPlan = await callTool("browser_auth_ops", {
    ...toolArgs,
    action: "plan_captcha_assist",
    tab_id: matrixTabId,
    workspace_key: workspaceKey,
    assist_target: "checkbox",
    run_vision_correction: true,
  });
  assert.equal(checkboxPlan.status, "planned", `${testCase.name} should produce a plan`);
  assert.equal(checkboxPlan.target?.role, "checkbox", `${testCase.name} should target checkbox`);
  assert.equal(checkboxPlan.assist_target, "checkbox");
  assert.equal(checkboxPlan.coordinate_transform?.vision_correction_plan?.fullscreen_allowed, false);
  assert.equal(typeof checkboxPlan.coordinate_transform?.screen_estimate?.click?.x, "number");
  assert.equal(typeof checkboxPlan.checkbox_click_hint?.click_client?.x, "number");
  assert.equal(
    checkboxPlan.checkbox_click_hint.click_client.x < checkboxPlan.target.center_client.x,
    true,
    `${testCase.name} checkbox click hint should be left-biased instead of widget center`,
  );
  assert.equal(
    checkboxPlan.coordinate_transform?.vision_correction_plan?.correction_status,
    "success",
    `${testCase.name} checkbox vision correction should succeed: ${JSON.stringify(checkboxPlan.coordinate_transform?.vision_correction_plan)}`,
  );
  assert.equal(checkboxPlan.coordinate_transform?.vision_correction?.artifact?.fullscreen, false);
  assert.equal(typeof checkboxPlan.coordinate_transform?.vision_correction?.screen_estimate?.click?.x, "number");
  await stat(checkboxPlan.coordinate_transform.vision_correction.artifact.path);
  const fakeBox = await callTool("browser_execute_js", {
    ...toolArgs,
    tab_id: matrixTabId,
    script: `
      const rect = document.querySelector(".fake-box")?.getBoundingClientRect();
      return rect ? {
        left: rect.left,
        top: rect.top,
        right: rect.right,
        bottom: rect.bottom,
        width: rect.width,
        height: rect.height
      } : null;
    `,
  });
  const correctedClick = checkboxPlan.coordinate_transform?.vision_correction?.corrected_coordinates?.click;
  assert.equal(
    pointInsideRect(correctedClick, fakeBox?.js_return),
    true,
    `${testCase.name} corrected checkbox click should land inside the visual checkbox: ${JSON.stringify({ correctedClick, fakeBox: fakeBox?.js_return })}`,
  );
  assert.equal(checkboxPlan.plan?.some((step) => step.step === "native_mouse_click"), true);
  matrixResults.push({
    name: testCase.name,
    path: testCase.path,
    tab_id: matrixTabId,
    role: checkboxPlan.target?.role,
    captcha_kind: checkboxPlan.captcha_kind,
    click_estimate_available: typeof checkboxPlan.coordinate_transform?.screen_estimate?.click?.x === "number",
    checkbox_click_hint: checkboxPlan.checkbox_click_hint?.click_client,
    correction_status: checkboxPlan.coordinate_transform?.vision_correction_plan?.correction_status,
    detector: checkboxPlan.coordinate_transform?.vision_correction?.detector,
    confidence: checkboxPlan.coordinate_transform?.vision_correction?.confidence,
    corrected_click: correctedClick,
    device_pixel_ratio: checkboxPlan.viewport?.device_pixel_ratio,
    visual_viewport_scale: checkboxPlan.viewport?.visual_viewport?.scale,
  });
  return checkboxPlan;
}

export {
  runCheckboxMatrixCase,
};
