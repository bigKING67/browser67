const DEFAULT_MAX_SCREENSHOT_PIXELS = 12_000_000;
const HARD_MAX_SCREENSHOT_PIXELS = 50_000_000;

function finiteNumber(raw) {
  const value = Number(raw);
  return Number.isFinite(value) ? value : null;
}

function roundCoordinate(raw) {
  const value = finiteNumber(raw);
  return value === null ? null : Math.round(value * 100) / 100;
}

function invalidArgument(message, details = {}) {
  const error = new Error(message);
  error.errorCode = "INVALID_ARGUMENT";
  error.retryable = false;
  error.details = details;
  throw error;
}

function normalizeMaxPixels(raw) {
  const parsed = finiteNumber(raw);
  if (parsed === null) {
    return DEFAULT_MAX_SCREENSHOT_PIXELS;
  }
  return Math.max(1, Math.min(HARD_MAX_SCREENSHOT_PIXELS, Math.floor(parsed)));
}

function pixelArea(width, height) {
  const normalizedWidth = finiteNumber(width);
  const normalizedHeight = finiteNumber(height);
  if (normalizedWidth === null || normalizedHeight === null) {
    return null;
  }
  return normalizedWidth * normalizedHeight;
}

function assertPixelBudget(width, height, maxPixels, label = "screenshot") {
  const area = pixelArea(width, height);
  if (area === null || area <= 0) {
    invalidArgument(`${label} dimensions must be positive finite numbers`, {
      width,
      height,
    });
  }
  if (area > maxPixels) {
    invalidArgument(`${label} exceeds max_pixels`, {
      width,
      height,
      area,
      max_pixels: maxPixels,
    });
  }
  return area;
}

function assertBitmapPixelBudget(width, height, maxPixels, options = {}) {
  const label = options.label ?? "screenshot";
  const areaCssPixels = assertPixelBudget(width, height, Number.POSITIVE_INFINITY, label);
  const dpr = finiteNumber(options.dpr ?? options.devicePixelRatio ?? 1);
  const scale = finiteNumber(options.scale ?? 1);
  if (dpr === null || dpr <= 0) {
    invalidArgument(`${label} device pixel ratio must be a positive finite number`, {
      device_pixel_ratio: options.dpr ?? options.devicePixelRatio,
    });
  }
  if (scale === null || scale <= 0) {
    invalidArgument(`${label} capture scale must be a positive finite number`, {
      capture_scale: options.scale,
    });
  }
  const bitmapWidth = Math.ceil(Number(width) * dpr * scale);
  const bitmapHeight = Math.ceil(Number(height) * dpr * scale);
  const areaBitmapPixels = bitmapWidth * bitmapHeight;
  const metrics = {
    area_css_pixels: areaCssPixels,
    device_pixel_ratio: dpr,
    capture_scale: scale,
    bitmap_width: bitmapWidth,
    bitmap_height: bitmapHeight,
    area_bitmap_pixels: areaBitmapPixels,
    max_pixels: maxPixels,
  };
  if (areaBitmapPixels > maxPixels) {
    invalidArgument(`${label} exceeds max_pixels after device pixel ratio and capture scale`, metrics);
  }
  return metrics;
}

function normalizeClip(raw, options = {}) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    invalidArgument("target=clip requires clip object", {
      required_fields: ["x", "y", "width", "height"],
    });
  }
  const maxPixels = normalizeMaxPixels(options.maxPixels);
  const x = roundCoordinate(raw.x);
  const y = roundCoordinate(raw.y);
  const width = roundCoordinate(raw.width);
  const height = roundCoordinate(raw.height);
  const scale = roundCoordinate(raw.scale ?? 1);
  if (x === null || y === null || width === null || height === null) {
    invalidArgument("clip coordinates must be finite numbers", {
      required_fields: ["x", "y", "width", "height"],
    });
  }
  if (x < 0 || y < 0 || width <= 0 || height <= 0) {
    invalidArgument("clip coordinates must be non-negative and dimensions must be positive", {
      x,
      y,
      width,
      height,
    });
  }
  if (scale === null || scale <= 0 || scale > 4) {
    invalidArgument("clip.scale must be a positive number up to 4", {
      scale,
    });
  }
  const budget = assertBitmapPixelBudget(width, height, maxPixels, {
    dpr: options.dpr,
    label: options.label ?? "clip",
    scale,
  });
  return {
    clip: {
      x,
      y,
      width,
      height,
      scale,
    },
    area_css_pixels: budget.area_css_pixels,
    area_bitmap_pixels: budget.area_bitmap_pixels,
    bitmap_width: budget.bitmap_width,
    bitmap_height: budget.bitmap_height,
    device_pixel_ratio: budget.device_pixel_ratio,
    capture_scale: budget.capture_scale,
    max_pixels: maxPixels,
  };
}

export {
  DEFAULT_MAX_SCREENSHOT_PIXELS,
  HARD_MAX_SCREENSHOT_PIXELS,
  assertBitmapPixelBudget,
  assertPixelBudget,
  finiteNumber,
  normalizeClip,
  normalizeMaxPixels,
  pixelArea,
  roundCoordinate,
};
