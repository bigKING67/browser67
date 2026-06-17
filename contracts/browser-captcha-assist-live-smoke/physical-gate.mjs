import assert from "node:assert/strict";

import { envEnabled, envNumber } from "./fixtures.mjs";

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
      drag_duration_ms: envNumber("TMWD_CAPTCHA_ASSIST_DRAG_MS", 900),
      drag_steps: envNumber("TMWD_CAPTCHA_ASSIST_DRAG_STEPS", 24),
      wait_after_ms: 5_000,
    });
    assert.equal(
      physicalAssist.status,
      "success",
      `physical assist did not report success: ${JSON.stringify(physicalAssist)}`,
    );
    assert.equal(physicalAssist.activation?.method, "tmwd_tabs_switch");
    assert.equal(typeof physicalAssist.physical_input_provider?.provider_id, "string");
    assert.equal(typeof physicalAssist.physical_input_provider_selection?.reason, "string");
    physicalCompletion = await callTool("browser_execute_js", {
      ...toolArgs,
      tab_id: tabId,
      script: "return { checked: true, slider_completed: document.body.dataset.sliderCompleted === 'true', slider_delta: document.body.dataset.sliderDelta || null, status_text: document.querySelector('#slider-status')?.textContent || null };",
    });
    assert.equal(
      physicalCompletion?.js_return?.slider_completed,
      true,
      `physical drag did not complete local slider fixture: ${JSON.stringify(physicalCompletion?.js_return ?? physicalCompletion)}`,
    );
  }

  return {
    physicalAssist,
    physicalCompletion,
  };
}

export {
  runPhysicalAssistIfEnabled,
};
