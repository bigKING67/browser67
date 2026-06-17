import { createToolError } from "../errors.mjs";
import {
  NATIVE_INPUT_ACTIONS_WITH_CAPABILITIES,
  NATIVE_INPUT_DEFAULT_TIMEOUT_MS,
  NATIVE_INPUT_MAX_TIMEOUT_MS,
} from "./constants.mjs";

function normalizeNativeInputTimeoutMs(raw) {
  const parsed = Number(raw ?? NATIVE_INPUT_DEFAULT_TIMEOUT_MS);
  if (!Number.isFinite(parsed)) {
    return NATIVE_INPUT_DEFAULT_TIMEOUT_MS;
  }
  return Math.max(500, Math.min(NATIVE_INPUT_MAX_TIMEOUT_MS, Math.floor(parsed)));
}

function normalizeNativeInputAction(raw) {
  const value = String(raw ?? "").trim().toLowerCase();
  const allowed = new Set(NATIVE_INPUT_ACTIONS_WITH_CAPABILITIES);
  if (!allowed.has(value)) {
    throw createToolError("ACTION_NOT_SUPPORTED", `action not supported: ${value || "<empty>"}`);
  }
  return value;
}

function normalizeMouseButton(raw) {
  const value = String(raw ?? "left").trim().toLowerCase();
  if (value === "left" || value === "middle" || value === "right") {
    return value;
  }
  throw createToolError("ACTION_NOT_SUPPORTED", `action not supported: button=${value}`);
}

function normalizeCoordinate(raw, axisName) {
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) {
    throw createToolError("COORDINATE_OUT_OF_RANGE", `coordinate out of range: ${axisName} is not finite`);
  }
  const value = Math.round(parsed);
  if (value < 0 || value > 100_000) {
    throw createToolError("COORDINATE_OUT_OF_RANGE", `coordinate out of range: ${axisName}=${String(value)}`);
  }
  return value;
}

function normalizeDragDurationMs(raw) {
  const parsed = Number(raw ?? 700);
  if (!Number.isFinite(parsed)) {
    return 700;
  }
  return Math.max(0, Math.min(10_000, Math.round(parsed)));
}

function normalizeDragSteps(raw) {
  const parsed = Number(raw ?? 16);
  if (!Number.isFinite(parsed)) {
    return 16;
  }
  return Math.max(1, Math.min(240, Math.round(parsed)));
}

export {
  normalizeCoordinate,
  normalizeDragDurationMs,
  normalizeDragSteps,
  normalizeMouseButton,
  normalizeNativeInputAction,
  normalizeNativeInputTimeoutMs,
};
