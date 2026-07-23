import {
  normalizeCoordinate,
  normalizeDragDurationMs,
  normalizeDragSteps,
  normalizeMouseButton,
} from "../native-core/index.mjs";

import {
  buildWindowsNativePrelude,
  parsePowerShellNativeResult,
  runWindowsPowerShellScript,
} from "./powershell.mjs";

function mouseButtonFlags(button) {
  return {
    downFlag: button === "right" ? "0x0008" : (button === "middle" ? "0x0020" : "0x0002"),
    upFlag: button === "right" ? "0x0010" : (button === "middle" ? "0x0040" : "0x0004"),
    virtualKey: button === "right" ? "0x02" : (button === "middle" ? "0x04" : "0x01"),
  };
}

function normalizeExpectedWindowHwnd(raw) {
  const value = Number(raw);
  return Number.isSafeInteger(value) && value > 0 ? value : null;
}

function windowsForegroundVerificationLines(expectedWindowHwnd) {
  const expected = normalizeExpectedWindowHwnd(expectedWindowHwnd);
  return [
    `$expectedWindowHwnd = [IntPtr]${String(expected ?? 0)}`,
    "$foregroundActivationAttempted = $false",
    "$foregroundActivationSucceeded = $false",
    "$foregroundWindow = Get-NativeForegroundWindowSnapshot",
    "if ($expectedWindowHwnd -ne [IntPtr]::Zero -and $foregroundWindow.hwnd -ne [Int64]$expectedWindowHwnd) {",
    "  $foregroundActivationAttempted = $true",
    "  $foregroundActivationSucceeded = [NativeBridge]::ForceForegroundWindow($expectedWindowHwnd)",
    "  Start-Sleep -Milliseconds 150",
    "  $foregroundWindow = Get-NativeForegroundWindowSnapshot",
    "}",
    "$foregroundWindowVerified = $expectedWindowHwnd -eq [IntPtr]::Zero -or $foregroundWindow.hwnd -eq [Int64]$expectedWindowHwnd",
  ];
}

function buildWindowsMoveScript({ expectedWindowHwnd = null, x, y }) {
  const prelude = buildWindowsNativePrelude();
  return [
    prelude,
    `$requestedX = ${String(x)}`,
    `$requestedY = ${String(y)}`,
    ...windowsForegroundVerificationLines(expectedWindowHwnd),
    "if (-not $foregroundWindowVerified) {",
    "  @{ ok = $false; error_code = 'WINDOW_NOT_FOUND'; error = 'expected foreground window could not be activated'; expected_window_hwnd = [Int64]$expectedWindowHwnd; foreground_window = $foregroundWindow; foreground_activation_attempted = [bool]$foregroundActivationAttempted; foreground_activation_succeeded = [bool]$foregroundActivationSucceeded; foreground_window_verified = [bool]$foregroundWindowVerified } | ConvertTo-Json -Compress -Depth 5",
    "  exit 7",
    "}",
    "$setCursorOk = [NativeBridge]::SetCursorPos($requestedX, $requestedY)",
    "Start-Sleep -Milliseconds 60",
    "$actualPoint = New-Object NativeBridge+POINT",
    "$getCursorOk = [NativeBridge]::GetCursorPos([ref]$actualPoint)",
    "$positionVerified = $getCursorOk -and ([Math]::Abs($actualPoint.X - $requestedX) -le 2) -and ([Math]::Abs($actualPoint.Y - $requestedY) -le 2)",
    "$diagnostic = @{ requested_point = @{ x = $requestedX; y = $requestedY }; actual_point = @{ x = $actualPoint.X; y = $actualPoint.Y }; set_cursor_ok = [bool]$setCursorOk; get_cursor_ok = [bool]$getCursorOk; position_verified = [bool]$positionVerified; expected_window_hwnd = [Int64]$expectedWindowHwnd; foreground_window = $foregroundWindow; foreground_activation_attempted = [bool]$foregroundActivationAttempted; foreground_activation_succeeded = [bool]$foregroundActivationSucceeded; foreground_window_verified = [bool]$foregroundWindowVerified; dpi_awareness = @{ method = $dpiAwarenessMethod; status = $dpiAwarenessStatus } }",
    "if (-not $setCursorOk -or -not $positionVerified) {",
    "  @{ ok = $false; error_code = 'NATIVE_INPUT_EXECUTION_FAILED'; error = 'SetCursorPos/GetCursorPos verification failed'; diagnostic = $diagnostic } | ConvertTo-Json -Compress -Depth 5",
    "  exit 9",
    "}",
    "$diagnostic.ok = $true",
    "$diagnostic.x = $requestedX",
    "$diagnostic.y = $requestedY",
    "$diagnostic | ConvertTo-Json -Compress -Depth 5",
  ].join("\n");
}

function buildWindowsDragScript({
  button,
  delayMs,
  downFlag,
  durationMs,
  expectedWindowHwnd = null,
  fromX,
  fromY,
  steps,
  toX,
  toY,
  upFlag,
  virtualKey,
}) {
  const prelude = buildWindowsNativePrelude();
  return [
    prelude,
    `$fromX = ${String(fromX)}`,
    `$fromY = ${String(fromY)}`,
    `$toX = ${String(toX)}`,
    `$toY = ${String(toY)}`,
    `$steps = ${String(steps)}`,
    `$delayMs = ${String(delayMs)}`,
    ...windowsForegroundVerificationLines(expectedWindowHwnd),
    "if (-not $foregroundWindowVerified) {",
    "  @{ ok = $false; error_code = 'WINDOW_NOT_FOUND'; error = 'expected foreground window could not be activated'; expected_window_hwnd = [Int64]$expectedWindowHwnd; foreground_window = $foregroundWindow; foreground_activation_attempted = [bool]$foregroundActivationAttempted; foreground_activation_succeeded = [bool]$foregroundActivationSucceeded; foreground_window_verified = [bool]$foregroundWindowVerified } | ConvertTo-Json -Compress -Depth 5",
    "  exit 7",
    "}",
    "$preDownSettleMs = 120",
    "$postDownSettleMs = 80",
    "$postUpSettleMs = 80",
    "$setStartOk = [NativeBridge]::SetCursorPos($fromX, $fromY)",
    "Start-Sleep -Milliseconds $preDownSettleMs",
    "$actualFrom = New-Object NativeBridge+POINT",
    "$getStartOk = [NativeBridge]::GetCursorPos([ref]$actualFrom)",
    "$startVerified = $getStartOk -and ([Math]::Abs($actualFrom.X - $fromX) -le 2) -and ([Math]::Abs($actualFrom.Y - $fromY) -le 2)",
    "if (-not $setStartOk -or -not $startVerified) {",
    "  @{ ok = $false; error_code = 'NATIVE_INPUT_EXECUTION_FAILED'; error = 'drag start cursor verification failed'; requested_from = @{ x = $fromX; y = $fromY }; actual_from = @{ x = $actualFrom.X; y = $actualFrom.Y }; set_cursor_ok = [bool]$setStartOk; get_cursor_ok = [bool]$getStartOk; position_verified = [bool]$startVerified; expected_window_hwnd = [Int64]$expectedWindowHwnd; foreground_window = $foregroundWindow; foreground_activation_attempted = [bool]$foregroundActivationAttempted; foreground_activation_succeeded = [bool]$foregroundActivationSucceeded; foreground_window_verified = [bool]$foregroundWindowVerified; dpi_awareness = @{ method = $dpiAwarenessMethod; status = $dpiAwarenessStatus } } | ConvertTo-Json -Compress -Depth 5",
    "  exit 9",
    "}",
    `$downInputCount = [NativeBridge]::SendMouseInput([uint32]${downFlag}, [uint32]0)`,
    "$downInputLastError = [Runtime.InteropServices.Marshal]::GetLastWin32Error()",
    "Start-Sleep -Milliseconds $postDownSettleMs",
    `$buttonDownObserved = (([int][NativeBridge]::GetAsyncKeyState([int]${virtualKey}) -band 0x8000) -ne 0)`,
    "$stepSetCursorOk = $true",
    "for ($index = 1; $index -le $steps; $index += 1) {",
    "  $ratio = [double]$index / [double]$steps",
    "  $x = [int][Math]::Round($fromX + (($toX - $fromX) * $ratio))",
    "  $y = [int][Math]::Round($fromY + (($toY - $fromY) * $ratio))",
    "  if (-not [NativeBridge]::SetCursorPos($x, $y)) { $stepSetCursorOk = $false }",
    "  if ($delayMs -gt 0) { Start-Sleep -Milliseconds $delayMs }",
    "}",
    "$actualToBeforeUp = New-Object NativeBridge+POINT",
    "$getTargetBeforeUpOk = [NativeBridge]::GetCursorPos([ref]$actualToBeforeUp)",
    `$upInputCount = [NativeBridge]::SendMouseInput([uint32]${upFlag}, [uint32]0)`,
    "$upInputLastError = [Runtime.InteropServices.Marshal]::GetLastWin32Error()",
    "Start-Sleep -Milliseconds $postUpSettleMs",
    "$actualTo = New-Object NativeBridge+POINT",
    "$getTargetOk = [NativeBridge]::GetCursorPos([ref]$actualTo)",
    `$buttonUpObserved = (([int][NativeBridge]::GetAsyncKeyState([int]${virtualKey}) -band 0x8000) -eq 0)`,
    "$targetVerified = $getTargetOk -and ([Math]::Abs($actualTo.X - $toX) -le 2) -and ([Math]::Abs($actualTo.Y - $toY) -le 2)",
    `$diagnostic = @{ requested_from = @{ x = $fromX; y = $fromY }; actual_from = @{ x = $actualFrom.X; y = $actualFrom.Y }; requested_to = @{ x = $toX; y = $toY }; actual_to_before_up = @{ x = $actualToBeforeUp.X; y = $actualToBeforeUp.Y }; actual_to = @{ x = $actualTo.X; y = $actualTo.Y }; set_cursor_ok = [bool]($setStartOk -and $stepSetCursorOk); get_cursor_ok = [bool]($getStartOk -and $getTargetBeforeUpOk -and $getTargetOk); position_verified = [bool]($startVerified -and $targetVerified); input_api = 'SendInput'; down_input_count = [int]$downInputCount; down_input_last_error = [int]$downInputLastError; up_input_count = [int]$upInputCount; up_input_last_error = [int]$upInputLastError; button_down_observed = [bool]$buttonDownObserved; button_up_observed = [bool]$buttonUpObserved; pre_down_settle_ms = $preDownSettleMs; post_down_settle_ms = $postDownSettleMs; post_up_settle_ms = $postUpSettleMs; expected_window_hwnd = [Int64]$expectedWindowHwnd; foreground_window = $foregroundWindow; foreground_activation_attempted = [bool]$foregroundActivationAttempted; foreground_activation_succeeded = [bool]$foregroundActivationSucceeded; foreground_window_verified = [bool]$foregroundWindowVerified; dpi_awareness = @{ method = $dpiAwarenessMethod; status = $dpiAwarenessStatus }; from_x = $fromX; from_y = $fromY; to_x = $toX; to_y = $toY; button = '${button}'; duration_ms = ${String(durationMs)}; steps = $steps }`,
    "if ($downInputCount -ne 1 -or $upInputCount -ne 1 -or -not $stepSetCursorOk -or -not $targetVerified) {",
    "  $diagnostic.ok = $false",
    "  $diagnostic.error_code = 'NATIVE_INPUT_EXECUTION_FAILED'",
    "  $diagnostic.error = 'SendInput or cursor verification failed during drag'",
    "  $diagnostic | ConvertTo-Json -Compress -Depth 5",
    "  exit 9",
    "}",
    "$diagnostic.ok = $true",
    "$diagnostic | ConvertTo-Json -Compress -Depth 5",
  ].join("\n");
}

function buildWindowsClickScript({
  button,
  count,
  downFlag,
  expectedWindowHwnd = null,
  upFlag,
  virtualKey,
  x = null,
  y = null,
}) {
  const prelude = buildWindowsNativePrelude();
  const hasRequestedPoint = Number.isFinite(x) && Number.isFinite(y);
  const cursorSetup = hasRequestedPoint
    ? [
      `$requestedX = ${String(x)}`,
      `$requestedY = ${String(y)}`,
      "$setCursorOk = [NativeBridge]::SetCursorPos($requestedX, $requestedY)",
      "Start-Sleep -Milliseconds 100",
      "$actualPoint = New-Object NativeBridge+POINT",
      "$getCursorOk = [NativeBridge]::GetCursorPos([ref]$actualPoint)",
      "$positionVerified = $getCursorOk -and ([Math]::Abs($actualPoint.X - $requestedX) -le 2) -and ([Math]::Abs($actualPoint.Y - $requestedY) -le 2)",
    ]
    : [
      "$requestedX = $null",
      "$requestedY = $null",
      "$setCursorOk = $true",
      "$actualPoint = New-Object NativeBridge+POINT",
      "$getCursorOk = [NativeBridge]::GetCursorPos([ref]$actualPoint)",
      "$positionVerified = $getCursorOk",
    ];
  return [
    prelude,
    ...cursorSetup,
    `$downFlag = [uint32]${downFlag}`,
    `$upFlag = [uint32]${upFlag}`,
    `$virtualKey = [int]${virtualKey}`,
    `$count = ${String(count)}`,
    ...windowsForegroundVerificationLines(expectedWindowHwnd),
    "if (-not $foregroundWindowVerified) {",
    "  @{ ok = $false; error_code = 'WINDOW_NOT_FOUND'; error = 'expected foreground window could not be activated'; expected_window_hwnd = [Int64]$expectedWindowHwnd; foreground_window = $foregroundWindow; foreground_activation_attempted = [bool]$foregroundActivationAttempted; foreground_activation_succeeded = [bool]$foregroundActivationSucceeded; foreground_window_verified = [bool]$foregroundWindowVerified } | ConvertTo-Json -Compress -Depth 5",
    "  exit 7",
    "}",
    "if (-not $setCursorOk -or -not $positionVerified) {",
    "  @{ ok = $false; error_code = 'NATIVE_INPUT_EXECUTION_FAILED'; error = 'click cursor verification failed'; requested_point = @{ x = $requestedX; y = $requestedY }; actual_point = @{ x = $actualPoint.X; y = $actualPoint.Y }; set_cursor_ok = [bool]$setCursorOk; get_cursor_ok = [bool]$getCursorOk; position_verified = [bool]$positionVerified; foreground_window = $foregroundWindow; dpi_awareness = @{ method = $dpiAwarenessMethod; status = $dpiAwarenessStatus } } | ConvertTo-Json -Compress -Depth 5",
    "  exit 9",
    "}",
    "$downInputCount = 0",
    "$upInputCount = 0",
    "$downInputLastError = 0",
    "$upInputLastError = 0",
    "$buttonDownObserved = $false",
    "$buttonUpObserved = $true",
    "for ($index = 0; $index -lt $count; $index += 1) {",
    "  $downInputCount += [NativeBridge]::SendMouseInput($downFlag, [uint32]0)",
    "  $downInputLastError = [Runtime.InteropServices.Marshal]::GetLastWin32Error()",
    "  Start-Sleep -Milliseconds 55",
    "  $buttonDownObserved = $buttonDownObserved -or ((([int][NativeBridge]::GetAsyncKeyState($virtualKey) -band 0x8000) -ne 0))",
    "  $upInputCount += [NativeBridge]::SendMouseInput($upFlag, [uint32]0)",
    "  $upInputLastError = [Runtime.InteropServices.Marshal]::GetLastWin32Error()",
    "  Start-Sleep -Milliseconds 65",
    "  $buttonUpObserved = $buttonUpObserved -and ((([int][NativeBridge]::GetAsyncKeyState($virtualKey) -band 0x8000) -eq 0))",
    "}",
    `$diagnostic = @{ requested_point = ${hasRequestedPoint ? "@{ x = $requestedX; y = $requestedY }" : "$null"}; actual_point = @{ x = $actualPoint.X; y = $actualPoint.Y }; set_cursor_ok = [bool]$setCursorOk; get_cursor_ok = [bool]$getCursorOk; position_verified = [bool]$positionVerified; input_api = 'SendInput'; down_input_count = [int]$downInputCount; down_input_last_error = [int]$downInputLastError; up_input_count = [int]$upInputCount; up_input_last_error = [int]$upInputLastError; button_down_observed = [bool]$buttonDownObserved; button_up_observed = [bool]$buttonUpObserved; expected_window_hwnd = [Int64]$expectedWindowHwnd; foreground_window = $foregroundWindow; foreground_activation_attempted = [bool]$foregroundActivationAttempted; foreground_activation_succeeded = [bool]$foregroundActivationSucceeded; foreground_window_verified = [bool]$foregroundWindowVerified; dpi_awareness = @{ method = $dpiAwarenessMethod; status = $dpiAwarenessStatus }; x = $actualPoint.X; y = $actualPoint.Y; button = '${button}'; count = $count }`,
    "if ($downInputCount -ne $count -or $upInputCount -ne $count) {",
    "  $diagnostic.ok = $false",
    "  $diagnostic.error_code = 'NATIVE_INPUT_EXECUTION_FAILED'",
    "  $diagnostic.error = 'SendInput failed during click'",
    "  $diagnostic | ConvertTo-Json -Compress -Depth 5",
    "  exit 9",
    "}",
    "$diagnostic.ok = $true",
    "$diagnostic | ConvertTo-Json -Compress -Depth 5",
  ].join("\n");
}

async function movePointer(args, timeoutMs) {
  const x = normalizeCoordinate(args?.x, "x");
  const y = normalizeCoordinate(args?.y, "y");
  const script = buildWindowsMoveScript({
    expectedWindowHwnd: normalizeExpectedWindowHwnd(args?.expected_window_hwnd),
    x,
    y,
  });
  const response = await runWindowsPowerShellScript(script, timeoutMs);
  const parsed = parsePowerShellNativeResult(response, "move");
  return {
    driver: "windows-powershell",
    ...parsed,
  };
}

async function dragPointer(args, timeoutMs) {
  const fromX = normalizeCoordinate(args?.from_x, "from_x");
  const fromY = normalizeCoordinate(args?.from_y, "from_y");
  const toX = normalizeCoordinate(args?.to_x, "to_x");
  const toY = normalizeCoordinate(args?.to_y, "to_y");
  const button = normalizeMouseButton(args?.button);
  const { downFlag, upFlag, virtualKey } = mouseButtonFlags(button);
  const durationMs = normalizeDragDurationMs(args?.duration_ms);
  const steps = normalizeDragSteps(args?.steps);
  const delayMs = steps > 0 ? Math.max(0, Math.round(durationMs / Math.max(1, steps + 1))) : 0;
  const script = buildWindowsDragScript({
    button,
    delayMs,
    downFlag,
    durationMs,
    expectedWindowHwnd: normalizeExpectedWindowHwnd(args?.expected_window_hwnd),
    fromX,
    fromY,
    steps,
    toX,
    toY,
    upFlag,
    virtualKey,
  });
  const response = await runWindowsPowerShellScript(script, timeoutMs);
  const parsed = parsePowerShellNativeResult(response, "drag");
  return {
    driver: "windows-powershell",
    ...parsed,
  };
}

async function clickPointer(action, args, timeoutMs) {
  const hasCoordinates = args?.x !== undefined && args?.y !== undefined;
  const x = hasCoordinates ? normalizeCoordinate(args.x, "x") : null;
  const y = hasCoordinates ? normalizeCoordinate(args.y, "y") : null;
  const button = normalizeMouseButton(args?.button);
  const { downFlag, upFlag, virtualKey } = mouseButtonFlags(button);
  const count = action === "double_click" ? 2 : 1;
  const script = buildWindowsClickScript({
    button,
    count,
    downFlag,
    expectedWindowHwnd: normalizeExpectedWindowHwnd(args?.expected_window_hwnd),
    upFlag,
    virtualKey,
    x,
    y,
  });
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
  buildWindowsClickScript,
  buildWindowsDragScript,
  buildWindowsMoveScript,
  clickPointer,
  dragPointer,
  movePointer,
  scrollPointer,
};
