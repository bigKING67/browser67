import { captureCdpRegion } from "./vision-correction/capture.mjs";
import { normalizeClip } from "./vision-correction/clip.mjs";
import { MIN_EXECUTION_CONFIDENCE } from "./vision-correction/constants.mjs";
import {
  detectSliderCorrection,
  unsupportedCorrection,
} from "./vision-correction/slider.mjs";

async function runCaptchaVisionCorrection(args = {}, pageState = {}, planned = {}) {
  if (args?.run_vision_correction !== true) {
    return null;
  }
  const clip = normalizeClip(planned.coordinate_transform?.vision_correction_plan?.screenshot_clip);
  if (!clip) {
    return {
      correction_status: "unavailable",
      status: "blocked",
      reason: "screenshot_clip_unavailable",
      fullscreen_allowed: false,
    };
  }
  try {
    const capture = await captureCdpRegion(args, clip, pageState);
    const target = String(planned.assist_target ?? args?.assist_target ?? "auto");
    const detected = target === "slider"
      ? detectSliderCorrection(capture.image, clip, pageState, planned)
      : unsupportedCorrection(target);
    return {
      status: detected.correction_status === "success" ? "success" : "blocked",
      provider_id: capture.provider_id,
      method: capture.method,
      transport: capture.transport,
      transport_attempts: capture.transport_attempts,
      artifact: capture.artifact,
      fullscreen_allowed: false,
      ...detected,
    };
  } catch (error) {
    return {
      correction_status: "capture_failed",
      status: "blocked",
      reason: "region_capture_failed",
      error: String(error?.message ?? error),
      fullscreen_allowed: false,
    };
  }
}

export {
  MIN_EXECUTION_CONFIDENCE,
  runCaptchaVisionCorrection,
};
