import {
  normalizeCoordinate,
  normalizeDragDurationMs,
  normalizeDragSteps,
  normalizeMouseButton,
} from "../native-core.mjs";

import {
  buildWindowsNativePrelude,
  parsePowerShellNativeResult,
  runWindowsPowerShellScript,
} from "./powershell.mjs";

function mouseButtonFlags(button) {
  return {
    downFlag: button === "right" ? "0x0008" : (button === "middle" ? "0x0020" : "0x0002"),
    upFlag: button === "right" ? "0x0010" : (button === "middle" ? "0x0040" : "0x0004"),
  };
}

async function movePointer(args, timeoutMs) {
  const prelude = buildWindowsNativePrelude();
  const x = normalizeCoordinate(args?.x, "x");
  const y = normalizeCoordinate(args?.y, "y");
  const script = [
    prelude,
    `[System.Windows.Forms.Cursor]::Position = New-Object System.Drawing.Point(${String(x)}, ${String(y)})`,
    `@{ ok = $true; x = ${String(x)}; y = ${String(y)} } | ConvertTo-Json -Compress`,
  ].join("\n");
  const response = await runWindowsPowerShellScript(script, timeoutMs);
  const parsed = parsePowerShellNativeResult(response, "move");
  return {
    driver: "windows-powershell",
    ...parsed,
  };
}

async function dragPointer(args, timeoutMs) {
  const prelude = buildWindowsNativePrelude();
  const fromX = normalizeCoordinate(args?.from_x, "from_x");
  const fromY = normalizeCoordinate(args?.from_y, "from_y");
  const toX = normalizeCoordinate(args?.to_x, "to_x");
  const toY = normalizeCoordinate(args?.to_y, "to_y");
  const button = normalizeMouseButton(args?.button);
  const { downFlag, upFlag } = mouseButtonFlags(button);
  const durationMs = normalizeDragDurationMs(args?.duration_ms);
  const steps = normalizeDragSteps(args?.steps);
  const delayMs = steps > 0 ? Math.max(0, Math.round(durationMs / Math.max(1, steps + 1))) : 0;
  const script = [
    prelude,
    `$fromX = ${String(fromX)}`,
    `$fromY = ${String(fromY)}`,
    `$toX = ${String(toX)}`,
    `$toY = ${String(toY)}`,
    `$steps = ${String(steps)}`,
    `$delayMs = ${String(delayMs)}`,
    "[System.Windows.Forms.Cursor]::Position = New-Object System.Drawing.Point($fromX, $fromY)",
    `[NativeBridge]::mouse_event([uint32]${downFlag}, 0, 0, 0, [UIntPtr]::Zero)`,
    "for ($index = 1; $index -le $steps; $index += 1) {",
    "  $ratio = [double]$index / [double]$steps",
    "  $x = [int][Math]::Round($fromX + (($toX - $fromX) * $ratio))",
    "  $y = [int][Math]::Round($fromY + (($toY - $fromY) * $ratio))",
    "  [System.Windows.Forms.Cursor]::Position = New-Object System.Drawing.Point($x, $y)",
    "  if ($delayMs -gt 0) { Start-Sleep -Milliseconds $delayMs }",
    "}",
    `[NativeBridge]::mouse_event([uint32]${upFlag}, 0, 0, 0, [UIntPtr]::Zero)`,
    `@{ ok = $true; from_x = ${String(fromX)}; from_y = ${String(fromY)}; to_x = ${String(toX)}; to_y = ${String(toY)}; button = '${button}'; duration_ms = ${String(durationMs)}; steps = ${String(steps)} } | ConvertTo-Json -Compress`,
  ].join("\n");
  const response = await runWindowsPowerShellScript(script, timeoutMs);
  const parsed = parsePowerShellNativeResult(response, "drag");
  return {
    driver: "windows-powershell",
    ...parsed,
  };
}

async function clickPointer(action, args, timeoutMs) {
  const prelude = buildWindowsNativePrelude();
  if (args?.x !== undefined || args?.y !== undefined) {
    await movePointer(args, timeoutMs);
  }
  const button = normalizeMouseButton(args?.button);
  const { downFlag, upFlag } = mouseButtonFlags(button);
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

async function scrollPointer(args, timeoutMs) {
  const prelude = buildWindowsNativePrelude();
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
  const parsed = parsePowerShellNativeResult(response, "scroll");
  return {
    driver: "windows-powershell",
    ...parsed,
  };
}

export {
  clickPointer,
  dragPointer,
  movePointer,
  scrollPointer,
};
