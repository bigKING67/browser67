import {
  finiteNumber,
  roundCoordinate,
} from "../coordinates.mjs";
import { MAX_CAPTURE_PIXELS } from "./constants.mjs";

function normalizeClip(raw = {}) {
  const x = finiteNumber(raw.x);
  const y = finiteNumber(raw.y);
  const width = finiteNumber(raw.width);
  const height = finiteNumber(raw.height);
  const scale = finiteNumber(raw.scale) ?? 1;
  if (x === null || y === null || width === null || height === null || width <= 0 || height <= 0) {
    return null;
  }
  if (width * height > MAX_CAPTURE_PIXELS) {
    throw new Error(`CAPTCHA capture clip too large: ${String(Math.round(width * height))} pixels`);
  }
  return {
    x: roundCoordinate(x),
    y: roundCoordinate(y),
    width: roundCoordinate(width),
    height: roundCoordinate(height),
    scale: roundCoordinate(scale),
  };
}

export {
  normalizeClip,
};
