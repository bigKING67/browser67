import { createToolError } from "../errors.mjs";
import { ensureNativeCommandOk, parseWindowSelector } from "../native-core.mjs";

import {
  buildAppleModifiersClause,
  escapeAppleScriptString,
  parseAppleKeyChord,
  runAppleScript,
} from "./apple-script.mjs";

async function activateWindow(args, timeoutMs) {
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

async function pressKey(args, timeoutMs) {
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

async function typeText(args, timeoutMs) {
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

async function pasteText(args, timeoutMs) {
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

async function getWindowRect(_args, timeoutMs) {
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

export {
  activateWindow,
  getWindowRect,
  pasteText,
  pressKey,
  typeText,
};
