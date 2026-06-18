import {
  buildHybridCaptchaPolicy,
  isProtocolCaptchaKind,
  normalizeCaptchaKind,
  normalizeCaptchaLocatorProvider,
  normalizeCaptchaSolverMode,
} from "./policy.mjs";
import { resolveCaptchaProviderRegistry } from "./providers/registry.mjs";

function degradedReason(pageState = {}, plan = {}) {
  if (plan.degraded_mode === true || pageState.target?.degraded_mode === true) {
    return plan.degraded_reason || pageState.target?.inaccessible_frame_reason || "cross_origin_frame_uninspectable";
  }
  if (pageState.target?.frame_access === "cross_origin_uninspectable") {
    return "cross_origin_frame_uninspectable";
  }
  return "";
}

function effectiveKind(pageState = {}, plan = {}) {
  const kind = normalizeCaptchaKind(pageState.captcha_kind || plan.captcha_kind);
  if (kind !== "unknown") return kind;
  const role = normalizeCaptchaKind(pageState.target?.role || plan.assist_target);
  return role === "auto" ? "unknown" : role;
}

function localCoordinateRoute({ kind, assistTarget, locatorProvider, plan }) {
  const routeProvider = locatorProvider === "vision" ? "vision" : "local_dom_or_vision";
  return {
    route_id: assistTarget === "slider" ? "physical_slider_coordinate" : "physical_checkbox_coordinate",
    route_type: "physical_coordinate",
    solver_provider: routeProvider,
    provider_mode: "local_coordinate",
    captcha_kind: kind,
    assist_target: assistTarget,
    status: "planned",
    execution_allowed: false,
    execution_requires: assistTarget === "slider"
      ? [
        "managed_tab",
        "confirm_physical_input:true",
        "screen_x/screen_y/screen_to_x/screen_to_y or confirmed coordinate_transform",
      ]
      : [
        "managed_tab",
        "confirm_physical_input:true",
        "screen_x/screen_y or confirmed coordinate_transform",
      ],
    locator_confidence_source: locatorProvider === "vision" ? "vision_region_correction" : "dom_rect_or_vision_region",
    safe_to_auto_execute_without_confirmation: false,
    can_use_auto_coordinate_estimate: plan.coordinate_transform?.can_use_with_explicit_confirmation === true,
  };
}

function jfbymCoordinateRoute({ kind, assistTarget, provider, plan }) {
  return {
    route_id: assistTarget === "slider" ? "jfbym_slider_coordinate" : "jfbym_visible_coordinate",
    route_type: "physical_coordinate",
    solver_provider: "jfbym",
    provider_mode: "coordinate",
    captcha_kind: kind,
    assist_target: assistTarget,
    status: "planned",
    execution_allowed: false,
    execution_requires: [
      "provider_response_coordinates",
      "managed_tab",
      "confirm_physical_input:true",
      assistTarget === "slider"
        ? "physical_drag_support"
        : "physical_click_support",
    ],
    provider_configured: provider.configured === true,
    provider_timeout_ms: provider.timeout_ms,
    provider_max_attempts: provider.max_attempts,
    safe_to_auto_execute_without_confirmation: false,
    can_use_auto_coordinate_estimate: plan.coordinate_transform?.can_use_with_explicit_confirmation === true,
  };
}

function protocolRoute({ kind, provider }) {
  return {
    route_id: `jfbym_${kind}_protocol_solver`,
    route_type: "protocol_solver",
    solver_provider: "jfbym",
    provider_mode: "protocol",
    captcha_kind: kind,
    status: "planned",
    execution_allowed: false,
    apply_implementation_status: "not_implemented_in_assist_captcha",
    execution_requires: [
      "confirm_protocol_solver:true",
      "origin_allowlisted_in_provider_config",
      "provider_protocol_response",
      "explicit_future_apply_step",
    ],
    token_cookie_extraction: false,
    js_cdp_widget_click: false,
    provider_configured: provider.configured === true,
    provider_timeout_ms: provider.timeout_ms,
    provider_max_attempts: provider.max_attempts,
  };
}

function manualRoute(reason, extras = {}) {
  return {
    route_id: "manual_user_handoff",
    route_type: "manual_handoff",
    status: "blocked",
    reason,
    execution_allowed: false,
    escalation: "manual_user_handoff",
    ...extras,
  };
}

function protocolBlockReason({ mode, confirmed, provider, kind, policy }) {
  if (mode !== "protocol_allowed") return "protocol_solver_not_requested";
  if (policy.protocol_solver_candidate !== true || !isProtocolCaptchaKind(kind)) {
    return "protocol_solver_not_applicable_for_captcha_kind";
  }
  if (confirmed !== true) return "confirm_protocol_solver_required";
  if (provider.configured !== true) return "captcha_provider_jfbym_not_configured";
  if (provider.protocol_mode?.enabled !== true) return "captcha_provider_jfbym_protocol_disabled";
  if (provider.protocol_mode?.allowed_origin !== true) return "captcha_provider_jfbym_origin_not_allowlisted";
  if (provider.protocol_mode?.allowed_kind !== true) return "captcha_provider_jfbym_kind_not_allowlisted";
  return "";
}

function providerCoordinateBlockReason({ locatorProvider, provider, kind }) {
  if (locatorProvider !== "jfbym" && locatorProvider !== "auto") return "provider_coordinate_not_requested";
  if (provider.configured !== true) return "captcha_provider_jfbym_not_configured";
  if (provider.coordinate_mode?.enabled !== true) return "captcha_provider_jfbym_coordinate_disabled";
  if (provider.coordinate_mode?.allowed_origin !== true) return "captcha_provider_jfbym_origin_not_allowlisted";
  if (provider.coordinate_mode?.allowed_kind !== true) return "captcha_provider_jfbym_kind_not_allowlisted";
  if (!provider.coordinate_mode?.supported_kinds?.includes(kind)) return "captcha_provider_jfbym_kind_not_supported_for_coordinates";
  return "";
}

async function buildCaptchaRouterPlan({ args = {}, pageState = {}, plan = {} } = {}) {
  const kind = effectiveKind(pageState, plan);
  const solverMode = normalizeCaptchaSolverMode(args.captcha_solver_mode);
  const locatorProvider = normalizeCaptchaLocatorProvider(args.captcha_locator_provider);
  const policy = buildHybridCaptchaPolicy(args, kind);
  const providerRegistry = await resolveCaptchaProviderRegistry(args, {
    ...pageState,
    captcha_kind: kind,
  });
  const jfbym = providerRegistry.by_id.jfbym;
  const degraded = degradedReason(pageState, plan);
  const assistTarget = String(plan.assist_target || pageState.target?.role || "auto").toLowerCase();
  const unknown = kind === "unknown" || assistTarget === "unknown" || assistTarget === "auto";

  if (degraded) {
    const route = manualRoute(degraded, {
      degraded_mode: true,
      manual_handoff_required: true,
    });
    return {
      policy,
      providers: providerRegistry.providers,
      router: {
        router_id: policy.strategy_id,
        selected_route: route,
        protocol_block_reason: protocolBlockReason({
          mode: solverMode,
          confirmed: args.confirm_protocol_solver === true,
          provider: jfbym,
          kind,
          policy,
        }),
      },
      secrets_redacted: true,
    };
  }

  if (solverMode === "manual_only") {
    return {
      policy,
      providers: providerRegistry.providers,
      router: {
        router_id: policy.strategy_id,
        selected_route: manualRoute("captcha_solver_mode_manual_only"),
      },
      secrets_redacted: true,
    };
  }

  const confirmedProtocol = args.confirm_protocol_solver === true;
  const protocolAllowed = solverMode === "protocol_allowed"
    && confirmedProtocol
    && jfbym.protocol_mode?.available === true;
  if (protocolAllowed) {
    return {
      policy,
      providers: providerRegistry.providers,
      router: {
        router_id: policy.strategy_id,
        selected_route: protocolRoute({ kind, provider: jfbym }),
        protocol_block_reason: "",
      },
      secrets_redacted: true,
    };
  }

  const protocolReason = protocolBlockReason({
    mode: solverMode,
    confirmed: confirmedProtocol,
    provider: jfbym,
    kind,
    policy,
  });

  if (unknown) {
    return {
      policy,
      providers: providerRegistry.providers,
      router: {
        router_id: policy.strategy_id,
        selected_route: manualRoute("unknown_challenge"),
        protocol_block_reason: protocolReason,
      },
      secrets_redacted: true,
    };
  }

  const preferJfbymCoordinate = locatorProvider === "jfbym"
    || (locatorProvider === "auto" && assistTarget === "slider" && jfbym.coordinate_mode?.available === true);
  const route = preferJfbymCoordinate && jfbym.coordinate_mode?.available === true
    ? jfbymCoordinateRoute({ kind, assistTarget, provider: jfbym, plan })
    : localCoordinateRoute({ kind, assistTarget, locatorProvider, plan });
  const providerCoordinateReason = route.solver_provider === "jfbym"
    ? ""
    : providerCoordinateBlockReason({ locatorProvider, provider: jfbym, kind });

  return {
    policy,
    providers: providerRegistry.providers,
    router: {
      router_id: policy.strategy_id,
      selected_route: route,
      protocol_block_reason: protocolReason,
      provider_coordinate_block_reason: providerCoordinateReason,
    },
    secrets_redacted: true,
  };
}

export {
  buildCaptchaRouterPlan,
};
