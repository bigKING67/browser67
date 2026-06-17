import {
  clientPointToScreenEstimate,
  finiteNumber,
  roundCoordinate,
} from "../coordinates.mjs";
import {
  findMaskedComponents,
  neutralPixelMaskScore,
  saturatedPixelMaskScore,
} from "./components.mjs";
import {
  MIN_EXECUTION_CONFIDENCE,
  SLIDER_HANDLE_DETECTOR,
} from "./constants.mjs";

function sliderCandidateConfidence(component, image, options = {}) {
  if (!component) {
    return 0;
  }
  const neutral = options.neutral === true;
  const areaRatio = component.area / Math.max(1, image.width * image.height);
  const sizeOk = component.width >= (neutral ? 24 : 12) && component.height >= (neutral ? 24 : 12);
  const leftBiased = component.center_x <= image.width * (neutral ? 0.48 : 0.62);
  const compact = component.width <= image.width * (neutral ? 0.36 : 0.5)
    && component.height <= image.height * 0.88;
  const dense = component.density >= (neutral ? 0.35 : 0.25);
  const areaOk = areaRatio >= (neutral ? 0.018 : 0.01);
  if (sizeOk && leftBiased && compact && dense && areaOk) {
    return Math.min(0.97, 0.86 + Math.min(0.08, areaRatio * 1.4) + Math.min(0.03, component.density * 0.03));
  }
  if (sizeOk && leftBiased && compact && dense) {
    return 0.72;
  }
  if (sizeOk && compact) {
    return 0.62;
  }
  return 0.35;
}

function bestSliderHandleCandidate(image) {
  const detectors = [
    {
      kind: "saturated",
      neutral: false,
      components: findMaskedComponents(image, saturatedPixelMaskScore),
    },
    {
      kind: "neutral",
      neutral: true,
      components: findMaskedComponents(image, neutralPixelMaskScore),
    },
  ];
  let best = null;
  for (const detector of detectors) {
    for (const component of detector.components) {
      const confidence = sliderCandidateConfidence(component, image, detector);
      const candidate = {
        component,
        confidence,
        detector_kind: detector.kind,
      };
      if (
        !best
        || candidate.confidence > best.confidence
        || (candidate.confidence === best.confidence && component.area > best.component.area)
      ) {
        best = candidate;
      }
    }
  }
  return best;
}

function imageToViewportScale(image, clip) {
  const fallbackScale = finiteNumber(clip.scale) ?? 1;
  const clipWidth = finiteNumber(clip.width);
  const clipHeight = finiteNumber(clip.height);
  const imageWidth = finiteNumber(image.width);
  const imageHeight = finiteNumber(image.height);
  const scaleX = clipWidth && imageWidth ? imageWidth / clipWidth : fallbackScale;
  const scaleY = clipHeight && imageHeight ? imageHeight / clipHeight : fallbackScale;
  return {
    x: scaleX > 0 ? scaleX : fallbackScale,
    y: scaleY > 0 ? scaleY : fallbackScale,
    source: clipWidth && clipHeight && imageWidth && imageHeight
      ? "captured_image_pixels_per_viewport_css_pixel"
      : "cdp_clip_scale_fallback",
  };
}

function detectSliderCorrection(image, clip, pageState = {}, planned = {}) {
  const candidate = bestSliderHandleCandidate(image);
  const component = candidate?.component;
  const confidence = candidate?.confidence ?? 0;
  if (!component || confidence < 0.5) {
    return {
      correction_status: "not_detected",
      detector: SLIDER_HANDLE_DETECTOR,
      confidence,
      minimum_confidence_to_execute: MIN_EXECUTION_CONFIDENCE,
    };
  }
  const imageScale = imageToViewportScale(image, clip);
  const viewportFrom = {
    x: roundCoordinate(clip.x + (component.center_x / imageScale.x)),
    y: roundCoordinate(clip.y + (component.center_y / imageScale.y)),
  };
  const viewportTo = computeViewportTo({ component, imageScale, pageState, planned, viewportFrom });
  const screenFrom = clientPointToScreenEstimate(viewportFrom, pageState.viewport ?? {});
  const screenTo = viewportTo ? clientPointToScreenEstimate(viewportTo, pageState.viewport ?? {}) : null;
  return {
    correction_status: confidence >= MIN_EXECUTION_CONFIDENCE ? "success" : "low_confidence",
    detector: SLIDER_HANDLE_DETECTOR,
    detector_kind: candidate?.detector_kind,
    confidence,
    minimum_confidence_to_execute: MIN_EXECUTION_CONFIDENCE,
    component,
    image_to_viewport_scale: imageScale,
    corrected_coordinates: {
      coordinate_system: "viewport_css_pixels",
      drag: viewportTo
        ? {
          from: viewportFrom,
          to: viewportTo,
        }
        : undefined,
    },
    screen_estimate: (screenFrom && screenTo)
      ? {
        coordinate_system: "screen_pixels_estimate",
        drag: {
          from: screenFrom,
          to: screenTo,
        },
      }
      : undefined,
  };
}

function computeViewportTo({ component, imageScale, pageState, planned, viewportFrom }) {
  const fallbackTo = planned.slider_drag_hint?.to_client;
  const targetRect = pageState.target?.rect;
  if (fallbackTo) {
    return {
      x: roundCoordinate(fallbackTo.x),
      y: roundCoordinate(viewportFrom.y),
    };
  }
  if (!targetRect) {
    return undefined;
  }
  const componentWidthCss = component.width / Math.max(1, imageScale?.x ?? 1);
  return {
    x: roundCoordinate(targetRect.right - Math.max(8, componentWidthCss / 2)),
    y: roundCoordinate(viewportFrom.y),
  };
}

function unsupportedCorrection(target = "auto") {
  return {
    correction_status: "not_supported",
    detector: SLIDER_HANDLE_DETECTOR,
    confidence: 0,
    minimum_confidence_to_execute: MIN_EXECUTION_CONFIDENCE,
    note: `vision correction detector does not yet support target ${String(target)}`,
  };
}

export {
  detectSliderCorrection,
  imageToViewportScale,
  unsupportedCorrection,
};
