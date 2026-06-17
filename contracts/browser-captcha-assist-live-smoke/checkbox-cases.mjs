import assert from "node:assert/strict";

import { waitFor } from "./fixtures.mjs";

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
  });
  assert.equal(checkboxPlan.status, "planned", `${testCase.name} should produce a plan`);
  assert.equal(checkboxPlan.target?.role, "checkbox", `${testCase.name} should target checkbox`);
  assert.equal(checkboxPlan.assist_target, "checkbox");
  assert.equal(checkboxPlan.coordinate_transform?.vision_correction_plan?.fullscreen_allowed, false);
  assert.equal(typeof checkboxPlan.coordinate_transform?.screen_estimate?.click?.x, "number");
  assert.equal(checkboxPlan.plan?.some((step) => step.step === "native_mouse_click"), true);
  matrixResults.push({
    name: testCase.name,
    path: testCase.path,
    tab_id: matrixTabId,
    role: checkboxPlan.target?.role,
    captcha_kind: checkboxPlan.captcha_kind,
    click_estimate_available: typeof checkboxPlan.coordinate_transform?.screen_estimate?.click?.x === "number",
    device_pixel_ratio: checkboxPlan.viewport?.device_pixel_ratio,
    visual_viewport_scale: checkboxPlan.viewport?.visual_viewport?.scale,
  });
  return checkboxPlan;
}

export {
  runCheckboxMatrixCase,
};
