import { createToolError } from "../errors.mjs";
import {
  ensureNativeCommandOk,
  normalizeCoordinate,
  normalizeDragDurationMs,
  normalizeDragSteps,
  normalizeMouseButton,
  runNativeCommand,
} from "../native-core.mjs";

async function movePointer(args, timeoutMs) {
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

async function dragPointer(args, timeoutMs) {
  const fromX = normalizeCoordinate(args?.from_x, "from_x");
  const fromY = normalizeCoordinate(args?.from_y, "from_y");
  const toX = normalizeCoordinate(args?.to_x, "to_x");
  const toY = normalizeCoordinate(args?.to_y, "to_y");
  const button = normalizeMouseButton(args?.button);
  if (button !== "left") {
    throw createToolError("ACTION_NOT_SUPPORTED", "action not supported: macos drag currently supports left button only");
  }
  const steps = normalizeDragSteps(args?.steps);
  const durationMs = normalizeDragDurationMs(args?.duration_ms);
  const waitMs = steps > 0 ? Math.max(20, Math.round(durationMs / Math.max(1, steps + 2))) : 20;
  const moveCommands = Array.from({ length: steps }, (_item, index) => {
    const ratio = (index + 1) / steps;
    const x = Math.round(fromX + (toX - fromX) * ratio);
    const y = Math.round(fromY + (toY - fromY) * ratio);
    return `dm:${String(x)},${String(y)}`;
  });
  const commands = [
    `dd:${String(fromX)},${String(fromY)}`,
    ...moveCommands,
    `du:${String(toX)},${String(toY)}`,
  ];
  const result = await runNativeCommand("cliclick", ["-w", String(waitMs), ...commands], { timeoutMs });
  ensureNativeCommandOk(result, "cliclick drag");
  return {
    driver: "macos-cliclick",
    from_x: fromX,
    from_y: fromY,
    to_x: toX,
    to_y: toY,
    button,
    duration_ms: durationMs,
    steps,
  };
}

async function clickPointer(action, args, timeoutMs) {
  const x = normalizeCoordinate(args?.x, "x");
  const y = normalizeCoordinate(args?.y, "y");
  const button = normalizeMouseButton(args?.button);
  const base = button === "right" ? "rc" : (button === "middle" ? "mc" : "c");
  const count = action === "double_click" ? 2 : 1;
  const commands = Array.from({ length: count }, () => `${base}:${String(x)},${String(y)}`);
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

async function scrollPointer(args, timeoutMs) {
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

export {
  clickPointer,
  dragPointer,
  movePointer,
  scrollPointer,
};
