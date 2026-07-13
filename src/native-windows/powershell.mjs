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
    "Add-Type @\"",
    "using System;",
    "using System.Runtime.InteropServices;",
    "public static class NativeBridge {",
    "  [StructLayout(LayoutKind.Sequential)]",
    "  public struct RECT { public int Left; public int Top; public int Right; public int Bottom; }",
    "  [StructLayout(LayoutKind.Sequential)]",
    "  public struct POINT { public int X; public int Y; }",
    "  [StructLayout(LayoutKind.Sequential)]",
    "  public struct MOUSEINPUT { public int dx; public int dy; public uint mouseData; public uint dwFlags; public uint time; public UIntPtr dwExtraInfo; }",
    "  [StructLayout(LayoutKind.Explicit)]",
    "  public struct INPUTUNION { [FieldOffset(0)] public MOUSEINPUT mi; }",
    "  [StructLayout(LayoutKind.Sequential)]",
    "  public struct INPUT { public uint type; public INPUTUNION U; }",
    "  [DllImport(\"user32.dll\")] public static extern bool SetForegroundWindow(IntPtr hWnd);",
    "  [DllImport(\"user32.dll\")] public static extern bool ShowWindowAsync(IntPtr hWnd, int nCmdShow);",
    "  [DllImport(\"user32.dll\")] public static extern bool IsIconic(IntPtr hWnd);",
    "  [DllImport(\"user32.dll\")] public static extern bool BringWindowToTop(IntPtr hWnd);",
    "  [DllImport(\"user32.dll\")] public static extern bool AttachThreadInput(uint idAttach, uint idAttachTo, bool fAttach);",
    "  [DllImport(\"user32.dll\")] public static extern IntPtr GetForegroundWindow();",
    "  [DllImport(\"user32.dll\")] public static extern bool GetWindowRect(IntPtr hWnd, out RECT lpRect);",
    "  [DllImport(\"user32.dll\")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint lpdwProcessId);",
    "  [DllImport(\"user32.dll\", SetLastError = true)] public static extern bool SetCursorPos(int X, int Y);",
    "  [DllImport(\"user32.dll\")] public static extern bool GetCursorPos(out POINT lpPoint);",
    "  [DllImport(\"user32.dll\")] public static extern short GetAsyncKeyState(int vKey);",
    "  [DllImport(\"user32.dll\", SetLastError = true)] public static extern uint SendInput(uint nInputs, INPUT[] pInputs, int cbSize);",
    "  [DllImport(\"user32.dll\")] public static extern void mouse_event(uint dwFlags, uint dx, uint dy, uint dwData, UIntPtr dwExtraInfo);",
    "  [DllImport(\"user32.dll\")] public static extern bool SetProcessDPIAware();",
    "  [DllImport(\"user32.dll\")] public static extern bool SetProcessDpiAwarenessContext(IntPtr dpiContext);",
    "  [DllImport(\"kernel32.dll\")] public static extern uint GetCurrentThreadId();",
    "  public static bool ForceForegroundWindow(IntPtr hWnd) {",
    "    if (hWnd == IntPtr.Zero) return false;",
    "    IntPtr foregroundHwnd = GetForegroundWindow();",
    "    uint foregroundProcessId = 0;",
    "    uint targetProcessId = 0;",
    "    uint foregroundThreadId = foregroundHwnd == IntPtr.Zero ? 0 : GetWindowThreadProcessId(foregroundHwnd, out foregroundProcessId);",
    "    uint targetThreadId = GetWindowThreadProcessId(hWnd, out targetProcessId);",
    "    uint currentThreadId = GetCurrentThreadId();",
    "    bool attachedForeground = false;",
    "    bool attachedTarget = false;",
    "    try {",
    "      if (foregroundThreadId != 0 && foregroundThreadId != currentThreadId) attachedForeground = AttachThreadInput(currentThreadId, foregroundThreadId, true);",
    "      if (targetThreadId != 0 && targetThreadId != currentThreadId && targetThreadId != foregroundThreadId) attachedTarget = AttachThreadInput(currentThreadId, targetThreadId, true);",
    "      ShowWindowAsync(hWnd, IsIconic(hWnd) ? 9 : 5);",
    "      BringWindowToTop(hWnd);",
    "      SetForegroundWindow(hWnd);",
    "    } finally {",
    "      if (attachedTarget) AttachThreadInput(currentThreadId, targetThreadId, false);",
    "      if (attachedForeground) AttachThreadInput(currentThreadId, foregroundThreadId, false);",
    "    }",
    "    return GetForegroundWindow() == hWnd;",
    "  }",
    "  public static uint SendMouseInput(uint flags, uint mouseData) {",
    "    INPUT input = new INPUT();",
    "    input.type = 0;",
    "    input.U.mi.dx = 0;",
    "    input.U.mi.dy = 0;",
    "    input.U.mi.mouseData = mouseData;",
    "    input.U.mi.dwFlags = flags;",
    "    input.U.mi.time = 0;",
    "    input.U.mi.dwExtraInfo = UIntPtr.Zero;",
    "    return SendInput(1, new INPUT[] { input }, Marshal.SizeOf(typeof(INPUT)));",
    "  }",
    "}",
    "\"@",
    "$dpiAware = $false",
    "$dpiAwarenessMethod = 'none'",
    "$dpiAwarenessStatus = 'unavailable'",
    "try {",
    "  $dpiAware = [NativeBridge]::SetProcessDpiAwarenessContext([IntPtr](-4))",
    "  if ($dpiAware) { $dpiAwarenessMethod = 'SetProcessDpiAwarenessContext'; $dpiAwarenessStatus = 'success' }",
    "} catch { $dpiAware = $false }",
    "if (-not $dpiAware) {",
    "  try {",
    "    $legacyDpiAware = [NativeBridge]::SetProcessDPIAware()",
    "    $dpiAwarenessMethod = 'SetProcessDPIAware'",
    "    $dpiAwarenessStatus = if ($legacyDpiAware) { 'success' } else { 'already_configured_or_denied' }",
    "  } catch { $dpiAwarenessStatus = 'failed' }",
    "}",
    "Add-Type -AssemblyName System.Windows.Forms",
    "Add-Type -AssemblyName System.Drawing",
    "function Get-NativeWindowSnapshot([IntPtr]$windowHwnd) {",
    "  [uint32]$windowProcessId = 0",
    "  if ($windowHwnd -ne [IntPtr]::Zero) { [NativeBridge]::GetWindowThreadProcessId($windowHwnd, [ref]$windowProcessId) | Out-Null }",
    "  $windowTitle = ''",
    "  $processName = ''",
    "  if ($windowProcessId -gt 0) {",
    "    $windowProcess = Get-Process -Id $windowProcessId -ErrorAction SilentlyContinue",
    "    if ($windowProcess) { $windowTitle = [string]$windowProcess.MainWindowTitle; $processName = [string]$windowProcess.ProcessName }",
    "  }",
    "  return @{ hwnd = [Int64]$windowHwnd; pid = [Int64]$windowProcessId; process_name = $processName; title = $windowTitle }",
    "}",
    "function Get-NativeForegroundWindowSnapshot {",
    "  return Get-NativeWindowSnapshot ([NativeBridge]::GetForegroundWindow())",
    "}",
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
