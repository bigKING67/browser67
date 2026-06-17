import assert from "node:assert/strict";
import { stat } from "node:fs/promises";

import { waitFor } from "./fixtures.mjs";

async function runSliderMatrixCase({
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
        script: `
          const frame = document.querySelector("#captcha-frame");
          let frameHasSlider = false;
          try {
            frameHasSlider = Boolean(frame?.contentDocument?.querySelector("#slider-captcha"));
          } catch {}
          return {
            path: location.pathname,
            has_slider: Boolean(document.querySelector("#slider-captcha")) || frameHasSlider,
            title: document.title
          };
        `,
      });
      return {
        ok: inspected?.js_return?.path === testCase.path && inspected?.js_return?.has_slider === true,
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
  if (testCase.prepare_script) {
    await callTool("browser_execute_js", {
      ...toolArgs,
      tab_id: matrixTabId,
      script: testCase.prepare_script,
    });
  }
  const matrixPlan = await callTool("browser_auth_ops", {
    ...toolArgs,
    action: "plan_captcha_assist",
    tab_id: matrixTabId,
    workspace_key: workspaceKey,
    assist_target: "slider",
    run_vision_correction: true,
  });
  assert.equal(matrixPlan.status, "planned", `${testCase.name} should produce a plan`);
  assert.equal(matrixPlan.target?.role, "slider", `${testCase.name} should target slider`);
  assert.equal(
    matrixPlan.coordinate_transform?.vision_correction_plan?.correction_status,
    "success",
    `${testCase.name} vision correction should succeed: ${JSON.stringify(matrixPlan.coordinate_transform?.vision_correction_plan)}`,
  );
  assert.equal(matrixPlan.coordinate_transform?.vision_correction?.artifact?.fullscreen, false);
  assert.equal(typeof matrixPlan.coordinate_transform?.vision_correction?.artifact?.sha256, "string");
  assert.equal(typeof matrixPlan.coordinate_transform?.vision_correction?.screen_estimate?.drag?.from?.x, "number");
  const correctedFrom = matrixPlan.coordinate_transform?.vision_correction?.corrected_coordinates?.drag?.from;
  const targetRect = matrixPlan.target?.rect;
  assert.equal(
    correctedFrom?.x >= targetRect?.left && correctedFrom?.x <= targetRect?.right,
    true,
    `${testCase.name} vision-corrected drag x should stay inside target rect: ${JSON.stringify({ correctedFrom, targetRect })}`,
  );
  assert.equal(
    correctedFrom?.y >= targetRect?.top && correctedFrom?.y <= targetRect?.bottom,
    true,
    `${testCase.name} vision-corrected drag y should stay inside target rect: ${JSON.stringify({ correctedFrom, targetRect })}`,
  );
  if (testCase.expect_scroll_adjusted_cdp_clip) {
    assert.equal(
      matrixPlan.coordinate_transform.vision_correction.artifact.cdp_clip.y
        > matrixPlan.coordinate_transform.vision_correction.artifact.clip.y,
      true,
      `${testCase.name} should add scroll offset to CDP capture clip`,
    );
  }
  if (testCase.expected_frame_path) {
    assert.equal(
      String(matrixPlan.target?.frame_path ?? "").includes(testCase.expected_frame_path),
      true,
      `${testCase.name} should report same-origin iframe frame_path: ${String(matrixPlan.target?.frame_path ?? "")}`,
    );
  }
  if (testCase.expect_device_pixel_ratio) {
    assert.equal(
      typeof matrixPlan.viewport?.device_pixel_ratio,
      "number",
      `${testCase.name} should expose devicePixelRatio to review coordinates`,
    );
  }
  if (testCase.expect_visual_viewport) {
    assert.equal(
      typeof matrixPlan.viewport?.visual_viewport?.scale,
      "number",
      `${testCase.name} should expose visualViewport scale to review coordinates`,
    );
  }
  await stat(matrixPlan.coordinate_transform.vision_correction.artifact.path);
  matrixResults.push({
    name: testCase.name,
    path: testCase.path,
    tab_id: matrixTabId,
    frame_path: matrixPlan.target?.frame_path,
    correction_status: matrixPlan.coordinate_transform?.vision_correction_plan?.correction_status,
    detector: matrixPlan.coordinate_transform?.vision_correction?.detector,
    confidence: matrixPlan.coordinate_transform?.vision_correction?.confidence,
    artifact_sha256: matrixPlan.coordinate_transform?.vision_correction?.artifact?.sha256,
    cdp_clip: matrixPlan.coordinate_transform?.vision_correction?.artifact?.cdp_clip,
    device_pixel_ratio: matrixPlan.viewport?.device_pixel_ratio,
    visual_viewport_scale: matrixPlan.viewport?.visual_viewport?.scale,
  });
  return matrixPlan;
}

export {
  runSliderMatrixCase,
};
