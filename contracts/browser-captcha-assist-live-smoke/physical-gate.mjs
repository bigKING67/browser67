import assert from "node:assert/strict";

import { envEnabled, envNumber, waitFor } from "./fixtures.mjs";

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
        requested_from: physicalAssist.native_input.requested_from,
        actual_from: physicalAssist.native_input.actual_from,
        requested_to: physicalAssist.native_input.requested_to,
        actual_to_before_up: physicalAssist.native_input.actual_to_before_up,
        actual_to: physicalAssist.native_input.actual_to,
        requested_point: physicalAssist.native_input.requested_point,
        actual_point: physicalAssist.native_input.actual_point,
        set_cursor_ok: physicalAssist.native_input.set_cursor_ok,
        get_cursor_ok: physicalAssist.native_input.get_cursor_ok,
        position_verified: physicalAssist.native_input.position_verified,
        input_api: physicalAssist.native_input.input_api,
        down_input_count: physicalAssist.native_input.down_input_count,
        down_input_last_error: physicalAssist.native_input.down_input_last_error,
        up_input_count: physicalAssist.native_input.up_input_count,
        up_input_last_error: physicalAssist.native_input.up_input_last_error,
        button_down_observed: physicalAssist.native_input.button_down_observed,
        button_up_observed: physicalAssist.native_input.button_up_observed,
        pre_down_settle_ms: physicalAssist.native_input.pre_down_settle_ms,
        post_down_settle_ms: physicalAssist.native_input.post_down_settle_ms,
        post_up_settle_ms: physicalAssist.native_input.post_up_settle_ms,
        expected_window_hwnd: physicalAssist.native_input.expected_window_hwnd,
        foreground_window: physicalAssist.native_input.foreground_window,
        foreground_activation_attempted: physicalAssist.native_input.foreground_activation_attempted,
        foreground_activation_succeeded: physicalAssist.native_input.foreground_activation_succeeded,
        foreground_window_verified: physicalAssist.native_input.foreground_window_verified,
        dpi_awareness: physicalAssist.native_input.dpi_awareness,
      }
      : undefined,
    pre_input_settle_ms: physicalAssist.pre_input_settle_ms,
    screen_coordinates: physicalAssist.screen_coordinates,
    coordinate_refresh: physicalAssist.coordinate_refresh
      ? {
        performed: physicalAssist.coordinate_refresh.performed,
        reason: physicalAssist.coordinate_refresh.reason,
        initial_viewport: physicalAssist.coordinate_refresh.initial_viewport,
        refreshed_viewport: physicalAssist.coordinate_refresh.refreshed_viewport,
        initial_coordinate_transform: physicalAssist.coordinate_refresh.initial_coordinate_transform,
        refreshed_coordinate_transform: physicalAssist.coordinate_refresh.refreshed_coordinate_transform,
      }
      : undefined,
    coordinate_calibration: physicalAssist.coordinate_calibration,
    native_window_rect: physicalAssist.native_window_rect,
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
    checkbox_click_hint: physicalAssist.checkbox_click_hint,
    coordinate_transform: physicalAssist.coordinate_transform
      ? {
        source_coordinate_system: physicalAssist.coordinate_transform.source_coordinate_system,
        target_coordinate_system: physicalAssist.coordinate_transform.target_coordinate_system,
        viewport_origin_screen_estimate: physicalAssist.coordinate_transform.viewport_origin_screen_estimate,
        click_hint: physicalAssist.coordinate_transform.click_hint,
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

function physicalDiagnostics(physicalAssist, physicalCompletion, physicalAttempts = undefined) {
  return {
    physical_assist: compactPhysicalAssist(physicalAssist),
    physical_completion: physicalCompletion?.js_return ?? physicalCompletion,
    physical_attempts: physicalAttempts,
  };
}

function physicalGateError(message, physicalAssist, physicalCompletion, physicalAttempts = undefined) {
  const diagnostics = physicalDiagnostics(physicalAssist, physicalCompletion, physicalAttempts);
  const error = new Error(`${message}: ${JSON.stringify(diagnostics)}`);
  error.details = {
    physical_diagnostics: diagnostics,
  };
  return error;
}

function finiteNumber(raw) {
  const value = Number(raw);
  return Number.isFinite(value) ? value : null;
}

function clampNumber(raw, fallback, min, max) {
  const value = finiteNumber(raw);
  const candidate = value === null ? fallback : value;
  return Math.max(min, Math.min(max, candidate));
}

function clampInteger(raw, fallback, min, max) {
  return Math.round(clampNumber(raw, fallback, min, max));
}

function optionalEnvNumber(name) {
  const raw = process.env[name];
  if (raw === undefined || String(raw).trim() === "") {
    return null;
  }
  return finiteNumber(raw);
}

function explicitCoordinatesFromEnv() {
  const fromX = optionalEnvNumber("TMWD_CAPTCHA_ASSIST_DRAG_FROM_X");
  const fromY = optionalEnvNumber("TMWD_CAPTCHA_ASSIST_DRAG_FROM_Y");
  const toX = optionalEnvNumber("TMWD_CAPTCHA_ASSIST_DRAG_TO_X");
  const toY = optionalEnvNumber("TMWD_CAPTCHA_ASSIST_DRAG_TO_Y");
  if ([fromX, fromY, toX, toY].every((value) => value !== null)) {
    return {
      source: "env_explicit_screen_coordinates",
      from: { x: Math.round(fromX), y: Math.round(fromY) },
      to: { x: Math.round(toX), y: Math.round(toY) },
    };
  }
  return null;
}

function explicitClickCoordinatesFromEnv() {
  const x = optionalEnvNumber("TMWD_CAPTCHA_ASSIST_CLICK_X");
  const y = optionalEnvNumber("TMWD_CAPTCHA_ASSIST_CLICK_Y");
  if (x !== null && y !== null) {
    return {
      source: "env_explicit_click_screen_coordinates",
      point: { x: Math.round(x), y: Math.round(y) },
    };
  }
  return null;
}

function physicalAttemptOptionsFromEnv() {
  return {
    maxAttempts: clampInteger(envNumber("TMWD_CAPTCHA_ASSIST_MAX_ATTEMPTS", 2), 2, 1, 3),
    dragDurationMs: clampInteger(envNumber("TMWD_CAPTCHA_ASSIST_DRAG_MS", 900), 900, 0, 10_000),
    dragSteps: clampInteger(envNumber("TMWD_CAPTCHA_ASSIST_DRAG_STEPS", 24), 24, 1, 240),
    retryDragDurationMs: clampInteger(envNumber("TMWD_CAPTCHA_ASSIST_RETRY_DRAG_MS", 1_400), 1_400, 0, 10_000),
    retryDragSteps: clampInteger(envNumber("TMWD_CAPTCHA_ASSIST_RETRY_DRAG_STEPS", 36), 36, 1, 240),
    preInputSettleMs: clampInteger(envNumber("TMWD_CAPTCHA_ASSIST_PRE_INPUT_SETTLE_MS", 500), 500, 0, 5_000),
    retryOvershootX: clampNumber(envNumber("TMWD_CAPTCHA_ASSIST_DRAG_OVERSHOOT_X", 32), 32, -200, 400),
    retryStartOffsetX: clampNumber(envNumber("TMWD_CAPTCHA_ASSIST_DRAG_START_OFFSET_X", 0), 0, -200, 200),
    retryStartOffsetY: clampNumber(envNumber("TMWD_CAPTCHA_ASSIST_DRAG_START_OFFSET_Y", 0), 0, -200, 200),
    retryEndOffsetX: clampNumber(envNumber("TMWD_CAPTCHA_ASSIST_DRAG_END_OFFSET_X", 0), 0, -200, 200),
    retryEndOffsetY: clampNumber(envNumber("TMWD_CAPTCHA_ASSIST_DRAG_END_OFFSET_Y", 0), 0, -200, 200),
    retryClickOffsetX: clampNumber(envNumber("TMWD_CAPTCHA_ASSIST_CLICK_RETRY_OFFSET_X", 0), 0, -120, 120),
    retryClickOffsetY: clampNumber(envNumber("TMWD_CAPTCHA_ASSIST_CLICK_RETRY_OFFSET_Y", 0), 0, -120, 120),
    explicitCoordinates: explicitCoordinatesFromEnv(),
    explicitClickCoordinates: explicitClickCoordinatesFromEnv(),
    physicalInputProvider: envEnabled("TMWD_NATIVE_LIVE_PROOF") ? "native-os" : undefined,
  };
}

function coordinatePoint(x, y) {
  const pointX = finiteNumber(x);
  const pointY = finiteNumber(y);
  if (pointX === null || pointY === null) {
    return null;
  }
  return {
    x: Math.max(0, Math.round(pointX)),
    y: Math.max(0, Math.round(pointY)),
  };
}

function retryCoordinatesFromAssist(physicalAssist, options) {
  if (options.explicitCoordinates) {
    return options.explicitCoordinates;
  }
  const screen = physicalAssist?.screen_coordinates ?? {};
  const correctedDrag = physicalAssist?.coordinate_transform?.vision_correction?.screen_estimate?.drag;
  const estimatedDrag = physicalAssist?.coordinate_transform?.screen_estimate?.drag;
  const from = coordinatePoint(
    finiteNumber(screen.x) ?? correctedDrag?.from?.x ?? estimatedDrag?.from?.x,
    finiteNumber(screen.y) ?? correctedDrag?.from?.y ?? estimatedDrag?.from?.y,
  );
  const toYCandidate = finiteNumber(screen.to_y)
    ?? correctedDrag?.to?.y
    ?? estimatedDrag?.to?.y
    ?? from?.y;
  const toCandidates = [
    finiteNumber(screen.to_x),
    finiteNumber(correctedDrag?.to?.x),
    finiteNumber(estimatedDrag?.to?.x),
  ].filter((value) => value !== null);
  if (!from || toCandidates.length === 0 || finiteNumber(toYCandidate) === null) {
    return null;
  }
  const baseToX = Math.max(...toCandidates);
  return {
    source: "retry_from_prior_vision_or_estimate_with_overshoot",
    from: coordinatePoint(
      from.x + options.retryStartOffsetX,
      from.y + options.retryStartOffsetY,
    ),
    to: coordinatePoint(
      baseToX + options.retryOvershootX + options.retryEndOffsetX,
      toYCandidate + options.retryEndOffsetY,
    ),
  };
}

function screenPointFromViewportClient(point, viewport = {}, transform = {}) {
  const origin = transform?.viewport_origin_screen_estimate;
  const originX = finiteNumber(origin?.x);
  const originY = finiteNumber(origin?.y);
  const clientX = finiteNumber(point?.x);
  const clientY = finiteNumber(point?.y);
  if (originX === null || originY === null || clientX === null || clientY === null) {
    return null;
  }
  const visual = viewport?.visual_viewport && typeof viewport.visual_viewport === "object"
    ? viewport.visual_viewport
    : {};
  const offsetLeft = finiteNumber(visual.offset_left) ?? 0;
  const offsetTop = finiteNumber(visual.offset_top) ?? 0;
  const scale = finiteNumber(visual.scale) ?? 1;
  return coordinatePoint(
    originX + ((clientX - offsetLeft) * scale),
    originY + ((clientY - offsetTop) * scale),
  );
}

function checkboxRetryCoordinatesFromAssist(previousAssist, previousCompletion, options) {
  if (options.explicitClickCoordinates) {
    return options.explicitClickCoordinates;
  }
  const completion = previousCompletion?.js_return ?? previousCompletion ?? {};
  const fakeBox = completion.fake_box_rect;
  const transform = previousAssist?.coordinate_refresh?.refreshed_coordinate_transform
    ?? previousAssist?.coordinate_transform;
  const viewport = previousAssist?.coordinate_refresh?.refreshed_viewport
    ?? previousAssist?.viewport
    ?? {};
  if (fakeBox) {
    const centerPoint = {
      x: (Number(fakeBox.left) + Number(fakeBox.right)) / 2,
      y: (Number(fakeBox.top) + Number(fakeBox.bottom)) / 2,
    };
    const screenPoint = screenPointFromViewportClient(centerPoint, viewport, transform);
    if (screenPoint) {
      return {
        source: "retry_from_dom_fake_box_center_and_refreshed_viewport",
        point: coordinatePoint(
          screenPoint.x + options.retryClickOffsetX,
          screenPoint.y + options.retryClickOffsetY,
        ),
      };
    }
  }
  const priorScreen = coordinatePoint(
    previousAssist?.screen_coordinates?.x,
    previousAssist?.screen_coordinates?.y,
  );
  if (priorScreen) {
    return {
      source: "retry_from_prior_click_screen_coordinates",
      point: coordinatePoint(
        priorScreen.x + options.retryClickOffsetX,
        priorScreen.y + options.retryClickOffsetY,
      ),
    };
  }
  return null;
}

function buildPhysicalAssistAttemptPlan(attemptIndex, previousAssist, options = {}) {
  const retry = attemptIndex > 1;
  const coordinates = retry
    ? retryCoordinatesFromAssist(previousAssist, options)
    : options.explicitCoordinates;
  const dragDurationMs = retry ? options.retryDragDurationMs : options.dragDurationMs;
  const dragSteps = retry ? options.retryDragSteps : options.dragSteps;
  const args = {
    run_vision_correction: true,
    use_vision_corrected_coordinates: true,
    confirm_corrected_coordinates: true,
    confirm_physical_input: true,
    drag_duration_ms: dragDurationMs,
    drag_steps: dragSteps,
    pre_input_settle_ms: options.preInputSettleMs,
    wait_after_ms: 5_000,
    physical_input_provider: options.physicalInputProvider,
  };
  if (coordinates?.from && coordinates?.to) {
    args.screen_x = coordinates.from.x;
    args.screen_y = coordinates.from.y;
    args.screen_to_x = coordinates.to.x;
    args.screen_to_y = coordinates.to.y;
  }
  return {
    attempt: attemptIndex,
    strategy: coordinates?.source
      ?? (retry ? "vision_corrected_retry_slow_without_explicit_coordinates" : "vision_corrected_primary"),
    args,
    requested_screen_coordinates: coordinates?.from && coordinates?.to
      ? {
        x: coordinates.from.x,
        y: coordinates.from.y,
        to_x: coordinates.to.x,
        to_y: coordinates.to.y,
        coordinate_system: "screen_pixels",
        source: coordinates.source,
      }
      : undefined,
  };
}

function buildCheckboxPhysicalAssistAttemptPlan(attemptIndex, previousAssist, previousCompletion, options = {}) {
  const retry = attemptIndex > 1;
  const coordinates = retry
    ? checkboxRetryCoordinatesFromAssist(previousAssist, previousCompletion, options)
    : options.explicitClickCoordinates;
  const args = {
    run_vision_correction: true,
    use_vision_corrected_coordinates: true,
    confirm_corrected_coordinates: true,
    confirm_physical_input: true,
    pre_input_settle_ms: options.preInputSettleMs,
    wait_after_ms: 5_000,
    physical_input_provider: options.physicalInputProvider,
  };
  if (coordinates?.point) {
    args.screen_x = coordinates.point.x;
    args.screen_y = coordinates.point.y;
  }
  return {
    attempt: attemptIndex,
    strategy: coordinates?.source
      ?? (retry ? "vision_corrected_checkbox_retry_without_explicit_coordinates" : "vision_corrected_checkbox_click"),
    args,
    requested_screen_coordinates: coordinates?.point
      ? {
        x: coordinates.point.x,
        y: coordinates.point.y,
        coordinate_system: "screen_pixels",
        source: coordinates.source,
      }
      : undefined,
  };
}

async function runSinglePhysicalAttempt({
  attemptIndex,
  attemptOptions,
  callTool,
  physicalAssist,
  physicalAttempts,
  physicalCompletion,
  tabId,
  toolArgs,
  workspaceKey,
}) {
  const attemptPlan = buildPhysicalAssistAttemptPlan(attemptIndex, physicalAssist, attemptOptions);
  const nextPhysicalAssist = await callTool("browser_auth_ops", {
    ...toolArgs,
    action: "assist_captcha",
    tab_id: tabId,
    workspace_key: workspaceKey,
    assist_target: "slider",
    ...attemptPlan.args,
  });
  if (nextPhysicalAssist.status !== "success") {
    throw physicalGateError("physical assist did not report success", nextPhysicalAssist, physicalCompletion, physicalAttempts);
  }
  if (nextPhysicalAssist.activation?.method !== "tmwd_tabs_switch") {
    throw physicalGateError("physical assist did not activate managed tab via TMWD switch", nextPhysicalAssist, physicalCompletion, physicalAttempts);
  }
  if (typeof nextPhysicalAssist.physical_input_provider?.provider_id !== "string") {
    throw physicalGateError("physical assist did not report physical input provider id", nextPhysicalAssist, physicalCompletion, physicalAttempts);
  }
  if (typeof nextPhysicalAssist.physical_input_provider_selection?.reason !== "string") {
    throw physicalGateError("physical assist did not report provider selection reason", nextPhysicalAssist, physicalCompletion, physicalAttempts);
  }
  if (nextPhysicalAssist.coordinate_refresh?.performed !== true) {
    throw physicalGateError("physical assist did not refresh coordinates after foreground activation", nextPhysicalAssist, physicalCompletion, physicalAttempts);
  }
  if (nextPhysicalAssist.coordinate_refresh?.reason !== "post_activation_viewport_metrics") {
    throw physicalGateError("physical assist coordinate refresh reason was not post-activation viewport metrics", nextPhysicalAssist, physicalCompletion, physicalAttempts);
  }
  const nextPhysicalCompletion = await callTool("browser_execute_js", {
    ...toolArgs,
    tab_id: tabId,
    script: `
      const root = document.querySelector("#slider-captcha");
      const handle = document.querySelector("#slider-handle");
      const rootRect = root?.getBoundingClientRect();
      const handleRect = handle?.getBoundingClientRect();
      const domVisualOffset = rootRect && handleRect
        ? Math.round(handleRect.left - rootRect.left - 2)
        : null;
      return {
        checked: true,
        slider_completed: document.body.dataset.sliderCompleted === "true",
        slider_started: document.body.dataset.sliderStarted === "true",
        slider_delta: document.body.dataset.sliderDelta || null,
        slider_delta_live: document.body.dataset.sliderDeltaLive || null,
        slider_visual_offset: domVisualOffset ?? Number(document.body.dataset.sliderDeltaLive || 0),
        handle_transform: handle?.style?.transform || null,
        status_text: document.querySelector("#slider-status")?.textContent || null,
        active_element_id: document.activeElement?.id || null,
      };
    `,
  });
  const nextPhysicalAttempts = [
    ...physicalAttempts,
    {
      attempt: attemptPlan.attempt,
      strategy: attemptPlan.strategy,
      requested: {
        drag_duration_ms: attemptPlan.args.drag_duration_ms,
        drag_steps: attemptPlan.args.drag_steps,
        pre_input_settle_ms: attemptPlan.args.pre_input_settle_ms,
        screen_coordinates: attemptPlan.requested_screen_coordinates,
      },
      physical_assist: compactPhysicalAssist(nextPhysicalAssist),
      physical_completion: nextPhysicalCompletion?.js_return ?? nextPhysicalCompletion,
    },
  ];
  return {
    physicalAssist: nextPhysicalAssist,
    physicalCompletion: nextPhysicalCompletion,
    physicalAttempts: nextPhysicalAttempts,
  };
}

async function runPhysicalAttemptSequence(state) {
  const next = await runSinglePhysicalAttempt(state);
  if (
    next.physicalCompletion?.js_return?.slider_completed === true
    || state.attemptIndex >= state.attemptOptions.maxAttempts
  ) {
    return next;
  }
  return runPhysicalAttemptSequence({
    ...state,
    attemptIndex: state.attemptIndex + 1,
    physicalAssist: next.physicalAssist,
    physicalCompletion: next.physicalCompletion,
    physicalAttempts: next.physicalAttempts,
  });
}

async function openCheckboxPhysicalTab({
  callTool,
  fixture,
  toolArgs,
  workspaceKey,
}) {
  const managed = await callTool("browser_tab_lifecycle", {
    ...toolArgs,
    action: "select_or_create",
    url: `${fixture.origin}/checkbox-turnstile`,
    workspace_key: workspaceKey,
    fresh: true,
    active: true,
    wait_until: "listed",
    wait_timeout_ms: 5_000,
    wait_poll_ms: 100,
  });
  const tabId = String(managed?.managed_tab?.tab_id ?? "");
  assert.ok(tabId, "physical checkbox gate did not return managed tab id");
  const ready = await waitFor(async () => {
    try {
      const inspected = await callTool("browser_execute_js", {
        ...toolArgs,
        tab_id: tabId,
        script: "return { path: location.pathname, has_checkbox: Boolean(document.querySelector('.cf-turnstile, [data-captcha=\"turnstile\"]')), title: document.title };",
      });
      return {
        ok: inspected?.js_return?.path === "/checkbox-turnstile" && inspected?.js_return?.has_checkbox === true,
        inspected,
      };
    } catch (error) {
      return {
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }, 5_000);
  assert.equal(ready.ok, true, `physical checkbox fixture did not settle: ${JSON.stringify(ready.inspected)}`);
  return tabId;
}

function checkboxCompletionScript() {
  return `
    const data = document.body.dataset;
    const box = document.querySelector(".fake-box");
    const rect = box?.getBoundingClientRect();
    const numberOrNull = (value) => {
      const numeric = Number(value);
      return Number.isFinite(numeric) ? numeric : null;
    };
    return {
      checked: true,
      checkbox_completed: data.checkboxCompleted === "true",
      checkbox_clicked: data.checkboxClicked === "true",
      checkbox_click_inside: data.checkboxClickInside === "true",
      checkbox_click: {
        x: numberOrNull(data.checkboxClickX),
        y: numberOrNull(data.checkboxClickY),
      },
      fake_box_rect: rect ? {
        left: rect.left,
        top: rect.top,
        right: rect.right,
        bottom: rect.bottom,
        width: rect.width,
        height: rect.height,
      } : null,
      status_text: document.querySelector("#checkbox-status")?.textContent || null,
      active_element_id: document.activeElement?.id || null,
    };
  `;
}

async function runCheckboxPhysicalAttempt({
  attemptIndex = 1,
  attemptOptions,
  callTool,
  previousAssist,
  previousCompletion,
  previousAttempts = [],
  tabId,
  toolArgs,
  workspaceKey,
}) {
  const attemptPlan = buildCheckboxPhysicalAssistAttemptPlan(
    attemptIndex,
    previousAssist,
    previousCompletion,
    attemptOptions,
  );
  const checkboxPhysicalAssist = await callTool("browser_auth_ops", {
    ...toolArgs,
    action: "assist_captcha",
    tab_id: tabId,
    workspace_key: workspaceKey,
    assist_target: "checkbox",
    ...attemptPlan.args,
  });
  if (checkboxPhysicalAssist.status !== "success") {
    throw physicalGateError("physical checkbox assist did not report success", checkboxPhysicalAssist, null);
  }
  if (checkboxPhysicalAssist.activation?.method !== "tmwd_tabs_switch") {
    throw physicalGateError("physical checkbox assist did not activate managed tab via TMWD switch", checkboxPhysicalAssist, null);
  }
  if (typeof checkboxPhysicalAssist.physical_input_provider?.provider_id !== "string") {
    throw physicalGateError("physical checkbox assist did not report physical input provider id", checkboxPhysicalAssist, null);
  }
  if (typeof checkboxPhysicalAssist.physical_input_provider_selection?.reason !== "string") {
    throw physicalGateError("physical checkbox assist did not report provider selection reason", checkboxPhysicalAssist, null);
  }
  if (checkboxPhysicalAssist.coordinate_refresh?.performed !== true) {
    throw physicalGateError("physical checkbox assist did not refresh coordinates after foreground activation", checkboxPhysicalAssist, null);
  }
  if (checkboxPhysicalAssist.coordinate_refresh?.reason !== "post_activation_viewport_metrics") {
    throw physicalGateError("physical checkbox coordinate refresh reason was not post-activation viewport metrics", checkboxPhysicalAssist, null);
  }
  const checkboxPhysicalCompletion = await callTool("browser_execute_js", {
    ...toolArgs,
    tab_id: tabId,
    script: checkboxCompletionScript(),
  });
  const checkboxCompletion = checkboxPhysicalCompletion?.js_return ?? {};
  const checkboxPhysicalAttempts = [
    ...previousAttempts,
    {
      attempt: attemptPlan.attempt,
      strategy: attemptPlan.strategy,
      requested: {
        pre_input_settle_ms: attemptPlan.args.pre_input_settle_ms,
        screen_coordinates: attemptPlan.requested_screen_coordinates,
      },
      physical_assist: compactPhysicalAssist(checkboxPhysicalAssist),
      physical_completion: checkboxCompletion,
    },
  ];
  return {
    checkboxPhysicalAssist,
    checkboxPhysicalCompletion,
    checkboxPhysicalAttempts,
  };
}

async function runCheckboxPhysicalAttemptSequence(state) {
  const next = await runCheckboxPhysicalAttempt(state);
  const completed = next.checkboxPhysicalCompletion?.js_return?.checkbox_completed === true
    && next.checkboxPhysicalCompletion?.js_return?.checkbox_click_inside === true;
  if (completed || state.attemptIndex >= state.attemptOptions.maxAttempts) {
    return next;
  }
  return runCheckboxPhysicalAttemptSequence({
    ...state,
    attemptIndex: state.attemptIndex + 1,
    previousAssist: next.checkboxPhysicalAssist,
    previousCompletion: next.checkboxPhysicalCompletion,
    previousAttempts: next.checkboxPhysicalAttempts,
  });
}

async function runPhysicalAssistIfEnabled({
  callTool,
  fixture,
  tabId,
  toolArgs,
  workspaceKey,
}) {
  let physicalAssist = {
    status: "skipped",
    reason: "set TMWD_CAPTCHA_ASSIST_PHYSICAL=1 and TMWD_CAPTCHA_ASSIST_CONFIRM=1 to opt in",
  };
  let physicalCompletion = { checked: false };
  let physicalAttempts = [];
  let checkboxPhysicalAssist = {
    status: "skipped",
    reason: "set TMWD_CAPTCHA_ASSIST_PHYSICAL=1 and TMWD_CAPTCHA_ASSIST_CONFIRM=1 to opt in",
  };
  let checkboxPhysicalCompletion = { checked: false };
  let checkboxPhysicalAttempts = [];
  if (envEnabled("TMWD_CAPTCHA_ASSIST_PHYSICAL")) {
    assert.equal(
      envEnabled("TMWD_CAPTCHA_ASSIST_CONFIRM"),
      true,
      "physical CAPTCHA assist requires TMWD_CAPTCHA_ASSIST_CONFIRM=1",
    );
    const attemptOptions = physicalAttemptOptionsFromEnv();
    ({ physicalAssist, physicalCompletion, physicalAttempts } = await runPhysicalAttemptSequence({
      attemptIndex: 1,
      attemptOptions,
      callTool,
      physicalAssist,
      physicalAttempts,
      physicalCompletion,
      tabId,
      toolArgs,
      workspaceKey,
    }));
    if (physicalCompletion?.js_return?.slider_completed !== true) {
      throw physicalGateError("physical drag did not complete local slider fixture", physicalAssist, physicalCompletion, physicalAttempts);
    }
    const visualOffset = Number(
      physicalCompletion?.js_return?.slider_visual_offset
        ?? physicalCompletion?.js_return?.slider_delta_live,
    );
    if (!Number.isFinite(visualOffset) || visualOffset < 180) {
      throw physicalGateError("physical drag completed but slider visual movement was not observed", physicalAssist, physicalCompletion, physicalAttempts);
    }
    const checkboxTabId = await openCheckboxPhysicalTab({
      callTool,
      fixture,
      toolArgs,
      workspaceKey,
    });
    ({ checkboxPhysicalAssist, checkboxPhysicalCompletion, checkboxPhysicalAttempts } = await runCheckboxPhysicalAttemptSequence({
      attemptIndex: 1,
      attemptOptions,
      callTool,
      tabId: checkboxTabId,
      toolArgs,
      workspaceKey,
    }));
    if (
      checkboxPhysicalCompletion?.js_return?.checkbox_completed !== true
      || checkboxPhysicalCompletion?.js_return?.checkbox_click_inside !== true
    ) {
      throw physicalGateError(
        "physical checkbox click did not complete local checkbox fixture",
        checkboxPhysicalAssist,
        checkboxPhysicalCompletion,
        checkboxPhysicalAttempts,
      );
    }
  }

  return {
    physicalAssist,
    physicalCompletion,
    physicalAttempts,
    checkboxPhysicalAssist,
    checkboxPhysicalCompletion,
    checkboxPhysicalAttempts,
  };
}

export {
  buildCheckboxPhysicalAssistAttemptPlan,
  buildPhysicalAssistAttemptPlan,
  compactPhysicalAssist,
  physicalDiagnostics,
  physicalAttemptOptionsFromEnv,
  runPhysicalAssistIfEnabled,
};
