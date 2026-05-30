import { createToolError } from "./errors.mjs";
import {
  ensureNativeCommandOk,
  normalizeCoordinate,
  normalizeMouseButton,
  parseJsonFromCommandOutput,
  parseWindowSelector,
  runNativeCommand,
} from "./native-core.mjs";

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
  const commands = ["powershell", "pwsh"];
  let missingCount = 0;
  for (const command of commands) {
    try {
      const result = await runNativeCommand(command, [
        "-NoProfile",
        "-NonInteractive",
        "-ExecutionPolicy",
        "Bypass",
        "-Command",
        script,
      ], {
        timeoutMs,
      });
      return result;
    } catch (error) {
      if (error?.code === "ENOENT") {
        missingCount += 1;
        continue;
      }
      throw error;
    }
  }
  if (missingCount >= commands.length) {
    throw createToolError("ACTION_NOT_SUPPORTED", "action not supported: powershell not found");
  }
  throw createToolError("NATIVE_INPUT_EXECUTION_FAILED", "native input execution failed: powershell unavailable");
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

async function runNativeInputWindows(action, args, timeoutMs) {
  const selector = parseWindowSelector(args);
  const prelude = buildWindowsNativePrelude();
  if (action === "activate_window") {
    if (!selector.title && !selector.pid) {
      throw createToolError("WINDOW_NOT_FOUND", "window not found: window_title or window_pid is required");
    }
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
    const parsed = parsePowerShellNativeResult(response, action);
    return {
      driver: "windows-powershell",
      ...parsed,
    };
  }
  if (action === "move") {
    const x = normalizeCoordinate(args?.x, "x");
    const y = normalizeCoordinate(args?.y, "y");
    const script = [
      prelude,
      `[System.Windows.Forms.Cursor]::Position = New-Object System.Drawing.Point(${String(x)}, ${String(y)})`,
      `@{ ok = $true; x = ${String(x)}; y = ${String(y)} } | ConvertTo-Json -Compress`,
    ].join("\n");
    const response = await runWindowsPowerShellScript(script, timeoutMs);
    const parsed = parsePowerShellNativeResult(response, action);
    return {
      driver: "windows-powershell",
      ...parsed,
    };
  }
  if (action === "click" || action === "double_click") {
    if (args?.x !== undefined || args?.y !== undefined) {
      const x = normalizeCoordinate(args?.x, "x");
      const y = normalizeCoordinate(args?.y, "y");
      const moveScript = [
        prelude,
        `[System.Windows.Forms.Cursor]::Position = New-Object System.Drawing.Point(${String(x)}, ${String(y)})`,
        "@{ ok = $true } | ConvertTo-Json -Compress",
      ].join("\n");
      const moveResult = await runWindowsPowerShellScript(moveScript, timeoutMs);
      parsePowerShellNativeResult(moveResult, "move");
    }
    const button = normalizeMouseButton(args?.button);
    const downFlag = button === "right" ? "0x0008" : (button === "middle" ? "0x0020" : "0x0002");
    const upFlag = button === "right" ? "0x0010" : (button === "middle" ? "0x0040" : "0x0004");
    const count = action === "double_click" ? 2 : 1;
    const script = [
      prelude,
      `$downFlag = [uint32]${downFlag}`,
      `$upFlag = [uint32]${upFlag}`,
      `$count = ${String(count)}`,
      "for ($index = 0; $index -lt $count; $index += 1) {",
      "  [NativeBridge]::mouse_event($downFlag, 0, 0, 0, [UIntPtr]::Zero)",
      "  Start-Sleep -Milliseconds 35",
      "  [NativeBridge]::mouse_event($upFlag, 0, 0, 0, [UIntPtr]::Zero)",
      "  if ($index -lt ($count - 1)) { Start-Sleep -Milliseconds 55 }",
      "}",
      `@{ ok = $true; button = '${button}'; count = ${String(count)} } | ConvertTo-Json -Compress`,
    ].join("\n");
    const response = await runWindowsPowerShellScript(script, timeoutMs);
    const parsed = parsePowerShellNativeResult(response, action);
    return {
      driver: "windows-powershell",
      ...parsed,
    };
  }
  if (action === "press") {
    const key = toWindowsSendKeys(args?.key);
    const script = [
      prelude,
      `[System.Windows.Forms.SendKeys]::SendWait('${escapePowerShellString(key)}')`,
      `@{ ok = $true; key = '${escapePowerShellString(String(args?.key ?? ""))}' } | ConvertTo-Json -Compress`,
    ].join("\n");
    const response = await runWindowsPowerShellScript(script, timeoutMs);
    const parsed = parsePowerShellNativeResult(response, action);
    return {
      driver: "windows-powershell",
      ...parsed,
    };
  }
  if (action === "type") {
    const text = String(args?.text ?? "");
    const script = [
      prelude,
      `[System.Windows.Forms.SendKeys]::SendWait('${escapePowerShellString(escapeWindowsSendKeysText(text))}')`,
      `@{ ok = $true; text_length = ${String(text.length)} } | ConvertTo-Json -Compress`,
    ].join("\n");
    const response = await runWindowsPowerShellScript(script, timeoutMs);
    const parsed = parsePowerShellNativeResult(response, action);
    return {
      driver: "windows-powershell",
      ...parsed,
    };
  }
  if (action === "paste") {
    const text = args?.text === undefined ? "" : String(args?.text);
    const script = [
      prelude,
      text.length > 0 ? `Set-Clipboard -Value '${escapePowerShellString(text)}'` : "",
      "[System.Windows.Forms.SendKeys]::SendWait('^v')",
      `@{ ok = $true; used_clipboard = ${text.length > 0 ? "$true" : "$false"} } | ConvertTo-Json -Compress`,
    ].filter(Boolean).join("\n");
    const response = await runWindowsPowerShellScript(script, timeoutMs);
    const parsed = parsePowerShellNativeResult(response, action);
    return {
      driver: "windows-powershell",
      ...parsed,
    };
  }
  if (action === "scroll") {
    const deltaYRaw = Number(args?.delta_y ?? 0);
    const deltaY = Number.isFinite(deltaYRaw) ? Math.max(-24_000, Math.min(24_000, Math.round(deltaYRaw))) : 0;
    if (deltaY === 0) {
      return {
        driver: "windows-powershell",
        ok: true,
        delta_y: 0,
      };
    }
    const script = [
      prelude,
      `[NativeBridge]::mouse_event([uint32]0x0800, 0, 0, ${String(deltaY)}, [UIntPtr]::Zero)`,
      `@{ ok = $true; delta_y = ${String(deltaY)} } | ConvertTo-Json -Compress`,
    ].join("\n");
    const response = await runWindowsPowerShellScript(script, timeoutMs);
    const parsed = parsePowerShellNativeResult(response, action);
    return {
      driver: "windows-powershell",
      ...parsed,
    };
  }
  if (action === "get_window_rect") {
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
    const parsed = parsePowerShellNativeResult(response, action);
    return {
      driver: "windows-powershell",
      ...parsed,
    };
  }
  throw createToolError("ACTION_NOT_SUPPORTED", `action not supported: ${action}`);
}

export { runNativeInputWindows };
