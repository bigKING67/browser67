import { createToolError } from "../errors.mjs";

import {
  activateWindow,
  getWindowRect,
  pasteText,
  pressKey,
  typeText,
} from "./keyboard-window.mjs";
import {
  clickPointer,
  dragPointer,
  movePointer,
  scrollPointer,
} from "./pointer.mjs";

async function runNativeInputWindows(action, args, timeoutMs) {
  if (action === "activate_window") {
    return activateWindow(args, timeoutMs);
  }
  if (action === "move") {
    return movePointer(args, timeoutMs);
  }
  if (action === "drag") {
    return dragPointer(args, timeoutMs);
  }
  if (action === "click" || action === "double_click") {
    return clickPointer(action, args, timeoutMs);
  }
  if (action === "press") {
    return pressKey(args, timeoutMs);
  }
  if (action === "type") {
    return typeText(args, timeoutMs);
  }
  if (action === "paste") {
    return pasteText(args, timeoutMs);
  }
  if (action === "scroll") {
    return scrollPointer(args, timeoutMs);
  }
  if (action === "get_window_rect") {
    return getWindowRect(args, timeoutMs);
  }
  throw createToolError("ACTION_NOT_SUPPORTED", `action not supported: ${action}`);
}

export { runNativeInputWindows };
