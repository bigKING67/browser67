import { runPhysicalInputAction } from "../../physical-input/index.mjs";
import {
  clientPointToNativeWindowScreen,
  finiteNumber,
  normalizeDragDurationMs,
  normalizeDragSteps,
  normalizePreInputSettleMs,
  normalizeWaitAfterMs,
} from "../captcha/coordinates.mjs";
import { solveJfbymCoordinateChallenge } from "../captcha/providers/jfbym-coordinate.mjs";
import { CAPTCHA_ASSIST_REASONS } from "../captcha/reasons.mjs";
import {
  activateManagedTabForPhysicalInput,
  getManagedTabContext,
  isSupportedWindowsBrowserProcess,
  resolveManagedTabNativeWindowTitle,
  resolveManagedTabNativeWindowUrl,
  sleep,
} from "./context.mjs";
import { handlePlanCaptchaAssist } from "./plan-handler.mjs";

function assistBlocked(plan, reason, extras = {}) {
  return {
    ...plan,
    status: "blocked",
    action: "assist_captcha",
    reason,
    executed: false,
    ...extras,
  };
}

function coordinateRefreshSkipped(reason) {
  return {
    performed: false,
    reason,
  };
}

function coordinateRefreshPerformed(initialPlan, refreshedPlan) {
  return {
    performed: true,
    reason: "post_activation_viewport_metrics",
    initial_viewport: initialPlan.viewport,
    refreshed_viewport: refreshedPlan.viewport,
    initial_coordinate_transform: initialPlan.coordinate_transform,
    refreshed_coordinate_transform: refreshedPlan.coordinate_transform,
  };
}

function visionCorrectionBlock(plan) {
  const correctionConfidence = finiteNumber(plan.coordinate_transform?.vision_correction?.confidence);
  const correctionMinimumConfidence = finiteNumber(
    plan.coordinate_transform?.vision_correction?.minimum_confidence_to_execute,
  ) ?? 0.85;
  if (
    plan.coordinate_transform?.vision_correction?.correction_status === "success"
    && correctionConfidence !== null
    && correctionConfidence >= correctionMinimumConfidence
  ) {
    return null;
  }
  return {
    reason: correctionConfidence === null
      ? CAPTCHA_ASSIST_REASONS.VISION_CORRECTION_UNAVAILABLE
      : CAPTCHA_ASSIST_REASONS.VISION_CORRECTION_CONFIDENCE_TOO_LOW,
    correction_confidence: correctionConfidence,
    correction_minimum_confidence: correctionMinimumConfidence,
  };
}

function selectScreenCoordinates(args, plan, {
  autoScreenCoordinates = false,
  nativeWindowRect = null,
  useCorrectedCoordinates = false,
} = {}) {
  const estimatedClick = plan.coordinate_transform?.screen_estimate?.click;
  const estimatedDrag = plan.coordinate_transform?.screen_estimate?.drag;
  const correctedClick = plan.coordinate_transform?.vision_correction?.screen_estimate?.click;
  const correctedDrag = plan.coordinate_transform?.vision_correction?.screen_estimate?.drag;
  const correctedClientClick = plan.coordinate_transform?.vision_correction?.corrected_coordinates?.click;
  const correctedClientDrag = plan.coordinate_transform?.vision_correction?.corrected_coordinates?.drag;
  const estimatedClientClick = plan.checkbox_click_hint?.click_client ?? plan.target?.center_client;
  const estimatedClientDrag = plan.slider_drag_hint;
  const nativeCorrectedClick = correctedClientClick
    ? clientPointToNativeWindowScreen(correctedClientClick, plan.viewport, nativeWindowRect)
    : null;
  const nativeCorrectedDragFrom = correctedClientDrag?.from
    ? clientPointToNativeWindowScreen(correctedClientDrag.from, plan.viewport, nativeWindowRect)
    : null;
  const nativeCorrectedDragTo = correctedClientDrag?.to
    ? clientPointToNativeWindowScreen(correctedClientDrag.to, plan.viewport, nativeWindowRect)
    : null;
  const nativeEstimatedClick = estimatedClientClick
    ? clientPointToNativeWindowScreen(estimatedClientClick, plan.viewport, nativeWindowRect)
    : null;
  const nativeEstimatedDragFrom = estimatedClientDrag?.from_client
    ? clientPointToNativeWindowScreen(estimatedClientDrag.from_client, plan.viewport, nativeWindowRect)
    : null;
  const nativeEstimatedDragTo = estimatedClientDrag?.to_client
    ? clientPointToNativeWindowScreen(estimatedClientDrag.to_client, plan.viewport, nativeWindowRect)
    : null;
  const explicitScreenX = finiteNumber(args?.screen_x);
  const explicitScreenY = finiteNumber(args?.screen_y);
  const explicitScreenToX = finiteNumber(args?.screen_to_x);
  const explicitScreenToY = finiteNumber(args?.screen_to_y);
  const screenX = explicitScreenX
    ?? (useCorrectedCoordinates ? finiteNumber(
      plan.assist_target === "slider" ? nativeCorrectedDragFrom?.x : nativeCorrectedClick?.x,
    ) : null)
    ?? (useCorrectedCoordinates ? finiteNumber(
      plan.assist_target === "slider" ? correctedDrag?.from?.x : correctedClick?.x,
    ) : null)
    ?? (autoScreenCoordinates ? finiteNumber(
      plan.assist_target === "slider" ? nativeEstimatedDragFrom?.x : nativeEstimatedClick?.x,
    ) : null)
    ?? (autoScreenCoordinates ? finiteNumber(
      plan.assist_target === "slider" ? estimatedDrag?.from?.x : estimatedClick?.x,
    ) : null);
  const screenY = explicitScreenY
    ?? (useCorrectedCoordinates ? finiteNumber(
      plan.assist_target === "slider" ? nativeCorrectedDragFrom?.y : nativeCorrectedClick?.y,
    ) : null)
    ?? (useCorrectedCoordinates ? finiteNumber(
      plan.assist_target === "slider" ? correctedDrag?.from?.y : correctedClick?.y,
    ) : null)
    ?? (autoScreenCoordinates ? finiteNumber(
      plan.assist_target === "slider" ? nativeEstimatedDragFrom?.y : nativeEstimatedClick?.y,
    ) : null)
    ?? (autoScreenCoordinates ? finiteNumber(
      plan.assist_target === "slider" ? estimatedDrag?.from?.y : estimatedClick?.y,
    ) : null);
  const screenToX = explicitScreenToX
    ?? (useCorrectedCoordinates ? finiteNumber(nativeCorrectedDragTo?.x) : null)
    ?? (useCorrectedCoordinates ? finiteNumber(correctedDrag?.to?.x) : null)
    ?? (autoScreenCoordinates ? finiteNumber(nativeEstimatedDragTo?.x) : null)
    ?? (autoScreenCoordinates ? finiteNumber(estimatedDrag?.to?.x) : null);
  const screenToY = explicitScreenToY
    ?? (useCorrectedCoordinates ? finiteNumber(nativeCorrectedDragTo?.y) : null)
    ?? (useCorrectedCoordinates ? finiteNumber(correctedDrag?.to?.y) : null)
    ?? (autoScreenCoordinates ? finiteNumber(nativeEstimatedDragTo?.y) : null)
    ?? (autoScreenCoordinates ? finiteNumber(estimatedDrag?.to?.y) : null);
  const explicitCoordinates = explicitScreenX !== null || explicitScreenY !== null;
  const nativeCoordinates = plan.assist_target === "slider"
    ? (useCorrectedCoordinates ? nativeCorrectedDragFrom : nativeEstimatedDragFrom)
    : (useCorrectedCoordinates ? nativeCorrectedClick : nativeEstimatedClick);
  return {
    screenX,
    screenY,
    screenToX,
    screenToY,
    source: explicitCoordinates
      ? "caller_supplied"
      : useCorrectedCoordinates
        ? (nativeCoordinates ? "vision_corrected_native_window_rect" : "vision_corrected_region_capture")
        : autoScreenCoordinates
          ? (nativeCoordinates ? "coordinate_transform_native_window_rect" : "coordinate_transform_estimate")
          : "caller_supplied",
    coordinate_calibration: explicitCoordinates ? undefined : nativeCoordinates?.calibration,
  };
}

async function getForegroundNativeWindowRect(args, activation = {}) {
  const explicitWindowPid = finiteNumber(args?.window_pid);
  const explicitWindowTitle = String(args?.window_title ?? "").trim();
  const managedActivation = activation.native_window_activation ?? {};
  const managedWindowPid = finiteNumber(managedActivation.pid);
  const managedWindowTabId = finiteNumber(managedActivation.window_tab_id);
  const managedWindowTitle = String(managedActivation.window_title ?? managedActivation.title ?? "").trim();
  const managedWindowUrl = String(managedActivation.window_url ?? "").trim();
  const windowPid = explicitWindowPid ?? managedWindowPid;
  const windowTitle = explicitWindowTitle || (windowPid === null ? managedWindowTitle : "");
  try {
    const physicalInput = await runPhysicalInputAction("get_window_rect", {
      window_pid: windowPid ?? undefined,
      window_title: windowTitle || undefined,
      window_tab_id: managedWindowTabId ?? undefined,
      window_url: managedWindowUrl || undefined,
      window_application: managedActivation.application_name || undefined,
      timeout_ms: args?.timeout_ms,
    }, {
      preferred_provider: args?.physical_input_provider,
    });
    if (physicalInput.result?.status !== "success") {
      return {
        status: "unavailable",
        reason: physicalInput.result?.reason ?? "native_window_rect_failed",
        provider: physicalInput.provider,
        provider_selection: physicalInput.provider_selection,
      };
    }
    return {
      ...physicalInput.result,
      selector_source: explicitWindowPid !== null || explicitWindowTitle
        ? "caller_window_selector"
        : (managedWindowTabId !== null
          ? "native_managed_tab_id"
          : (managedWindowUrl
            ? "native_managed_tab_url"
          : (managedWindowPid !== null || managedWindowTitle
            ? "native_managed_window_activation"
            : "foreground_window"))),
      provider: physicalInput.provider,
      provider_selection: physicalInput.provider_selection,
    };
  } catch (error) {
    return {
      status: "unavailable",
      reason: "native_window_rect_failed",
      error: String(error?.message ?? error),
    };
  }
}

function coordinateBlock(plan, coordinates, autoScreenCoordinates) {
  if (coordinates.screenX === null || coordinates.screenY === null) {
    return {
      reason: autoScreenCoordinates
        ? CAPTCHA_ASSIST_REASONS.AUTO_SCREEN_COORDINATES_UNAVAILABLE
        : CAPTCHA_ASSIST_REASONS.SCREEN_COORDINATES_REQUIRED,
      required_coordinates: plan.assist_target === "slider"
        ? ["screen_x", "screen_y", "screen_to_x", "screen_to_y"]
        : ["screen_x", "screen_y"],
    };
  }
  if (plan.assist_target === "slider" && (
    coordinates.screenToX === null || coordinates.screenToY === null
  )) {
    return {
      reason: CAPTCHA_ASSIST_REASONS.SCREEN_DRAG_COORDINATES_REQUIRED,
      required_coordinates: ["screen_x", "screen_y", "screen_to_x", "screen_to_y"],
    };
  }
  return null;
}

async function handleAssistCaptcha(args) {
  const planned = await handlePlanCaptchaAssist(args);
  const managedTab = await getManagedTabContext(args);
  if (planned.status !== "planned") {
    return assistBlocked(
      planned,
      planned.reason || CAPTCHA_ASSIST_REASONS.CAPTCHA_NOT_DETECTED,
    );
  }
  if (!managedTab.managed) {
    return assistBlocked(planned, CAPTCHA_ASSIST_REASONS.MANAGED_TAB_REQUIRED);
  }
  if (planned.manual_handoff_required === true || planned.degraded_mode === true) {
    return assistBlocked(planned, CAPTCHA_ASSIST_REASONS.CROSS_ORIGIN_FRAME_HANDOFF_REQUIRED, {
      escalation: "manual_user_handoff",
    });
  }
  const selectedRoute = planned.captcha_router?.selected_route;
  if (selectedRoute?.route_type === "manual_handoff") {
    return assistBlocked(planned, CAPTCHA_ASSIST_REASONS.ROUTER_MANUAL_HANDOFF_REQUIRED, {
      escalation: "manual_user_handoff",
      captcha_router_reason: selectedRoute.reason,
    });
  }
  if (selectedRoute?.route_type === "protocol_solver") {
    return assistBlocked(planned, CAPTCHA_ASSIST_REASONS.PROTOCOL_SOLVER_APPLY_NOT_IMPLEMENTED, {
      escalation: "manual_user_handoff",
      captcha_router_route_id: selectedRoute.route_id,
      protocol_solver_apply_supported: false,
      next_implementation_step: "add an allowlisted provider apply path with explicit response injection contract",
    });
  }
  const useProviderCoordinates = args?.use_provider_coordinates === true;
  if (useProviderCoordinates && selectedRoute?.solver_provider !== "jfbym") {
    return assistBlocked(planned, CAPTCHA_ASSIST_REASONS.PROVIDER_COORDINATES_ROUTE_UNAVAILABLE, {
      captcha_router_route_id: selectedRoute?.route_id,
      captcha_router_provider_coordinate_block_reason: planned.captcha_router?.provider_coordinate_block_reason,
      required_args: [
        'captcha_locator_provider:"jfbym"',
        "run_vision_correction:true",
        "confirm_provider_coordinates:true",
      ],
    });
  }
  if (args?.confirm_physical_input !== true) {
    return assistBlocked(planned, CAPTCHA_ASSIST_REASONS.CONFIRM_PHYSICAL_INPUT_REQUIRED);
  }
  const autoScreenCoordinates = args?.auto_screen_coordinates === true;
  const useCorrectedCoordinates = args?.use_vision_corrected_coordinates === true;
  if (useProviderCoordinates && args?.confirm_provider_coordinates !== true) {
    return assistBlocked(planned, CAPTCHA_ASSIST_REASONS.CONFIRM_PROVIDER_COORDINATES_REQUIRED, {
      required_confirmations: [
        "confirm_physical_input:true",
        "confirm_provider_coordinates:true",
      ],
    });
  }
  if (useProviderCoordinates && args?.run_vision_correction !== true) {
    return assistBlocked(planned, CAPTCHA_ASSIST_REASONS.PROVIDER_COORDINATE_ARTIFACT_REQUIRED, {
      required: "run_vision_correction:true",
      fullscreen_allowed: false,
    });
  }
  if (autoScreenCoordinates && args?.confirm_auto_coordinates !== true) {
    return assistBlocked(planned, CAPTCHA_ASSIST_REASONS.CONFIRM_AUTO_COORDINATES_REQUIRED, {
      required_confirmations: ["confirm_physical_input:true", "confirm_auto_coordinates:true"],
    });
  }
  if (useCorrectedCoordinates && args?.confirm_corrected_coordinates !== true) {
    return assistBlocked(planned, CAPTCHA_ASSIST_REASONS.CONFIRM_CORRECTED_COORDINATES_REQUIRED, {
      required_confirmations: [
        "confirm_physical_input:true",
        "confirm_corrected_coordinates:true",
      ],
    });
  }
  const initialVisionBlock = useCorrectedCoordinates ? visionCorrectionBlock(planned) : null;
  if (initialVisionBlock) {
    return assistBlocked(planned, initialVisionBlock.reason, {
      correction_confidence: initialVisionBlock.correction_confidence,
      correction_minimum_confidence: initialVisionBlock.correction_minimum_confidence,
      required_one_of: [
        "explicit screen_x/screen_y coordinates",
        "run_vision_correction:true with confidence above threshold",
        "manual_user_handoff",
      ],
    });
  }

  if (!useProviderCoordinates) {
    const initialCoordinates = selectScreenCoordinates(args, planned, {
      autoScreenCoordinates,
      useCorrectedCoordinates,
    });
    const initialCoordinateBlock = coordinateBlock(planned, initialCoordinates, autoScreenCoordinates);
    if (initialCoordinateBlock) {
      return assistBlocked(planned, initialCoordinateBlock.reason, {
        required_coordinates: initialCoordinateBlock.required_coordinates,
      });
    }
  }
  if (planned.assist_target === "slider") {
    if (planned.coordinate_support?.physical_drag_supported !== true) {
      return assistBlocked(planned, CAPTCHA_ASSIST_REASONS.NATIVE_DRAG_NOT_SUPPORTED, {
        escalation: "manual_user_handoff",
      });
    }
  }

  let activation = { status: "skipped" };
  const windowTitle = String(args?.window_title ?? "").trim();
  const windowPid = finiteNumber(args?.window_pid);
  if (windowTitle || windowPid !== null) {
    const activated = await runPhysicalInputAction("activate_window", {
      window_title: windowTitle || undefined,
      window_pid: windowPid ?? undefined,
      timeout_ms: args?.timeout_ms,
    }, {
      preferred_provider: args?.physical_input_provider,
    });
    activation = {
      provider_selection: activated.provider_selection,
      provider: activated.provider,
      ...activated.result,
    };
  } else {
    try {
      activation = await activateManagedTabForPhysicalInput(args, managedTab.tab_id);
    } catch (error) {
      if (args?.window_active_confirmed === true) {
        activation = {
          status: "confirmed_by_caller",
          tmwd_activation_error: String(error?.message ?? error),
        };
      } else {
        return assistBlocked(planned, CAPTCHA_ASSIST_REASONS.MANAGED_TAB_ACTIVATION_FAILED, {
          activation_error: String(error?.message ?? error),
          required_one_of: [
            "TMWD tabs.switch on managed tab",
            "window_title",
            "window_pid",
            "window_active_confirmed:true",
          ],
        });
      }
    }
  }

  if (
    activation.method === "tmwd_tabs_switch"
    && planned.native_input_capabilities?.platform === "darwin"
  ) {
    const nativeWindowUrl = resolveManagedTabNativeWindowUrl(planned, activation, managedTab.managed_tab);
    const nativeWindowTabId = finiteNumber(managedTab.tab_id ?? activation.tab_id);
    if (!nativeWindowUrl && nativeWindowTabId === null) {
      return assistBlocked(planned, CAPTCHA_ASSIST_REASONS.MANAGED_TAB_ACTIVATION_FAILED, {
        activation: {
          ...activation,
          native_window_activation: {
            status: "blocked",
            reason: "managed_tab_window_url_unavailable",
          },
        },
        required_one_of: [
          "managed tab page URL",
          "window_title",
          "window_pid",
        ],
      });
    }
    try {
      const nativeActivation = await runPhysicalInputAction("activate_window", {
        window_tab_id: nativeWindowTabId ?? undefined,
        window_url: nativeWindowUrl,
        timeout_ms: args?.timeout_ms,
      }, {
        preferred_provider: "native-os",
      });
      const nativeActivationSucceeded = nativeActivation.result?.status === "success"
        && nativeActivation.result?.foregrounded === true;
      activation = {
        ...activation,
        status: nativeActivationSucceeded ? "foregrounded" : "activation_failed",
        os_foreground_verified: nativeActivationSucceeded,
        native_window_activation: {
          window_tab_id: nativeWindowTabId ?? undefined,
          window_url: nativeWindowUrl,
          provider_selection: nativeActivation.provider_selection,
          provider: nativeActivation.provider,
          ...nativeActivation.result,
        },
      };
      if (!nativeActivationSucceeded) {
        return assistBlocked(planned, CAPTCHA_ASSIST_REASONS.MANAGED_TAB_ACTIVATION_FAILED, {
          activation,
          activation_error: "native Chromium tab activation did not reach the macOS foreground",
        });
      }
    } catch (error) {
      return assistBlocked(planned, CAPTCHA_ASSIST_REASONS.MANAGED_TAB_ACTIVATION_FAILED, {
        activation: {
          ...activation,
          status: "activation_failed",
          os_foreground_verified: false,
          native_window_activation: {
            status: "failed",
            window_tab_id: nativeWindowTabId ?? undefined,
            window_url: nativeWindowUrl,
            error: String(error?.message ?? error),
          },
        },
        activation_error: String(error?.message ?? error),
      });
    }
  }

  if (
    activation.method === "tmwd_tabs_switch"
    && planned.native_input_capabilities?.platform === "win32"
  ) {
    const nativeWindowTitle = resolveManagedTabNativeWindowTitle(planned, activation, managedTab.managed_tab);
    if (!nativeWindowTitle) {
      return assistBlocked(planned, CAPTCHA_ASSIST_REASONS.MANAGED_TAB_ACTIVATION_FAILED, {
        activation: {
          ...activation,
          native_window_activation: {
            status: "blocked",
            reason: "managed_tab_window_title_unavailable",
          },
        },
        required_one_of: [
          "managed tab page title",
          "window_title",
          "window_pid",
        ],
      });
    }
    try {
      const nativeActivation = await runPhysicalInputAction("activate_window", {
        window_title: nativeWindowTitle,
        timeout_ms: args?.timeout_ms,
      }, {
        preferred_provider: "native-os",
      });
      const browserProcessVerified = isSupportedWindowsBrowserProcess(
        nativeActivation.result?.process_name,
      );
      const nativeActivationSucceeded = nativeActivation.result?.status === "success"
        && nativeActivation.result?.foregrounded === true
        && browserProcessVerified;
      activation = {
        ...activation,
        status: nativeActivationSucceeded ? "foregrounded" : "activation_failed",
        os_foreground_verified: nativeActivationSucceeded,
        native_window_activation: {
          window_title: nativeWindowTitle,
          provider_selection: nativeActivation.provider_selection,
          provider: nativeActivation.provider,
          ...nativeActivation.result,
          browser_process_verified: browserProcessVerified,
        },
      };
      if (!nativeActivationSucceeded) {
        return assistBlocked(planned, CAPTCHA_ASSIST_REASONS.MANAGED_TAB_ACTIVATION_FAILED, {
          activation,
          activation_error: browserProcessVerified
            ? "native browser window activation did not reach the OS foreground"
            : `native window title resolved to unsupported process=${String(nativeActivation.result?.process_name ?? "unknown")}`,
        });
      }
    } catch (error) {
      return assistBlocked(planned, CAPTCHA_ASSIST_REASONS.MANAGED_TAB_ACTIVATION_FAILED, {
        activation: {
          ...activation,
          status: "activation_failed",
          os_foreground_verified: false,
          native_window_activation: {
            status: "failed",
            window_title: nativeWindowTitle,
            error: String(error?.message ?? error),
          },
        },
        activation_error: String(error?.message ?? error),
      });
    }
  }

  const preInputSettleMs = normalizePreInputSettleMs(args?.pre_input_settle_ms);
  if (preInputSettleMs > 0) {
    await sleep(preInputSettleMs);
  }

  let planForInput = planned;
  let coordinateRefresh = coordinateRefreshSkipped("caller_supplied_screen_coordinates");
  if (useProviderCoordinates) {
    coordinateRefresh = coordinateRefreshSkipped("provider_coordinate_region_capture");
  }
  if (autoScreenCoordinates || useCorrectedCoordinates || useProviderCoordinates) {
    const refreshed = await handlePlanCaptchaAssist(args);
    coordinateRefresh = coordinateRefreshPerformed(planned, refreshed);
    if (refreshed.status !== "planned") {
      return assistBlocked(
        refreshed,
        refreshed.reason || CAPTCHA_ASSIST_REASONS.CAPTCHA_NOT_DETECTED,
        { activation, pre_input_settle_ms: preInputSettleMs, coordinate_refresh: coordinateRefresh },
      );
    }
    if (refreshed.manual_handoff_required === true || refreshed.degraded_mode === true) {
      return assistBlocked(refreshed, CAPTCHA_ASSIST_REASONS.CROSS_ORIGIN_FRAME_HANDOFF_REQUIRED, {
        activation,
        pre_input_settle_ms: preInputSettleMs,
        coordinate_refresh: coordinateRefresh,
        escalation: "manual_user_handoff",
      });
    }
    planForInput = refreshed;
  }
  const refreshedRoute = planForInput.captcha_router?.selected_route;
  if (useProviderCoordinates && refreshedRoute?.solver_provider !== "jfbym") {
    return assistBlocked(planForInput, CAPTCHA_ASSIST_REASONS.PROVIDER_COORDINATES_ROUTE_UNAVAILABLE, {
      activation,
      pre_input_settle_ms: preInputSettleMs,
      coordinate_refresh: coordinateRefresh,
      captcha_router_route_id: refreshedRoute?.route_id,
      captcha_router_provider_coordinate_block_reason: planForInput.captcha_router?.provider_coordinate_block_reason,
    });
  }

  const refreshedVisionBlock = useCorrectedCoordinates ? visionCorrectionBlock(planForInput) : null;
  if (refreshedVisionBlock) {
    return assistBlocked(planForInput, refreshedVisionBlock.reason, {
      activation,
      pre_input_settle_ms: preInputSettleMs,
      coordinate_refresh: coordinateRefresh,
      correction_confidence: refreshedVisionBlock.correction_confidence,
      correction_minimum_confidence: refreshedVisionBlock.correction_minimum_confidence,
      required_one_of: [
        "explicit screen_x/screen_y coordinates",
        "run_vision_correction:true with confidence above threshold",
        "manual_user_handoff",
      ],
    });
  }
  const nativeWindowRect = autoScreenCoordinates || useCorrectedCoordinates
    ? await getForegroundNativeWindowRect(args, activation)
    : {
      status: "skipped",
      reason: "caller_supplied_or_provider_coordinates",
    };
  if (coordinateRefresh.performed === true) {
    coordinateRefresh.native_window_rect = nativeWindowRect;
  }
  let providerCoordinateResult = null;
  const selectedCoordinates = useProviderCoordinates
    ? null
    : selectScreenCoordinates(args, planForInput, {
      autoScreenCoordinates,
      nativeWindowRect: nativeWindowRect.status === "success" ? nativeWindowRect : null,
      useCorrectedCoordinates,
    });
  if (useProviderCoordinates) {
    providerCoordinateResult = await solveJfbymCoordinateChallenge({ args, plan: planForInput });
    if (providerCoordinateResult.ok !== true) {
      return assistBlocked(
        planForInput,
        providerCoordinateResult.reason || CAPTCHA_ASSIST_REASONS.PROVIDER_COORDINATE_SOLVER_FAILED,
        {
          activation,
          pre_input_settle_ms: preInputSettleMs,
          coordinate_refresh: coordinateRefresh,
          provider_coordinate_result: providerCoordinateResult,
        },
      );
    }
  }
  const inputCoordinates = useProviderCoordinates
    ? {
      screenX: finiteNumber(providerCoordinateResult.screen_coordinates?.x),
      screenY: finiteNumber(providerCoordinateResult.screen_coordinates?.y),
      screenToX: finiteNumber(providerCoordinateResult.screen_coordinates?.to_x),
      screenToY: finiteNumber(providerCoordinateResult.screen_coordinates?.to_y),
      source: "jfbym_coordinate_solver",
    }
    : selectedCoordinates;
  const refreshedCoordinateBlock = coordinateBlock(
    planForInput,
    inputCoordinates,
    autoScreenCoordinates || useProviderCoordinates,
  );
  if (refreshedCoordinateBlock) {
    return assistBlocked(planForInput, useProviderCoordinates
      ? CAPTCHA_ASSIST_REASONS.PROVIDER_COORDINATES_UNAVAILABLE
      : refreshedCoordinateBlock.reason, {
      activation,
      pre_input_settle_ms: preInputSettleMs,
      coordinate_refresh: coordinateRefresh,
      provider_coordinate_result: providerCoordinateResult ?? undefined,
      required_coordinates: refreshedCoordinateBlock.required_coordinates,
    });
  }
  if (
    planForInput.assist_target === "slider"
    && planForInput.coordinate_support?.physical_drag_supported !== true
  ) {
    return assistBlocked(planForInput, CAPTCHA_ASSIST_REASONS.NATIVE_DRAG_NOT_SUPPORTED, {
      activation,
      pre_input_settle_ms: preInputSettleMs,
      coordinate_refresh: coordinateRefresh,
      escalation: "manual_user_handoff",
    });
  }

  const physicalInput = planForInput.assist_target === "slider"
    ? await runPhysicalInputAction("drag", {
      from_x: inputCoordinates.screenX,
      from_y: inputCoordinates.screenY,
      to_x: inputCoordinates.screenToX,
      to_y: inputCoordinates.screenToY,
      button: "left",
      duration_ms: normalizeDragDurationMs(args?.drag_duration_ms),
      steps: normalizeDragSteps(args?.drag_steps),
      expected_window_hwnd: nativeWindowRect.status === "success" ? nativeWindowRect.hwnd : undefined,
      window_tab_id: activation.native_window_activation?.window_tab_id,
      window_url: activation.native_window_activation?.window_url,
      window_application: activation.native_window_activation?.application_name,
      timeout_ms: args?.timeout_ms,
    }, {
      preferred_provider: args?.physical_input_provider,
    })
    : await runPhysicalInputAction("click", {
      x: inputCoordinates.screenX,
      y: inputCoordinates.screenY,
      button: "left",
      expected_window_hwnd: nativeWindowRect.status === "success" ? nativeWindowRect.hwnd : undefined,
      window_tab_id: activation.native_window_activation?.window_tab_id,
      window_url: activation.native_window_activation?.window_url,
      window_application: activation.native_window_activation?.application_name,
      timeout_ms: args?.timeout_ms,
    }, {
      preferred_provider: args?.physical_input_provider,
    });
  const nativeInput = physicalInput.result;
  if (nativeInput?.status === "blocked") {
    return {
      ...planForInput,
      status: "blocked",
      action: "assist_captcha",
      reason: CAPTCHA_ASSIST_REASONS.PHYSICAL_INPUT_PROVIDER_UNAVAILABLE,
      executed: false,
      activation,
      coordinate_refresh: coordinateRefresh,
      provider_coordinate_result: providerCoordinateResult ?? undefined,
      physical_input_provider: physicalInput.provider,
      physical_input_provider_selection: physicalInput.provider_selection,
      provider_error: nativeInput,
    };
  }
  const waitAfterMs = normalizeWaitAfterMs(args?.wait_after_ms);
  await sleep(waitAfterMs);
  return {
    ...planForInput,
    status: "success",
    action: "assist_captcha",
    reason: planForInput.assist_target === "slider"
      ? CAPTCHA_ASSIST_REASONS.PHYSICAL_DRAG_SENT
      : CAPTCHA_ASSIST_REASONS.PHYSICAL_INPUT_SENT,
    executed: true,
    activation,
    coordinate_refresh: coordinateRefresh,
    provider_coordinate_result: providerCoordinateResult ?? undefined,
    native_input: nativeInput,
    physical_input_provider: physicalInput.provider,
    physical_input_provider_selection: physicalInput.provider_selection,
    pre_input_settle_ms: preInputSettleMs,
    screen_coordinates: {
      x: Math.round(inputCoordinates.screenX),
      y: Math.round(inputCoordinates.screenY),
      to_x: inputCoordinates.screenToX === null ? undefined : Math.round(inputCoordinates.screenToX),
      to_y: inputCoordinates.screenToY === null ? undefined : Math.round(inputCoordinates.screenToY),
      coordinate_system: inputCoordinates.coordinate_calibration?.target_coordinate_system
        ?? physicalInput.provider?.coordinate_system
        ?? "screen_pixels",
      source: inputCoordinates.source,
    },
    coordinate_calibration: inputCoordinates.coordinate_calibration,
    native_window_rect: nativeWindowRect,
    waited_ms: waitAfterMs,
    next_step: "browser_auth_ops.ensure_login",
    secrets_redacted: true,
  };
}

export {
  handleAssistCaptcha,
};
