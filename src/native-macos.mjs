import { createToolError } from "./errors.mjs";
import {
  commandExists,
  ensureNativeCommandOk,
  normalizeCoordinate,
  normalizeMouseButton,
  parseWindowSelector,
  runNativeCommand,
} from "./native-core.mjs";

function escapeAppleScriptString(raw) {
  return String(raw ?? "")
    .replace(/\\/g, "\\\\")
    .replace(/"/g, "\\\"");
}

function parseAppleKeyChord(raw) {
  const normalized = String(raw ?? "").trim();
  if (!normalized) {
    throw createToolError("ACTION_NOT_SUPPORTED", "action not supported: empty key");
  }
  const pieces = normalized.split("+").map((item) => item.trim().toLowerCase()).filter(Boolean);
  if (pieces.length === 0) {
    throw createToolError("ACTION_NOT_SUPPORTED", "action not supported: empty key");
  }
  const mainKey = pieces[pieces.length - 1];
  const modifierMap = new Map([
    ["cmd", "command down"],
    ["command", "command down"],
    ["meta", "command down"],
    ["win", "command down"],
    ["shift", "shift down"],
    ["alt", "option down"],
    ["option", "option down"],
    ["ctrl", "control down"],
    ["control", "control down"],
  ]);
  const modifiers = [];
  for (const token of pieces.slice(0, -1)) {
    if (!modifierMap.has(token)) {
      throw createToolError("ACTION_NOT_SUPPORTED", `action not supported: key modifier=${token}`);
    }
    const mapped = modifierMap.get(token);
    if (!modifiers.includes(mapped)) {
      modifiers.push(mapped);
    }
  }
  const keyCodeMap = new Map([
    ["enter", 36],
    ["return", 36],
    ["tab", 48],
    ["esc", 53],
    ["escape", 53],
    ["space", 49],
    ["left", 123],
    ["right", 124],
    ["down", 125],
    ["up", 126],
    ["delete", 51],
    ["backspace", 51],
    ["forwarddelete", 117],
    ["home", 115],
    ["end", 119],
    ["pageup", 116],
    ["pagedown", 121],
  ]);
  const keyCode = keyCodeMap.get(mainKey);
  if (keyCode !== undefined) {
    return {
      keyCode,
      keyText: "",
      modifiers,
    };
  }
  if (mainKey.length === 1) {
    return {
      keyCode: null,
      keyText: mainKey,
      modifiers,
    };
  }
  throw createToolError("ACTION_NOT_SUPPORTED", `action not supported: key=${mainKey}`);
}

function buildAppleModifiersClause(modifiers) {
  if (!Array.isArray(modifiers) || modifiers.length === 0) {
    return "";
  }
  return ` using {${modifiers.join(", ")}}`;
}

async function runAppleScript(lines, timeoutMs) {
  const args = [];
  for (const line of lines) {
    args.push("-e", line);
  }
  return runNativeCommand("osascript", args, { timeoutMs });
}

async function runNativeInputMac(action, args, timeoutMs) {
  if (action === "activate_window") {
    const selector = parseWindowSelector(args);
    if (!selector.title && !selector.pid) {
      throw createToolError("WINDOW_NOT_FOUND", "window not found: window_title or window_pid is required");
    }
    const lines = [
      "tell application \"System Events\"",
      selector.pid
        ? `  set targetProcess to first process whose unix id is ${String(selector.pid)}`
        : `  set targetProcess to first process whose name contains \"${escapeAppleScriptString(selector.title)}\"`,
      "  set frontmost of targetProcess to true",
      "  return name of targetProcess",
      "end tell",
    ];
    const result = await runAppleScript(lines, timeoutMs);
    ensureNativeCommandOk(result, "osascript activate_window");
    return {
      driver: "macos-osascript",
      target: String(result.stdout ?? "").trim() || null,
    };
  }
  if (action === "press") {
    const parsed = parseAppleKeyChord(args?.key);
    const modifiers = buildAppleModifiersClause(parsed.modifiers);
    const keyCommand = parsed.keyCode !== null
      ? `tell application "System Events" to key code ${String(parsed.keyCode)}${modifiers}`
      : `tell application "System Events" to keystroke "${escapeAppleScriptString(parsed.keyText)}"${modifiers}`;
    const result = await runAppleScript([keyCommand], timeoutMs);
    ensureNativeCommandOk(result, "osascript press");
    return {
      driver: "macos-osascript",
      key: String(args?.key ?? ""),
    };
  }
  if (action === "type") {
    const text = String(args?.text ?? "");
    const result = await runAppleScript([
      `tell application "System Events" to keystroke "${escapeAppleScriptString(text)}"`,
    ], timeoutMs);
    ensureNativeCommandOk(result, "osascript type");
    return {
      driver: "macos-osascript",
      text_length: text.length,
    };
  }
  if (action === "paste") {
    const lines = [];
    if (args?.text !== undefined) {
      lines.push(`set the clipboard to "${escapeAppleScriptString(String(args.text))}"`);
    }
    lines.push("tell application \"System Events\" to keystroke \"v\" using {command down}");
    const result = await runAppleScript(lines, timeoutMs);
    ensureNativeCommandOk(result, "osascript paste");
    return {
      driver: "macos-osascript",
      used_clipboard: args?.text !== undefined,
    };
  }
  if (action === "get_window_rect") {
    const lines = [
      "tell application \"System Events\"",
      "  set frontProc to first process whose frontmost is true",
      "  if (count of windows of frontProc) is 0 then error \"window not found\"",
      "  set p to position of front window of frontProc",
      "  set s to size of front window of frontProc",
      "  set t to name of front window of frontProc",
      "end tell",
      "return (item 1 of p as text) & \",\" & (item 2 of p as text) & \",\" & (item 1 of s as text) & \",\" & (item 2 of s as text) & \",\" & t",
    ];
    const result = await runAppleScript(lines, timeoutMs);
    ensureNativeCommandOk(result, "osascript get_window_rect");
    const pieces = String(result.stdout ?? "").trim().split(",");
    if (pieces.length < 5) {
      throw new Error(`native input execution failed: invalid mac window rect output=${result.stdout}`);
    }
    const left = Number.parseInt(pieces[0] ?? "", 10);
    const top = Number.parseInt(pieces[1] ?? "", 10);
    const width = Number.parseInt(pieces[2] ?? "", 10);
    const height = Number.parseInt(pieces[3] ?? "", 10);
    if (!Number.isFinite(left) || !Number.isFinite(top) || !Number.isFinite(width) || !Number.isFinite(height)) {
      throw new Error(`native input execution failed: invalid mac window rect numbers=${result.stdout}`);
    }
    return {
      driver: "macos-osascript",
      left,
      top,
      width,
      height,
      title: pieces.slice(4).join(","),
    };
  }

  const hasCliclick = await commandExists("cliclick", Math.min(timeoutMs, 2_000));
  if (!hasCliclick) {
    throw createToolError("ACTION_NOT_SUPPORTED", "action not supported: cliclick is required on macOS for pointer actions", {
      details: { required_binary: "cliclick" },
    });
  }

  if (action === "move") {
    const x = normalizeCoordinate(args?.x, "x");
    const y = normalizeCoordinate(args?.y, "y");
    const result = await runNativeCommand("cliclick", [`m:${String(x)},${String(y)}`], { timeoutMs });
    ensureNativeCommandOk(result, "cliclick move");
    return {
      driver: "macos-cliclick",
      x,
      y,
    };
  }
  if (action === "click" || action === "double_click") {
    const x = normalizeCoordinate(args?.x, "x");
    const y = normalizeCoordinate(args?.y, "y");
    const button = normalizeMouseButton(args?.button);
    const base = button === "right" ? "rc" : (button === "middle" ? "mc" : "c");
    const count = action === "double_click" ? 2 : 1;
    const commands = [];
    for (let index = 0; index < count; index += 1) {
      commands.push(`${base}:${String(x)},${String(y)}`);
    }
    const result = await runNativeCommand("cliclick", commands, { timeoutMs });
    ensureNativeCommandOk(result, "cliclick click");
    return {
      driver: "macos-cliclick",
      x,
      y,
      button,
      count,
    };
  }
  if (action === "scroll") {
    const deltaXRaw = Number(args?.delta_x ?? 0);
    const deltaYRaw = Number(args?.delta_y ?? 0);
    const deltaX = Number.isFinite(deltaXRaw) ? Math.max(-1_000, Math.min(1_000, Math.round(deltaXRaw))) : 0;
    const deltaY = Number.isFinite(deltaYRaw) ? Math.max(-1_000, Math.min(1_000, Math.round(deltaYRaw))) : 0;
    const result = await runNativeCommand("cliclick", [`w:${String(deltaX)},${String(deltaY)}`], { timeoutMs });
    ensureNativeCommandOk(result, "cliclick scroll");
    return {
      driver: "macos-cliclick",
      delta_x: deltaX,
      delta_y: deltaY,
    };
  }
  throw createToolError("ACTION_NOT_SUPPORTED", `action not supported: ${action}`);
}

export { runNativeInputMac };
