import { createToolError } from "../runtime/tool-errors.mjs";
import { runNativeCommand } from "../native-core/index.mjs";

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

export {
  buildAppleModifiersClause,
  escapeAppleScriptString,
  parseAppleKeyChord,
  runAppleScript,
};
