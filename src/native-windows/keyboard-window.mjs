import { createToolError } from "../errors.mjs";
import { parseWindowSelector } from "../native-core.mjs";

import {
  buildWindowsNativePrelude,
  buildWindowsTargetLookup,
  escapePowerShellString,
  escapeWindowsSendKeysText,
  parsePowerShellNativeResult,
  runWindowsPowerShellScript,
  toWindowsSendKeys,
} from "./powershell.mjs";

async function activateWindow(args, timeoutMs) {
  const selector = parseWindowSelector(args);
  if (!selector.title && !selector.pid) {
    throw createToolError("WINDOW_NOT_FOUND", "window not found: window_title or window_pid is required");
  }
  const prelude = buildWindowsNativePrelude();
  const script = [
    prelude,
    buildWindowsTargetLookup(selector),
    "if (-not $target) {",
    "  @{ ok = $false; error_code = 'WINDOW_NOT_FOUND'; error = 'window not found' } | ConvertTo-Json -Compress",
    "  exit 7",
    "}",
    "[NativeBridge]::ShowWindowAsync($target.MainWindowHandle, 9) | Out-Null",
    "$focus = [NativeBridge]::SetForegroundWindow($target.MainWindowHandle)",
    "@{ ok = $true; pid = $target.Id; title = $target.MainWindowTitle; hwnd = [Int64]$target.MainWindowHandle; focused = [bool]$focus } | ConvertTo-Json -Compress",
  ].join("\n");
  const response = await runWindowsPowerShellScript(script, timeoutMs);
  const parsed = parsePowerShellNativeResult(response, "activate_window");
  return {
    driver: "windows-powershell",
    ...parsed,
  };
}

async function pressKey(args, timeoutMs) {
  const prelude = buildWindowsNativePrelude();
  const key = toWindowsSendKeys(args?.key);
  const script = [
    prelude,
    `[System.Windows.Forms.SendKeys]::SendWait('${escapePowerShellString(key)}')`,
    `@{ ok = $true; key = '${escapePowerShellString(String(args?.key ?? ""))}' } | ConvertTo-Json -Compress`,
  ].join("\n");
  const response = await runWindowsPowerShellScript(script, timeoutMs);
  const parsed = parsePowerShellNativeResult(response, "press");
  return {
    driver: "windows-powershell",
    ...parsed,
  };
}

async function typeText(args, timeoutMs) {
  const prelude = buildWindowsNativePrelude();
  const text = String(args?.text ?? "");
  const script = [
    prelude,
    `[System.Windows.Forms.SendKeys]::SendWait('${escapePowerShellString(escapeWindowsSendKeysText(text))}')`,
    `@{ ok = $true; text_length = ${String(text.length)} } | ConvertTo-Json -Compress`,
  ].join("\n");
  const response = await runWindowsPowerShellScript(script, timeoutMs);
  const parsed = parsePowerShellNativeResult(response, "type");
  return {
    driver: "windows-powershell",
    ...parsed,
  };
}

async function pasteText(args, timeoutMs) {
  const prelude = buildWindowsNativePrelude();
  const text = args?.text === undefined ? "" : String(args?.text);
  const script = [
    prelude,
    text.length > 0 ? `Set-Clipboard -Value '${escapePowerShellString(text)}'` : "",
    "[System.Windows.Forms.SendKeys]::SendWait('^v')",
    `@{ ok = $true; used_clipboard = ${text.length > 0 ? "$true" : "$false"} } | ConvertTo-Json -Compress`,
  ].filter(Boolean).join("\n");
  const response = await runWindowsPowerShellScript(script, timeoutMs);
  const parsed = parsePowerShellNativeResult(response, "paste");
  return {
    driver: "windows-powershell",
    ...parsed,
  };
}

async function getWindowRect(args, timeoutMs) {
  const selector = parseWindowSelector(args);
  const prelude = buildWindowsNativePrelude();
  const script = [
    prelude,
    buildWindowsTargetLookup(selector),
    "$hwnd = [IntPtr]::Zero",
    "if ($target) {",
    "  $hwnd = $target.MainWindowHandle",
    "} else {",
    "  $hwnd = [NativeBridge]::GetForegroundWindow()",
    "}",
    "if ($hwnd -eq [IntPtr]::Zero) {",
    "  @{ ok = $false; error_code = 'WINDOW_NOT_FOUND'; error = 'window not found' } | ConvertTo-Json -Compress",
    "  exit 7",
    "}",
    "$rect = New-Object NativeBridge+RECT",
    "$ok = [NativeBridge]::GetWindowRect($hwnd, [ref]$rect)",
    "if (-not $ok) {",
    "  @{ ok = $false; error_code = 'NATIVE_INPUT_EXECUTION_FAILED'; error = 'GetWindowRect failed' } | ConvertTo-Json -Compress",
    "  exit 9",
    "}",
    "$width = $rect.Right - $rect.Left",
    "$height = $rect.Bottom - $rect.Top",
    "@{ ok = $true; left = $rect.Left; top = $rect.Top; right = $rect.Right; bottom = $rect.Bottom; width = $width; height = $height; hwnd = [Int64]$hwnd } | ConvertTo-Json -Compress",
  ].join("\n");
  const response = await runWindowsPowerShellScript(script, timeoutMs);
  const parsed = parsePowerShellNativeResult(response, "get_window_rect");
  return {
    driver: "windows-powershell",
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
