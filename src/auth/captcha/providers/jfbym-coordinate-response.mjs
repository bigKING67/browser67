import { finiteNumber } from "../coordinates.mjs";
import { CAPTCHA_ASSIST_REASONS } from "../reasons.mjs";
import { providerMessage, providerStatusCode } from "./jfbym-client.mjs";

const PROTOCOL_KINDS_AS_CHECKBOX = new Set(["hcaptcha", "recaptcha", "turnstile"]);

function imageCoordinateKind(kind = "") {
  return PROTOCOL_KINDS_AS_CHECKBOX.has(kind) ? "checkbox" : kind;
}

function numbersFromString(value) {
  return String(value ?? "")
    .match(/-?\d+(?:\.\d+)?/g)
    ?.map((entry) => Number(entry))
    .filter((entry) => Number.isFinite(entry)) ?? [];
}

function pointFromObject(value = {}) {
  const x = finiteNumber(value.x ?? value.left ?? value.target_x ?? value.px);
  const y = finiteNumber(value.y ?? value.top ?? value.target_y ?? value.py);
  return x === null || y === null ? null : { x, y };
}

function pointsFromAny(data) {
  if (Array.isArray(data)) {
    return data.map((entry) => {
      if (Array.isArray(entry)) {
        const x = finiteNumber(entry[0]);
        const y = finiteNumber(entry[1]);
        return x === null || y === null ? null : { x, y };
      }
      if (entry && typeof entry === "object") return pointFromObject(entry);
      return null;
    }).filter(Boolean);
  }
  if (data && typeof data === "object") {
    const objectPoint = pointFromObject(data);
    if (objectPoint) return [objectPoint];
    return pointsFromAny(data.points ?? data.coordinates ?? data.coords ?? data.list ?? data.data);
  }
  const text = String(data ?? "");
  const groups = text.split(/[|;]/g)
    .map((group) => numbersFromString(group))
    .filter((numbers) => numbers.length >= 2)
    .map((numbers) => ({ x: numbers[0], y: numbers[1] }));
  if (groups.length > 0) return groups;
  const numbers = numbersFromString(text);
  const points = [];
  for (let index = 0; index + 1 < numbers.length; index += 2) {
    points.push({ x: numbers[index], y: numbers[index + 1] });
  }
  return points;
}

function scalarFromAny(data, names = []) {
  if (data && typeof data === "object" && !Array.isArray(data)) {
    for (const name of names) {
      const value = finiteNumber(data[name]);
      if (value !== null) return value;
    }
    return scalarFromAny(data.data ?? data.result ?? data.value, names);
  }
  if (Array.isArray(data)) return finiteNumber(data[0]);
  const [value] = numbersFromString(data);
  return Number.isFinite(value) ? value : null;
}

function responseData(responseJson = {}) {
  const data = responseJson.data;
  if (data && typeof data === "object" && !Array.isArray(data)) {
    return data.data
      ?? data.result
      ?? data.res
      ?? data.value
      ?? data.coordinates
      ?? data;
  }
  return data ?? responseJson.result ?? responseJson.value ?? responseJson;
}

function responseConfidence(responseJson = {}) {
  const candidates = [
    responseJson.confidence,
    responseJson.score,
    responseJson.data?.confidence,
    responseJson.data?.score,
  ];
  for (const raw of candidates) {
    const value = finiteNumber(raw);
    if (value !== null) {
      return value > 1 ? Math.min(1, value / 100) : Math.max(0, value);
    }
  }
  return null;
}

function successCode(code) {
  return code === 10000 || code === 0 || code === "10000" || code === "0" || code === "success";
}

function unavailable(code, message) {
  return {
    ok: false,
    reason: CAPTCHA_ASSIST_REASONS.PROVIDER_COORDINATES_UNAVAILABLE,
    provider_id: "jfbym",
    provider_code: code,
    provider_message: message,
    secrets_redacted: true,
  };
}

function parseJfbymCoordinateResponse(responseJson = {}, {
  captcha_kind = "checkbox",
  min_confidence = 0.65,
} = {}) {
  const code = providerStatusCode(responseJson);
  const message = providerMessage(responseJson);
  if (!successCode(code)) {
    return {
      ok: false,
      reason: CAPTCHA_ASSIST_REASONS.PROVIDER_COORDINATE_SOLVER_FAILED,
      provider_id: "jfbym",
      provider_code: code,
      provider_message: message,
      secrets_redacted: true,
    };
  }
  const data = responseData(responseJson);
  const confidence = responseConfidence(responseJson);
  if (confidence !== null && confidence < min_confidence) {
    return {
      ok: false,
      reason: CAPTCHA_ASSIST_REASONS.PROVIDER_COORDINATES_CONFIDENCE_TOO_LOW,
      provider_id: "jfbym",
      provider_code: code,
      provider_message: message,
      confidence,
      minimum_confidence: min_confidence,
      secrets_redacted: true,
    };
  }
  const kind = imageCoordinateKind(captcha_kind);
  const points = pointsFromAny(data);
  const distance = scalarFromAny(data, ["distance", "offset", "move", "dx", "x"]);
  const angle = scalarFromAny(data, ["angle", "rotate", "degree"]);

  if (kind === "rotate") {
    if (angle === null) return unavailable(code, message);
    return {
      ok: true,
      provider_id: "jfbym",
      provider_code: code,
      provider_message: message,
      captcha_kind,
      parsed_kind: kind,
      confidence: confidence ?? undefined,
      rotate_angle_degrees: angle,
      secrets_redacted: true,
    };
  }

  if (kind === "slider") {
    if (points.length === 0 && distance === null) return unavailable(code, message);
    return {
      ok: true,
      provider_id: "jfbym",
      provider_code: code,
      provider_message: message,
      captcha_kind,
      parsed_kind: kind,
      confidence: confidence ?? undefined,
      image_points: points,
      distance_px: distance ?? undefined,
      secrets_redacted: true,
    };
  }

  if (points.length === 0) return unavailable(code, message);
  return {
    ok: true,
    provider_id: "jfbym",
    provider_code: code,
    provider_message: message,
    captcha_kind,
    parsed_kind: kind,
    confidence: confidence ?? undefined,
    image_points: points,
    secrets_redacted: true,
  };
}

export { imageCoordinateKind, parseJfbymCoordinateResponse };
