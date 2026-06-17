import { tmpdir } from "node:os";
import path from "node:path";

const CAPTURE_DIR = path.join(tmpdir(), "tmwd-captcha-captures");
const MAX_CAPTURE_PIXELS = 1_500_000;
const MIN_EXECUTION_CONFIDENCE = 0.85;
const CHECKBOX_CONTROL_DETECTOR = "checkbox_control_component_v1";
const SLIDER_HANDLE_DETECTOR = "slider_handle_component_v2";

export {
  CAPTURE_DIR,
  CHECKBOX_CONTROL_DETECTOR,
  MAX_CAPTURE_PIXELS,
  MIN_EXECUTION_CONFIDENCE,
  SLIDER_HANDLE_DETECTOR,
};
