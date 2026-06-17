import {
  clientPointToScreenEstimate,
  roundCoordinate,
} from "../coordinates.mjs";
import {
  findMaskedComponents,
  neutralPixelMaskScore,
} from "./components.mjs";
import {
  CHECKBOX_CONTROL_DETECTOR,
  MIN_EXECUTION_CONFIDENCE,
} from "./constants.mjs";
import { imageToViewportScale } from "./slider.mjs";

function checkboxCandidateConfidence(component, image) {
  if (!component) {
    return 0;
  }
  const areaRatio = component.area / Math.max(1, image.width * image.height);
  const boxRatio = component.width / Math.max(1, component.height);
  const squareish = boxRatio >= 0.72 && boxRatio <= 1.38;
  const sizeOk = component.width >= 18
    && component.height >= 18
    && component.width <= image.width * 0.42
    && component.height <= image.height * 0.82;
  const leftBiased = component.center_x <= image.width * 0.48;
  const densityOk = component.density >= 0.06 && component.density <= 0.72;
  const areaOk = areaRatio >= 0.004;
  if (squareish && sizeOk && leftBiased && densityOk && areaOk) {
    return Math.min(0.96, 0.88 + Math.min(0.05, areaRatio * 2) + Math.min(0.03, component.density * 0.05));
  }
  if (squareish && sizeOk && leftBiased) {
    return 0.74;
  }
  if (squareish && sizeOk) {
    return 0.58;
  }
  return 0.3;
}

function bestCheckboxCandidate(image) {
  let best = null;
  for (const component of findMaskedComponents(image, neutralPixelMaskScore)) {
    const confidence = checkboxCandidateConfidence(component, image);
    const candidate = {
      component,
      confidence,
      detector_kind: "neutral_square",
    };
    if (
      !best
      || candidate.confidence > best.confidence
      || (candidate.confidence === best.confidence && component.area > best.component.area)
    ) {
      best = candidate;
    }
  }
  return best;
}

function detectCheckboxCorrection(image, clip, pageState = {}) {
  const candidate = bestCheckboxCandidate(image);
  const component = candidate?.component;
  const confidence = candidate?.confidence ?? 0;
  if (!component || confidence < 0.5) {
    return {
      correction_status: "not_detected",
      detector: CHECKBOX_CONTROL_DETECTOR,
      confidence,
      minimum_confidence_to_execute: MIN_EXECUTION_CONFIDENCE,
    };
  }
  const imageScale = imageToViewportScale(image, clip);
  const viewportClick = {
    x: roundCoordinate(clip.x + (component.center_x / imageScale.x)),
    y: roundCoordinate(clip.y + (component.center_y / imageScale.y)),
  };
  const screenClick = clientPointToScreenEstimate(viewportClick, pageState.viewport ?? {});
  return {
    correction_status: confidence >= MIN_EXECUTION_CONFIDENCE ? "success" : "low_confidence",
    detector: CHECKBOX_CONTROL_DETECTOR,
    detector_kind: candidate.detector_kind,
    confidence,
    minimum_confidence_to_execute: MIN_EXECUTION_CONFIDENCE,
    component,
    image_to_viewport_scale: imageScale,
    corrected_coordinates: {
      coordinate_system: "viewport_css_pixels",
      click: viewportClick,
    },
    screen_estimate: screenClick
      ? {
        coordinate_system: "screen_pixels_estimate",
        click: screenClick,
      }
      : undefined,
  };
}

export {
  detectCheckboxCorrection,
};
