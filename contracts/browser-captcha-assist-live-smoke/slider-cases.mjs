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
  const sliderSelector = String(testCase.slider_selector ?? "#slider-captcha");
  const ready = await waitFor(async () => {
    try {
      const inspected = await callTool("browser_execute_js", {
        ...toolArgs,
        tab_id: matrixTabId,
        script: `
          const frame = document.querySelector("#captcha-frame");
          const sliderSelector = ${JSON.stringify(sliderSelector)};
          let frameHasSlider = false;
          try {
            frameHasSlider = Boolean(frame?.contentDocument?.querySelector(sliderSelector));
          } catch {}
          return {
            path: location.pathname,
            has_slider: Boolean(document.querySelector(sliderSelector)) || frameHasSlider,
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
  if (testCase.expect_track_rect) {
    assert.equal(typeof matrixPlan.target?.track_rect?.width, "number", `${testCase.name} should expose slider track rect`);
    assert.equal(
      matrixPlan.target.track_rect.width > matrixPlan.target.rect.width,
      true,
      `${testCase.name} track should be wider than the handle`,
    );
    assert.equal(matrixPlan.slider_drag_hint?.method, "track_rect_with_completion_overshoot");
    assert.equal(matrixPlan.coordinate_transform?.screenshot_clip_source, "slider_track_rect");
    assert.equal(
      matrixPlan.coordinate_transform.vision_correction_plan.screenshot_clip.width
        > matrixPlan.target.rect.width,
      true,
      `${testCase.name} vision clip should include the full track`,
    );
  }
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

async function runSliderVisualFeedbackCase({
  callTool,
  fixture,
  matrixResults,
  toolArgs,
  workspaceKey,
}) {
  const managed = await callTool("browser_tab_lifecycle", {
    ...toolArgs,
    action: "select_or_create",
    url: `${fixture.origin}/slider-login`,
    workspace_key: workspaceKey,
    fresh: true,
    active: true,
    wait_until: "listed",
    wait_timeout_ms: 5_000,
    wait_poll_ms: 100,
  });
  const visualTabId = String(managed?.managed_tab?.tab_id ?? "");
  assert.ok(visualTabId, "visual feedback case did not return managed tab id");
  const ready = await waitFor(async () => {
    try {
      const inspected = await callTool("browser_execute_js", {
        ...toolArgs,
        tab_id: visualTabId,
        script: "return { path: location.pathname, has_slider: Boolean(document.querySelector('#slider-captcha')), has_handle: Boolean(document.querySelector('#slider-handle')) };",
      });
      return {
        ok: inspected?.js_return?.path === "/slider-login"
          && inspected?.js_return?.has_slider === true
          && inspected?.js_return?.has_handle === true,
        inspected,
      };
    } catch (error) {
      return {
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }, 5_000);
  assert.equal(ready.ok, true, `visual feedback fixture did not settle: ${JSON.stringify(ready.inspected)}`);

  const visualDrag = await callTool("browser_execute_js", {
    ...toolArgs,
    tab_id: visualTabId,
    script: `
      const root = document.querySelector("#slider-captcha");
      const handle = document.querySelector("#slider-handle");
      const rootRect = root.getBoundingClientRect();
      const handleRect = handle.getBoundingClientRect();
      const pointerSupported = typeof PointerEvent === "function";
      const EventCtor = pointerSupported ? PointerEvent : MouseEvent;
      const eventType = pointerSupported ? "pointer" : "mouse";
      const emit = (target, type, x) => {
        target.dispatchEvent(new EventCtor(type, {
          bubbles: true,
          cancelable: true,
          clientX: x,
          clientY: rootRect.top + rootRect.height / 2,
          pointerId: 1,
          pointerType: "mouse",
          buttons: type.endsWith("up") ? 0 : 1,
        }));
      };
      const startX = handleRect.left + handleRect.width / 2;
      const endX = rootRect.left + 300;
      emit(handle, eventType + "down", startX);
      emit(window, eventType + "move", rootRect.left + 160);
      emit(window, eventType + "move", endX);
      emit(window, eventType + "up", endX);
      const finalRootRect = root.getBoundingClientRect();
      const finalHandleRect = handle.getBoundingClientRect();
      return {
        event_type: eventType,
        slider_completed: document.body.dataset.sliderCompleted === "true",
        slider_delta: document.body.dataset.sliderDelta || null,
        slider_delta_live: document.body.dataset.sliderDeltaLive || null,
        slider_visual_offset: Math.round(finalHandleRect.left - finalRootRect.left - 2),
        handle_transform: handle.style.transform || null,
        status_text: document.querySelector("#slider-status")?.textContent || null,
      };
    `,
  });
  const result = visualDrag?.js_return ?? {};
  assert.equal(result.slider_completed, true, `synthetic drag should complete the visual fixture: ${JSON.stringify(result)}`);
  assert.equal(
    Number(result.slider_visual_offset) >= 180,
    true,
    `synthetic drag should visibly move the slider handle: ${JSON.stringify(result)}`,
  );
  assert.match(String(result.handle_transform ?? ""), /translateX\(\d+px\)/);
  assert.equal(result.status_text, "completed");
  matrixResults.push({
    name: "visual_feedback",
    path: "/slider-login",
    tab_id: visualTabId,
    event_type: result.event_type,
    slider_completed: result.slider_completed,
    slider_delta: result.slider_delta,
    slider_delta_live: result.slider_delta_live,
    slider_visual_offset: result.slider_visual_offset,
    handle_transform: result.handle_transform,
  });
  return result;
}

export {
  runSliderMatrixCase,
  runSliderVisualFeedbackCase,
};
