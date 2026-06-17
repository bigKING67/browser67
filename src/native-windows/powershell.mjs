import { createToolError } from "../errors.mjs";
import {
  commandExists,
  ensureNativeCommandOk,
  parseJsonFromCommandOutput,
  runNativeCommand,
} from "../native-core.mjs";

function escapePowerShellString(raw) {
  return String(raw ?? "").replace(/'/g, "''");
}

function escapeWindowsSendKeysText(raw) {
  return String(raw ?? "").replace(/[+^%~(){}]/g, (token) => {
    if (token === "{") {
      return "{{}";
    }
    if (token === "}") {
      return "{}}";
    }
    return `{${token}}`;
  });
}

function toWindowsSendKeys(raw) {
  const normalized = String(raw ?? "").trim();
  if (!normalized) {
    throw createToolError("ACTION_NOT_SUPPORTED", "action not supported: empty key");
  }
  const pieces = normalized.split("+").map((item) => item.trim().toLowerCase()).filter(Boolean);
  if (pieces.length === 0) {
    throw createToolError("ACTION_NOT_SUPPORTED", "action not supported: empty key");
  }
  const keyToken = pieces[pieces.length - 1];
  const modifierTokens = pieces.slice(0, -1);
  const modifierMap = new Map([
    ["ctrl", "^"],
    ["control", "^"],
    ["shift", "+"],
    ["alt", "%"],
    ["option", "%"],
    ["cmd", "^"],
    ["command", "^"],
    ["meta", "^"],
    ["win", "^"],
  ]);
  let prefix = "";
  for (const modifier of modifierTokens) {
    if (!modifierMap.has(modifier)) {
      throw createToolError("ACTION_NOT_SUPPORTED", `action not supported: key modifier=${modifier}`);
    }
    prefix += modifierMap.get(modifier);
  }
  const keyMap = new Map([
    ["enter", "{ENTER}"],
    ["return", "{ENTER}"],
    ["tab", "{TAB}"],
    ["esc", "{ESC}"],
    ["escape", "{ESC}"],
    ["space", " "],
    ["up", "{UP}"],
    ["down", "{DOWN}"],
    ["left", "{LEFT}"],
    ["right", "{RIGHT}"],
    ["backspace", "{BACKSPACE}"],
    ["delete", "{DELETE}"],
    ["home", "{HOME}"],
    ["end", "{END}"],
    ["pageup", "{PGUP}"],
    ["pagedown", "{PGDN}"],
  ]);
  if (keyMap.has(keyToken)) {
    return `${prefix}${keyMap.get(keyToken)}`;
  }
  if (/^f([1-9]|1[0-2])$/.test(keyToken)) {
    return `${prefix}{${keyToken.toUpperCase()}}`;
  }
  if (keyToken.length === 1) {
    return `${prefix}${escapeWindowsSendKeysText(keyToken)}`;
  }
  return `${prefix}{${keyToken.toUpperCase()}}`;
}

async function runWindowsPowerShellScript(script, timeoutMs) {
  const [hasWindowsPowerShell, hasPowerShellCore] = await Promise.all([
    commandExists("powershell", Math.min(timeoutMs, 2_000)),
    commandExists("pwsh", Math.min(timeoutMs, 2_000)),
  ]);
  const command = hasWindowsPowerShell ? "powershell" : (hasPowerShellCore ? "pwsh" : "");
  if (!command) {
    throw createToolError("ACTION_NOT_SUPPORTED", "action not supported: powershell not found");
  }
  return runNativeCommand(command, [
    "-NoProfile",
    "-NonInteractive",
    "-ExecutionPolicy",
    "Bypass",
    "-Command",
    script,
  ], {
    timeoutMs,
  });
}

function buildWindowsNativePrelude() {
  return [
    "Add-Type -AssemblyName System.Windows.Forms",
    "Add-Type -AssemblyName System.Drawing",
    "Add-Type @\"",
    "using System;",
    "using System.Runtime.InteropServices;",
    "public static class NativeBridge {",
    "  [StructLayout(LayoutKind.Sequential)]",
    "  public struct RECT { public int Left; public int Top; public int Right; public int Bottom; }",
    "  [DllImport(\"user32.dll\")] public static extern bool SetForegroundWindow(IntPtr hWnd);",
    "  [DllImport(\"user32.dll\")] public static extern bool ShowWindowAsync(IntPtr hWnd, int nCmdShow);",
    "  [DllImport(\"user32.dll\")] public static extern IntPtr GetForegroundWindow();",
    "  [DllImport(\"user32.dll\")] public static extern bool GetWindowRect(IntPtr hWnd, out RECT lpRect);",
    "  [DllImport(\"user32.dll\")] public static extern void mouse_event(uint dwFlags, uint dx, uint dy, uint dwData, UIntPtr dwExtraInfo);",
    "}",
    "\"@",
  ].join("\n");
}

function buildWindowsTargetLookup(selector) {
  const title = escapePowerShellString(selector.title);
  const pid = Number.isInteger(selector.pid) ? selector.pid : null;
  return [
    "$target = $null",
    pid
      ? `$target = Get-Process -Id ${String(pid)} -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowHandle -ne 0 } | Select-Object -First 1`
      : "",
    `$lookupTitle = '${title}'`,
    "if (-not $target -and $lookupTitle -ne '') {",
    "  $target = Get-Process | Where-Object { $_.MainWindowHandle -ne 0 -and $_.MainWindowTitle -like ('*' + $lookupTitle + '*') } | Select-Object -First 1",
    "}",
  ].filter(Boolean).join("\n");
}

function parsePowerShellNativeResult(result, fallbackAction) {
  const parsed = parseJsonFromCommandOutput(result.stdout);
  if (!parsed) {
    ensureNativeCommandOk(result, "powershell");
    throw new Error(`native input execution failed: missing powershell json output action=${fallbackAction}`);
  }
  if (parsed.ok === false) {
    const code = typeof parsed.error_code === "string" ? parsed.error_code : "NATIVE_INPUT_EXECUTION_FAILED";
    const message = String(parsed.error ?? `native input execution failed action=${fallbackAction}`);
    throw createToolError(code, message, { details: parsed });
  }
  if (result.code !== 0) {
    ensureNativeCommandOk(result, "powershell");
  }
  return parsed;
}

export {
  buildWindowsNativePrelude,
  buildWindowsTargetLookup,
  escapePowerShellString,
  escapeWindowsSendKeysText,
  parsePowerShellNativeResult,
  runWindowsPowerShellScript,
  toWindowsSendKeys,
};
