import { commandExists, ensureNativeCommandOk, parseWindowSelector, runNativeCommand } from "../native-core/index.mjs";

import {
  parseWindowGeometryFromShell,
  resolveLinuxWindowId,
  toLinuxXdotoolKey,
} from "./xdotool.mjs";

async function activateWindow(args, timeoutMs) {
  const selector = parseWindowSelector(args);
  const windowId = await resolveLinuxWindowId(selector, timeoutMs);
  const activate = await runNativeCommand("xdotool", ["windowactivate", "--sync", windowId], { timeoutMs });
  ensureNativeCommandOk(activate, "xdotool windowactivate");
  return {
    driver: "linux-xdotool",
    window_id: windowId,
  };
}

async function pressKey(args, timeoutMs) {
  const key = toLinuxXdotoolKey(args?.key);
  const press = await runNativeCommand("xdotool", ["key", "--clearmodifiers", key], { timeoutMs });
  ensureNativeCommandOk(press, "xdotool key");
  return {
    driver: "linux-xdotool",
    key,
  };
}

async function typeText(args, timeoutMs) {
  const text = String(args?.text ?? "");
  const delayRaw = Number(args?.delay_ms ?? 6);
  const delay = Number.isFinite(delayRaw) ? Math.max(0, Math.min(1_000, Math.floor(delayRaw))) : 6;
  const typed = await runNativeCommand("xdotool", ["type", "--delay", String(delay), text], { timeoutMs });
  ensureNativeCommandOk(typed, "xdotool type");
  return {
    driver: "linux-xdotool",
    text_length: text.length,
    delay_ms: delay,
  };
}

async function pasteText(args, timeoutMs) {
  const text = args?.text === undefined ? null : String(args?.text);
  let fallbackUsed = "none";
  if (text !== null) {
    const hasXclip = await commandExists("xclip", Math.min(timeoutMs, 2_000));
    if (hasXclip) {
      const clipboard = await runNativeCommand(
        "xclip",
        ["-selection", "clipboard"],
        { timeoutMs, input: text },
      );
      ensureNativeCommandOk(clipboard, "xclip");
    } else {
      const typed = await runNativeCommand("xdotool", ["type", "--delay", "6", text], { timeoutMs });
      ensureNativeCommandOk(typed, "xdotool type (paste fallback)");
      fallbackUsed = "typed_text_instead_of_clipboard";
      return {
        driver: "linux-xdotool",
        used_clipboard: false,
        fallback_used: fallbackUsed,
        text_length: text.length,
      };
    }
  }
  const paste = await runNativeCommand("xdotool", ["key", "--clearmodifiers", "ctrl+v"], { timeoutMs });
  ensureNativeCommandOk(paste, "xdotool key ctrl+v");
  return {
    driver: "linux-xdotool",
    used_clipboard: text !== null,
    fallback_used: fallbackUsed,
  };
}

async function getWindowRect(args, timeoutMs) {
  const selector = parseWindowSelector(args);
  const windowId = await resolveLinuxWindowId(selector, timeoutMs);
  const geometry = await runNativeCommand("xdotool", ["getwindowgeometry", "--shell", windowId], { timeoutMs });
  ensureNativeCommandOk(geometry, "xdotool getwindowgeometry");
  const parsed = parseWindowGeometryFromShell(geometry.stdout);
  return {
    driver: "linux-xdotool",
    window_id: windowId,
    ...parsed,
  };
}

export {
  activateWindow,
  getWindowRect,
  pasteText,
  pressKey,
  typeText,
};
