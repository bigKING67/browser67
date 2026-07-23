import { createToolError } from "../runtime/tool-errors.mjs";
import {
  normalizeCoordinate,
  normalizeDragDurationMs,
  normalizeDragSteps,
  normalizeMouseButton,
} from "./normalize.mjs";
import { parseWindowSelector } from "./window-selector.mjs";

function validateNativeInputArguments(action, args) {
  const input = args ?? {};
  if (action === "capabilities") {
    return {};
  }
  const rawWindowTabId = input.window_tab_id;
  const windowTabId = rawWindowTabId === undefined || rawWindowTabId === null || rawWindowTabId === ""
    ? null
    : Number(rawWindowTabId);
  if (windowTabId !== null && (!Number.isSafeInteger(windowTabId) || windowTabId <= 0)) {
    throw createToolError("WINDOW_NOT_FOUND", "window not found: window_tab_id must be a positive safe integer");
  }
  if (action === "activate_window") {
    const selector = parseWindowSelector(input);
    const windowUrl = String(input.window_url ?? "").trim();
    if (!selector.title && !selector.pid && !windowUrl && windowTabId === null) {
      throw createToolError("WINDOW_NOT_FOUND", "window not found: window_title, window_pid, window_tab_id, or window_url is required");
    }
    return {
      window_title: selector.title || undefined,
      window_pid: selector.pid ?? undefined,
      window_tab_id: windowTabId ?? undefined,
      window_url: windowUrl || undefined,
      window_application: String(input.window_application ?? "").trim() || undefined,
    };
  }
  if (action === "move") {
    return {
      x: normalizeCoordinate(input.x, "x"),
      y: normalizeCoordinate(input.y, "y"),
    };
  }
  if (action === "drag") {
    return {
      from_x: normalizeCoordinate(input.from_x, "from_x"),
      from_y: normalizeCoordinate(input.from_y, "from_y"),
      to_x: normalizeCoordinate(input.to_x, "to_x"),
      to_y: normalizeCoordinate(input.to_y, "to_y"),
      button: normalizeMouseButton(input.button),
      duration_ms: normalizeDragDurationMs(input.duration_ms),
      steps: normalizeDragSteps(input.steps),
      window_tab_id: windowTabId ?? undefined,
      window_url: String(input.window_url ?? "").trim() || undefined,
      window_application: String(input.window_application ?? "").trim() || undefined,
    };
  }
  if (action === "click" || action === "double_click") {
    const normalized = {
      button: normalizeMouseButton(input.button),
    };
    const hasX = input.x !== undefined;
    const hasY = input.y !== undefined;
    if (hasX !== hasY) {
      throw createToolError("COORDINATE_OUT_OF_RANGE", "coordinate out of range: both x and y are required together");
    }
    if (hasX && hasY) {
      normalized.x = normalizeCoordinate(input.x, "x");
      normalized.y = normalizeCoordinate(input.y, "y");
    }
    normalized.window_tab_id = windowTabId ?? undefined;
    normalized.window_url = String(input.window_url ?? "").trim() || undefined;
    normalized.window_application = String(input.window_application ?? "").trim() || undefined;
    return normalized;
  }
  if (action === "press") {
    const key = String(input.key ?? "").trim();
    if (!key) {
      throw createToolError("ACTION_NOT_SUPPORTED", "action not supported: press requires key");
    }
    return {
      key,
    };
  }
  if (action === "type") {
    if (input.text === undefined || input.text === null) {
      throw createToolError("ACTION_NOT_SUPPORTED", "action not supported: type requires text");
    }
    const text = String(input.text);
    const delayRaw = Number(input.delay_ms ?? 6);
    const delayMs = Number.isFinite(delayRaw) ? Math.max(0, Math.min(10_000, Math.floor(delayRaw))) : 6;
    return {
      text,
      text_length: text.length,
      delay_ms: delayMs,
    };
  }
  if (action === "paste") {
    if (input.text === undefined || input.text === null) {
      return {
        use_existing_clipboard: true,
      };
    }
    const text = String(input.text);
    return {
      text,
      text_length: text.length,
      use_existing_clipboard: false,
    };
  }
  if (action === "scroll") {
    const deltaXRaw = Number(input.delta_x ?? 0);
    const deltaYRaw = Number(input.delta_y ?? 0);
    const deltaX = Number.isFinite(deltaXRaw) ? Math.max(-24_000, Math.min(24_000, Math.round(deltaXRaw))) : 0;
    const deltaY = Number.isFinite(deltaYRaw) ? Math.max(-24_000, Math.min(24_000, Math.round(deltaYRaw))) : 0;
    return {
      delta_x: deltaX,
      delta_y: deltaY,
    };
  }
  if (action === "get_window_rect") {
    const selector = parseWindowSelector(input);
    return {
      window_title: selector.title || undefined,
      window_pid: selector.pid ?? undefined,
      window_tab_id: windowTabId ?? undefined,
      window_url: String(input.window_url ?? "").trim() || undefined,
      window_application: String(input.window_application ?? "").trim() || undefined,
    };
  }
  throw createToolError("ACTION_NOT_SUPPORTED", `action not supported: ${action}`);
}

export {
  validateNativeInputArguments,
};
