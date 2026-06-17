import assert from "node:assert/strict";

import { envEnabled, envNumber } from "./fixtures.mjs";

function compactPhysicalAssist(physicalAssist = {}) {
  return {
    status: physicalAssist.status,
    reason: physicalAssist.reason,
    activation: physicalAssist.activation
      ? {
        method: physicalAssist.activation.method,
        status: physicalAssist.activation.status,
        provider_selection: physicalAssist.activation.provider_selection,
        provider: physicalAssist.activation.provider,
      }
      : undefined,
    provider: physicalAssist.physical_input_provider
      ? {
        provider_id: physicalAssist.physical_input_provider.provider_id,
        platform: physicalAssist.physical_input_provider.platform,
        driver: physicalAssist.physical_input_provider.driver,
        supported_actions: physicalAssist.physical_input_provider.supported_actions,
      }
      : undefined,
    provider_selection: physicalAssist.physical_input_provider_selection,
    native_input: physicalAssist.native_input
      ? {
        status: physicalAssist.native_input.status,
        action: physicalAssist.native_input.action,
        platform: physicalAssist.native_input.platform,
        driver: physicalAssist.native_input.driver,
        from_x: physicalAssist.native_input.from_x,
        from_y: physicalAssist.native_input.from_y,
        to_x: physicalAssist.native_input.to_x,
        to_y: physicalAssist.native_input.to_y,
        duration_ms: physicalAssist.native_input.duration_ms,
        steps: physicalAssist.native_input.steps,
        command_sequence: physicalAssist.native_input.command_sequence,
        pre_move: physicalAssist.native_input.pre_move,
        wait_ms: physicalAssist.native_input.wait_ms,
      }
      : undefined,
    screen_coordinates: physicalAssist.screen_coordinates,
    waited_ms: physicalAssist.waited_ms,
    target: physicalAssist.target
      ? {
        role: physicalAssist.target.role,
        confidence: physicalAssist.target.confidence,
        rect: physicalAssist.target.rect,
        frame_path: physicalAssist.target.frame_path,
      }
      : undefined,
    viewport: physicalAssist.viewport,
    slider_drag_hint: physicalAssist.slider_drag_hint,
    coordinate_transform: physicalAssist.coordinate_transform
      ? {
        source_coordinate_system: physicalAssist.coordinate_transform.source_coordinate_system,
        target_coordinate_system: physicalAssist.coordinate_transform.target_coordinate_system,
        viewport_origin_screen_estimate: physicalAssist.coordinate_transform.viewport_origin_screen_estimate,
        screen_estimate: physicalAssist.coordinate_transform.screen_estimate,
        vision_correction_plan: physicalAssist.coordinate_transform.vision_correction_plan,
        vision_correction: physicalAssist.coordinate_transform.vision_correction
          ? {
            correction_status: physicalAssist.coordinate_transform.vision_correction.correction_status,
            confidence: physicalAssist.coordinate_transform.vision_correction.confidence,
            detector: physicalAssist.coordinate_transform.vision_correction.detector,
            detector_kind: physicalAssist.coordinate_transform.vision_correction.detector_kind,
            component: physicalAssist.coordinate_transform.vision_correction.component,
            image_to_viewport_scale: physicalAssist.coordinate_transform.vision_correction.image_to_viewport_scale,
            corrected_coordinates: physicalAssist.coordinate_transform.vision_correction.corrected_coordinates,
            screen_estimate: physicalAssist.coordinate_transform.vision_correction.screen_estimate,
            artifact: physicalAssist.coordinate_transform.vision_correction.artifact
              ? {
                path: physicalAssist.coordinate_transform.vision_correction.artifact.path,
                sha256: physicalAssist.coordinate_transform.vision_correction.artifact.sha256,
                clip: physicalAssist.coordinate_transform.vision_correction.artifact.clip,
                cdp_clip: physicalAssist.coordinate_transform.vision_correction.artifact.cdp_clip,
                fullscreen: physicalAssist.coordinate_transform.vision_correction.artifact.fullscreen,
                width: physicalAssist.coordinate_transform.vision_correction.artifact.width,
                height: physicalAssist.coordinate_transform.vision_correction.artifact.height,
              }
              : undefined,
          }
          : undefined,
      }
      : undefined,
  };
}

function physicalDiagnostics(physicalAssist, physicalCompletion) {
  return {
    physical_assist: compactPhysicalAssist(physicalAssist),
    physical_completion: physicalCompletion?.js_return ?? physicalCompletion,
  };
}

function physicalGateError(message, physicalAssist, physicalCompletion) {
  const error = new Error(`${message}: ${JSON.stringify(physicalDiagnostics(physicalAssist, physicalCompletion))}`);
  error.details = {
    physical_diagnostics: physicalDiagnostics(physicalAssist, physicalCompletion),
  };
  return error;
}

async function runPhysicalAssistIfEnabled({
  callTool,
  tabId,
  toolArgs,
  workspaceKey,
}) {
  let physicalAssist = {
    status: "skipped",
    reason: "set TMWD_CAPTCHA_ASSIST_PHYSICAL=1 and TMWD_CAPTCHA_ASSIST_CONFIRM=1 to opt in",
  };
  let physicalCompletion = { checked: false };
  if (envEnabled("TMWD_CAPTCHA_ASSIST_PHYSICAL")) {
    assert.equal(
      envEnabled("TMWD_CAPTCHA_ASSIST_CONFIRM"),
      true,
      "physical CAPTCHA assist requires TMWD_CAPTCHA_ASSIST_CONFIRM=1",
    );
    const dragDurationMs = envNumber("TMWD_CAPTCHA_ASSIST_DRAG_MS", 900);
    const dragSteps = envNumber("TMWD_CAPTCHA_ASSIST_DRAG_STEPS", 24);
    physicalAssist = await callTool("browser_auth_ops", {
      ...toolArgs,
      action: "assist_captcha",
      tab_id: tabId,
      workspace_key: workspaceKey,
      assist_target: "slider",
      run_vision_correction: true,
      use_vision_corrected_coordinates: true,
      confirm_corrected_coordinates: true,
      confirm_physical_input: true,
      drag_duration_ms: dragDurationMs,
      drag_steps: dragSteps,
      wait_after_ms: 5_000,
    });
    if (physicalAssist.status !== "success") {
      throw physicalGateError("physical assist did not report success", physicalAssist, physicalCompletion);
    }
    if (physicalAssist.activation?.method !== "tmwd_tabs_switch") {
      throw physicalGateError("physical assist did not activate managed tab via TMWD switch", physicalAssist, physicalCompletion);
    }
    if (typeof physicalAssist.physical_input_provider?.provider_id !== "string") {
      throw physicalGateError("physical assist did not report physical input provider id", physicalAssist, physicalCompletion);
    }
    if (typeof physicalAssist.physical_input_provider_selection?.reason !== "string") {
      throw physicalGateError("physical assist did not report provider selection reason", physicalAssist, physicalCompletion);
    }
    physicalCompletion = await callTool("browser_execute_js", {
      ...toolArgs,
      tab_id: tabId,
      script: "return { checked: true, slider_completed: document.body.dataset.sliderCompleted === 'true', slider_delta: document.body.dataset.sliderDelta || null, status_text: document.querySelector('#slider-status')?.textContent || null };",
    });
    if (physicalCompletion?.js_return?.slider_completed !== true) {
      throw physicalGateError("physical drag did not complete local slider fixture", physicalAssist, physicalCompletion);
    }
  }

  return {
    physicalAssist,
    physicalCompletion,
  };
}

export {
  compactPhysicalAssist,
  physicalDiagnostics,
  runPhysicalAssistIfEnabled,
};
