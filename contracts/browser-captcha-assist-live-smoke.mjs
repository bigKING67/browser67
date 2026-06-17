#!/usr/bin/env node
import assert from "node:assert/strict";
import { mkdtemp, rm, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { runCheckboxMatrixCase } from "./browser-captcha-assist-live-smoke/checkbox-cases.mjs";
import { commonArgs, parseArgs } from "./browser-captcha-assist-live-smoke/cli.mjs";
import { runCrossOriginIframeCase } from "./browser-captcha-assist-live-smoke/cross-origin-case.mjs";
import {
  envEnabled,
  startSliderFixture,
  waitFor,
} from "./browser-captcha-assist-live-smoke/fixtures.mjs";
import {
  compactPhysicalAssist,
  runPhysicalAssistIfEnabled,
} from "./browser-captcha-assist-live-smoke/physical-gate.mjs";
import { createCaptchaSmokeRpc } from "./browser-captcha-assist-live-smoke/rpc.mjs";
import {
  runSliderMatrixCase,
  runSliderVisualFeedbackCase,
} from "./browser-captcha-assist-live-smoke/slider-cases.mjs";

function compactCoordinateSummary(plan = {}) {
  return {
    target: plan.target
      ? {
        role: plan.target.role,
        confidence: plan.target.confidence,
        rect: plan.target.rect,
        frame_path: plan.target.frame_path,
      }
      : undefined,
    viewport: plan.viewport,
    slider_drag_hint: plan.slider_drag_hint,
    checkbox_click_hint: plan.checkbox_click_hint,
    coordinate_transform: plan.coordinate_transform
      ? {
        viewport_origin_screen_estimate: plan.coordinate_transform.viewport_origin_screen_estimate,
        click_hint: plan.coordinate_transform.click_hint,
        screen_estimate: plan.coordinate_transform.screen_estimate,
        vision_correction_plan: plan.coordinate_transform.vision_correction_plan
          ? {
            status: plan.coordinate_transform.vision_correction_plan.status,
            correction_status: plan.coordinate_transform.vision_correction_plan.correction_status,
            screenshot_clip: plan.coordinate_transform.vision_correction_plan.screenshot_clip,
            fullscreen_allowed: plan.coordinate_transform.vision_correction_plan.fullscreen_allowed,
            executable_region_capture_available: plan.coordinate_transform.vision_correction_plan.executable_region_capture_available,
          }
          : undefined,
        vision_correction: plan.coordinate_transform.vision_correction
          ? {
            correction_status: plan.coordinate_transform.vision_correction.correction_status,
            confidence: plan.coordinate_transform.vision_correction.confidence,
            detector: plan.coordinate_transform.vision_correction.detector,
            detector_kind: plan.coordinate_transform.vision_correction.detector_kind,
            component: plan.coordinate_transform.vision_correction.component,
            image_to_viewport_scale: plan.coordinate_transform.vision_correction.image_to_viewport_scale,
            corrected_coordinates: plan.coordinate_transform.vision_correction.corrected_coordinates,
            screen_estimate: plan.coordinate_transform.vision_correction.screen_estimate,
            artifact: plan.coordinate_transform.vision_correction.artifact
              ? {
                path: plan.coordinate_transform.vision_correction.artifact.path,
                sha256: plan.coordinate_transform.vision_correction.artifact.sha256,
                clip: plan.coordinate_transform.vision_correction.artifact.clip,
                cdp_clip: plan.coordinate_transform.vision_correction.artifact.cdp_clip,
                fullscreen: plan.coordinate_transform.vision_correction.artifact.fullscreen,
                width: plan.coordinate_transform.vision_correction.artifact.width,
                height: plan.coordinate_transform.vision_correction.artifact.height,
              }
              : undefined,
          }
          : undefined,
      }
      : undefined,
  };
}

async function run() {
  const cli = parseArgs(process.argv.slice(2));
  const toolArgs = commonArgs(cli);
  const registryDir = await mkdtemp(path.join(os.tmpdir(), "tmwd-captcha-assist-live-registry-"));
  const previousRegistryPath = process.env.BROWSER_STRUCTURED_TAB_REGISTRY_PATH;
  process.env.BROWSER_STRUCTURED_TAB_REGISTRY_PATH = path.join(registryDir, "managed-tabs.json");

  const fixture = await startSliderFixture();
  const rpcClient = createCaptchaSmokeRpc(cli);
  const { callTool } = rpcClient;
  const workspaceKey = `captcha-assist-live-${String(Date.now())}`;
  const matrixResults = [];

  try {
    await rpcClient.initialize();

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
    const tabId = String(managed?.managed_tab?.tab_id ?? "");
    assert.ok(tabId, "captcha assist live gate did not return managed tab id");
    assert.equal(managed.created, true, "captcha assist live gate should create an isolated managed tab");

    const sliderReady = await waitFor(async () => {
      try {
        const inspected = await callTool("browser_execute_js", {
          ...toolArgs,
          tab_id: tabId,
          script: "return { path: location.pathname, has_slider: Boolean(document.querySelector('#slider-captcha')), title: document.title };",
        });
        return {
          ok: inspected?.js_return?.path === "/slider-login" && inspected?.js_return?.has_slider === true,
          inspected,
        };
      } catch (error) {
        return {
          ok: false,
          error: error instanceof Error ? error.message : String(error),
        };
      }
    }, 5_000);
    assert.equal(
      sliderReady.ok,
      true,
      `slider fixture did not settle: ${JSON.stringify(sliderReady.inspected)}`,
    );

    const plan = await callTool("browser_auth_ops", {
      ...toolArgs,
      action: "plan_captcha_assist",
      tab_id: tabId,
      workspace_key: workspaceKey,
      assist_target: "slider",
    });
    assert.equal(plan.status, "planned", "slider CAPTCHA assist should produce a dry-run plan");
    assert.equal(plan.action, "plan_captcha_assist");
    assert.equal(plan.captcha_kind, "slider");
    assert.equal(plan.assist_target, "slider");
    assert.equal(plan.executed, false);
    assert.equal(plan.coordinate_transform?.source_coordinate_system, "viewport_css_pixels");
    assert.equal(plan.coordinate_transform?.target_coordinate_system, "screen_pixels");
    assert.equal(plan.coordinate_transform?.safe_to_auto_execute_without_confirmation, false);
    assert.equal(plan.coordinate_transform?.can_use_with_explicit_confirmation, true);
    assert.equal(plan.coordinate_transform?.vision_correction_plan?.fullscreen_allowed, false);
    assert.equal(typeof plan.coordinate_transform?.vision_correction_plan?.screenshot_clip?.x, "number");
    assert.equal(typeof plan.slider_drag_hint?.from_client?.x, "number");
    assert.equal(typeof plan.slider_drag_hint?.to_client?.x, "number");
    assert.equal(typeof plan.coordinate_transform?.screen_estimate?.drag?.from?.x, "number");
    assert.equal(typeof plan.coordinate_transform?.screen_estimate?.drag?.to?.x, "number");
    assert.equal(typeof plan.coordinate_support?.native_drag_supported, "boolean");
    assert.equal(typeof plan.coordinate_support?.physical_drag_supported, "boolean");
    assert.equal(typeof plan.physical_input?.provider_selection?.reason, "string");
    assert.equal(plan.physical_input?.capture_provider_selection?.action, "capture_window_region");
    assert.equal(typeof plan.physical_input?.capture_provider_selection?.reason, "string");
    assert.equal(
      plan.physical_input?.providers?.some((provider) => provider.provider_id === "native-os"),
      true,
    );
    assert.equal(
      plan.physical_input?.providers?.some((provider) => provider.provider_id === "ljq-ctrl"),
      true,
    );
    assert.equal(plan.coordinate_transform?.vision_correction_plan?.correction_status, "not_run");
    assert.equal(
      typeof plan.coordinate_transform?.vision_correction_plan?.executable_region_capture_available,
      "boolean",
    );
    assert.equal(plan.blocked_if?.includes("multi_round_image_or_puzzle"), true);
    assert.equal(plan.blocked_if?.includes("target_window_not_active"), true);

    const visionPlan = await callTool("browser_auth_ops", {
      ...toolArgs,
      action: "plan_captcha_assist",
      tab_id: tabId,
      workspace_key: workspaceKey,
      assist_target: "slider",
      run_vision_correction: true,
    });
    assert.equal(visionPlan.status, "planned", "vision CAPTCHA assist should keep dry-run plan shape");
    assert.equal(
      visionPlan.coordinate_transform?.vision_correction_plan?.correction_status,
      "success",
      `slider vision correction should succeed on local fixture: ${JSON.stringify(visionPlan.coordinate_transform?.vision_correction_plan)}`,
    );
    assert.equal(
      visionPlan.coordinate_transform?.vision_correction_plan?.fullscreen_allowed,
      false,
    );
    assert.equal(
      visionPlan.coordinate_transform?.vision_correction?.artifact?.fullscreen,
      false,
    );
    assert.equal(
      typeof visionPlan.coordinate_transform?.vision_correction?.artifact?.sha256,
      "string",
    );
    assert.equal(
      typeof visionPlan.coordinate_transform?.vision_correction?.screen_estimate?.drag?.from?.x,
      "number",
    );
    const correctedFrom = visionPlan.coordinate_transform?.vision_correction?.corrected_coordinates?.drag?.from;
    const targetRect = visionPlan.target?.rect;
    assert.equal(
      correctedFrom?.x >= targetRect?.left && correctedFrom?.x <= targetRect?.right,
      true,
      `main slider vision-corrected drag x should stay inside target rect: ${JSON.stringify({ correctedFrom, targetRect })}`,
    );
    assert.equal(
      correctedFrom?.y >= targetRect?.top && correctedFrom?.y <= targetRect?.bottom,
      true,
      `main slider vision-corrected drag y should stay inside target rect: ${JSON.stringify({ correctedFrom, targetRect })}`,
    );
    await stat(visionPlan.coordinate_transform.vision_correction.artifact.path);

    const confirmBlocked = await callTool("browser_auth_ops", {
      ...toolArgs,
      action: "assist_captcha",
      tab_id: tabId,
      workspace_key: workspaceKey,
      assist_target: "slider",
    });
    assert.equal(confirmBlocked.status, "blocked", "assist_captcha should require explicit physical input confirmation");
    assert.equal(confirmBlocked.reason, "confirm_physical_input_required");
    assert.equal(confirmBlocked.executed, false);

    const autoCoordinateConfirmBlocked = await callTool("browser_auth_ops", {
      ...toolArgs,
      action: "assist_captcha",
      tab_id: tabId,
      workspace_key: workspaceKey,
      assist_target: "slider",
      confirm_physical_input: true,
      auto_screen_coordinates: true,
    });
    assert.equal(
      autoCoordinateConfirmBlocked.status,
      "blocked",
      "auto screen coordinates should require a separate confirmation",
    );
    assert.equal(autoCoordinateConfirmBlocked.reason, "confirm_auto_coordinates_required");
    assert.equal(autoCoordinateConfirmBlocked.executed, false);

    const correctedCoordinateConfirmBlocked = await callTool("browser_auth_ops", {
      ...toolArgs,
      action: "assist_captcha",
      tab_id: tabId,
      workspace_key: workspaceKey,
      assist_target: "slider",
      run_vision_correction: true,
      confirm_physical_input: true,
      use_vision_corrected_coordinates: true,
    });
    assert.equal(
      correctedCoordinateConfirmBlocked.status,
      "blocked",
      "vision-corrected coordinates should require a separate confirmation",
    );
    assert.equal(correctedCoordinateConfirmBlocked.reason, "confirm_corrected_coordinates_required");
    assert.equal(correctedCoordinateConfirmBlocked.executed, false);

    const blockedAssistSideEffect = await callTool("browser_execute_js", {
      ...toolArgs,
      tab_id: tabId,
      script: "return { slider_completed: document.body.dataset.sliderCompleted === 'true', slider_delta: document.body.dataset.sliderDelta || null };",
    });
    assert.equal(
      blockedAssistSideEffect?.js_return?.slider_completed,
      false,
      "blocked assist calls must not move the slider",
    );

    await runSliderMatrixCase({
      callTool,
      fixture,
      matrixResults,
      testCase: {
        name: "scroll",
        path: "/slider-login-scroll",
        prepare_script: "document.querySelector('#slider-captcha')?.scrollIntoView({ block: 'center' }); return { path: location.pathname, scroll_y: window.scrollY, has_slider: Boolean(document.querySelector('#slider-captcha')) };",
        expect_scroll_adjusted_cdp_clip: true,
      },
      toolArgs,
      workspaceKey,
    });
    await runSliderMatrixCase({
      callTool,
      fixture,
      matrixResults,
      testCase: {
        name: "same_origin_iframe",
        path: "/slider-login-iframe",
        expected_frame_path: "iframe#captcha-frame",
      },
      toolArgs,
      workspaceKey,
    });
    await runSliderMatrixCase({
      callTool,
      fixture,
      matrixResults,
      testCase: {
        name: "zoom",
        path: "/slider-login-zoom",
        expect_visual_viewport: true,
        expect_device_pixel_ratio: true,
      },
      toolArgs,
      workspaceKey,
    });
    await runSliderMatrixCase({
      callTool,
      fixture,
      matrixResults,
      testCase: {
        name: "gray",
        path: "/slider-login-gray",
        expect_device_pixel_ratio: true,
      },
      toolArgs,
      workspaceKey,
    });
    await runSliderMatrixCase({
      callTool,
      fixture,
      matrixResults,
      testCase: {
        name: "canvas",
        path: "/slider-login-canvas",
        expect_device_pixel_ratio: true,
      },
      toolArgs,
      workspaceKey,
    });
    await runSliderVisualFeedbackCase({
      callTool,
      fixture,
      matrixResults,
      toolArgs,
      workspaceKey,
    });
    await runCheckboxMatrixCase({
      callTool,
      fixture,
      matrixResults,
      testCase: {
        name: "checkbox_turnstile",
        path: "/checkbox-turnstile",
      },
      toolArgs,
      workspaceKey,
    });
    await runCrossOriginIframeCase({
      callTool,
      fixture,
      matrixResults,
      toolArgs,
      workspaceKey,
    });

    const {
      physicalAssist,
      physicalCompletion,
      physicalAttempts,
      checkboxPhysicalAssist,
      checkboxPhysicalCompletion,
      checkboxPhysicalAttempts,
    } = await runPhysicalAssistIfEnabled({
      callTool,
      fixture,
      tabId,
      toolArgs,
      workspaceKey,
    });

    const finalize = await callTool("browser_tab_lifecycle", {
      ...toolArgs,
      action: "finalize_task",
      workspace_key: workspaceKey,
      prune_stale: false,
    });
    assert.equal(
      finalize.close_unkept.closed.some((row) => String(row?.tab_id ?? "") === tabId && row.closed === true),
      true,
      "captcha assist live gate finalize_task did not close managed tab",
    );

    return {
      ok: true,
      planning_only: !envEnabled("TMWD_CAPTCHA_ASSIST_PHYSICAL"),
      workspace_key: workspaceKey,
      tab_id: tabId,
      captcha_kind: plan.captcha_kind,
      native_drag_supported: plan.coordinate_support?.native_drag_supported,
      auto_estimate_available: plan.coordinate_transform?.auto_estimate_available,
      vision_clip_planned: plan.coordinate_transform?.vision_correction_plan?.status === "planned",
      vision_correction_status: visionPlan.coordinate_transform?.vision_correction_plan?.correction_status,
      vision_artifact_sha256: visionPlan.coordinate_transform?.vision_correction?.artifact?.sha256,
      planning_coordinate_summary: compactCoordinateSummary(plan),
      vision_coordinate_summary: compactCoordinateSummary(visionPlan),
      assist_safety_blocks: {
        confirm_physical_input: confirmBlocked.reason,
        confirm_auto_coordinates: autoCoordinateConfirmBlocked.reason,
        confirm_corrected_coordinates: correctedCoordinateConfirmBlocked.reason,
        no_slider_side_effect: blockedAssistSideEffect?.js_return?.slider_completed === false,
      },
      matrix_results: matrixResults,
      physical_assist_status: physicalAssist.status,
      physical_assist_reason: physicalAssist.reason,
      physical_assist_provider_id: physicalAssist.physical_input_provider?.provider_id ?? null,
      physical_assist_provider_selection_reason: physicalAssist.physical_input_provider_selection?.reason ?? null,
      physical_assist_coordinates_source: physicalAssist.screen_coordinates?.source ?? null,
      physical_assist_diagnostics: compactPhysicalAssist(physicalAssist),
      physical_attempt_count: physicalAttempts.length,
      physical_attempts: physicalAttempts,
      physical_completion: physicalCompletion?.js_return ?? physicalCompletion,
      checkbox_physical_required: envEnabled("TMWD_CAPTCHA_ASSIST_PHYSICAL"),
      checkbox_physical_assist_status: checkboxPhysicalAssist.status,
      checkbox_physical_assist_reason: checkboxPhysicalAssist.reason,
      checkbox_physical_assist_provider_id: checkboxPhysicalAssist.physical_input_provider?.provider_id ?? null,
      checkbox_physical_assist_provider_selection_reason: checkboxPhysicalAssist.physical_input_provider_selection?.reason ?? null,
      checkbox_physical_assist_coordinates_source: checkboxPhysicalAssist.screen_coordinates?.source ?? null,
      checkbox_physical_assist_diagnostics: compactPhysicalAssist(checkboxPhysicalAssist),
      checkbox_physical_attempt_count: checkboxPhysicalAttempts.length,
      checkbox_physical_attempts: checkboxPhysicalAttempts,
      checkbox_physical_completion: checkboxPhysicalCompletion?.js_return ?? checkboxPhysicalCompletion,
      finalized_closed: finalize.close_unkept.closed.length,
    };
  } finally {
    try {
      await callTool("browser_tab_lifecycle", {
        ...toolArgs,
        action: "finalize_task",
        workspace_key: workspaceKey,
        prune_stale: false,
      });
    } catch {
      // Best effort cleanup only.
    }
    await rpcClient.close();
    await fixture.close();
    if (previousRegistryPath === undefined) {
      delete process.env.BROWSER_STRUCTURED_TAB_REGISTRY_PATH;
    } else {
      process.env.BROWSER_STRUCTURED_TAB_REGISTRY_PATH = previousRegistryPath;
    }
    await rm(registryDir, { recursive: true, force: true });
  }
}

try {
  const result = await run();
  process.stdout.write(`${JSON.stringify(result)}\n`);
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`browser-captcha-assist-live-smoke failed: ${message}\n`);
  if (error instanceof Error && error.stack) {
    process.stderr.write(`${error.stack}\n`);
  }
  process.stdout.write(`${JSON.stringify({
    ok: false,
    error: message,
    ...(error && typeof error === "object" && error.details ? error.details : {}),
  })}\n`);
  process.exitCode = 1;
}
