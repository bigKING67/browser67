import { detectPhysicalInputCapabilities } from "../../physical-input/index.mjs";
import { publicChallengeFields } from "../manual-challenge.mjs";
import { buildPlan } from "../captcha/plan.mjs";
import { CAPTCHA_ASSIST_REASONS } from "../captcha/reasons.mjs";
import { buildCaptchaRouterPlan } from "../captcha/router.mjs";
import { runCaptchaVisionCorrection } from "../captcha/vision-correction.mjs";
import {
  getManagedTabContext,
  inferPhysicalAction,
  inspectCaptchaAssistPage,
} from "./context.mjs";

async function handlePlanCaptchaAssist(args, options = {}) {
  const pageState = await inspectCaptchaAssistPage(args, options);
  const physicalCapabilities = await detectPhysicalInputCapabilities({
    action: inferPhysicalAction(pageState, args),
    preferred_provider: args?.physical_input_provider,
  });
  const nativeCapabilities = physicalCapabilities.native_compat;
  const managedTab = await getManagedTabContext(args);
  const planned = buildPlan(pageState, nativeCapabilities, args, physicalCapabilities);
  const routed = await buildCaptchaRouterPlan({ args, pageState, plan: planned });
  planned.captcha_policy = routed.policy;
  planned.captcha_router = routed.router;
  planned.captcha_providers = routed.providers;
  const visionCorrection = await runCaptchaVisionCorrection(args, pageState, planned, options);
  if (visionCorrection && planned.coordinate_transform?.vision_correction_plan) {
    planned.coordinate_transform.vision_correction_plan = {
      ...planned.coordinate_transform.vision_correction_plan,
      status: visionCorrection.status === "success" ? "corrected" : planned.coordinate_transform.vision_correction_plan.status,
      correction_status: visionCorrection.correction_status,
      correction_method: visionCorrection.method,
      correction_provider_id: visionCorrection.provider_id,
      correction_confidence: visionCorrection.confidence,
      correction_artifact: visionCorrection.artifact,
      correction_detector: visionCorrection.detector,
      correction_error: visionCorrection.error,
      corrected_coordinates: visionCorrection.corrected_coordinates,
      corrected_screen_estimate: visionCorrection.screen_estimate,
      minimum_confidence_to_execute: visionCorrection.minimum_confidence_to_execute
        ?? planned.coordinate_transform.vision_correction_plan.minimum_confidence_to_execute,
    };
    planned.coordinate_transform.vision_correction = visionCorrection;
  }
  const hasCaptcha = pageState.captcha_detected === true
    || pageState.challenge_detected === true
    || Boolean(pageState.target)
    || (Array.isArray(pageState.candidate_targets) && pageState.candidate_targets.length > 0);
  return {
    status: hasCaptcha ? "planned" : "blocked",
    action: "plan_captcha_assist",
    reason: hasCaptcha ? CAPTCHA_ASSIST_REASONS.PLANNED : CAPTCHA_ASSIST_REASONS.CAPTCHA_NOT_DETECTED,
    url: pageState.url,
    origin: pageState.origin,
    pathname: pageState.pathname,
    title: pageState.title,
    transport: pageState.transport,
    transport_attempts: pageState.transport_attempts,
    page: pageState.page,
    ...publicChallengeFields(pageState),
    managed_tab: managedTab.managed_tab,
    managed_tab_required_for_execution: true,
    managed_tab_matched: managedTab.managed,
    viewport: pageState.viewport,
    protocol_hints: pageState.protocol_hints,
    candidate_targets: pageState.candidate_targets,
    target: pageState.target,
    native_input_capabilities: {
      platform: nativeCapabilities.platform,
      driver: nativeCapabilities.driver,
      supported_actions: nativeCapabilities.supported_actions,
      unsupported_actions: nativeCapabilities.unsupported_actions,
      requirements: nativeCapabilities.requirements,
    },
    physical_input: {
      preferred_provider: physicalCapabilities.preferred_provider,
      selected_provider: physicalCapabilities.selected_provider,
      selected_capture_provider: physicalCapabilities.selected_capture_provider,
      provider_selection: physicalCapabilities.provider_selection,
      capture_provider_selection: physicalCapabilities.capture_provider_selection,
      providers: physicalCapabilities.providers,
    },
    ...planned,
    executed: false,
    secrets_redacted: true,
  };
}

export {
  handlePlanCaptchaAssist,
};
