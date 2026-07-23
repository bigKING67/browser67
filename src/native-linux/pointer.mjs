import {
  ensureNativeCommandOk,
  normalizeCoordinate,
  normalizeDragDurationMs,
  normalizeDragSteps,
  normalizeMouseButton,
  runNativeCommand,
} from "../native-core/index.mjs";

import { resolveLinuxButton } from "./xdotool.mjs";

async function movePointer(args, timeoutMs) {
  const x = normalizeCoordinate(args?.x, "x");
  const y = normalizeCoordinate(args?.y, "y");
  const move = await runNativeCommand("xdotool", ["mousemove", String(x), String(y)], { timeoutMs });
  ensureNativeCommandOk(move, "xdotool mousemove");
  return {
    driver: "linux-xdotool",
    x,
    y,
  };
}

function buildDragCommands({ fromX, fromY, toX, toY, button, steps, delaySeconds }) {
  const moveCommands = Array.from({ length: steps }, (_item, itemIndex) => {
    const index = itemIndex + 1;
    const ratio = index / steps;
    const x = Math.round(fromX + (toX - fromX) * ratio);
    const y = Math.round(fromY + (toY - fromY) * ratio);
    const command = ["mousemove", "--sync", String(x), String(y)];
    if (delaySeconds > 0) {
      command.push("sleep", delaySeconds.toFixed(3));
    }
    return command;
  }).flat();
  return [
    "mousemove",
    String(fromX),
    String(fromY),
    "mousedown",
    String(button),
    ...moveCommands,
    "mouseup",
    String(button),
  ];
}

async function dragPointer(args, timeoutMs) {
  const fromX = normalizeCoordinate(args?.from_x, "from_x");
  const fromY = normalizeCoordinate(args?.from_y, "from_y");
  const toX = normalizeCoordinate(args?.to_x, "to_x");
  const toY = normalizeCoordinate(args?.to_y, "to_y");
  const button = resolveLinuxButton(normalizeMouseButton(args?.button));
  const durationMs = normalizeDragDurationMs(args?.duration_ms);
  const steps = normalizeDragSteps(args?.steps);
  const delaySeconds = steps > 0 ? Math.max(0, durationMs / Math.max(1, steps + 1) / 1000) : 0;
  const commands = buildDragCommands({ fromX, fromY, toX, toY, button, steps, delaySeconds });
  const dragged = await runNativeCommand("xdotool", commands, { timeoutMs });
  ensureNativeCommandOk(dragged, "xdotool drag");
  return {
    driver: "linux-xdotool",
    from_x: fromX,
    from_y: fromY,
    to_x: toX,
    to_y: toY,
    button: String(args?.button ?? "left").trim().toLowerCase() || "left",
    duration_ms: durationMs,
    steps,
  };
}

async function clickPointer(action, args, timeoutMs) {
  if (args?.x !== undefined || args?.y !== undefined) {
    await movePointer(args, timeoutMs);
  }
  const button = normalizeMouseButton(args?.button);
  const repeat = action === "double_click" ? 2 : 1;
  const click = await runNativeCommand("xdotool", [
    "click",
    "--repeat",
    String(repeat),
    "--delay",
    "80",
    String(resolveLinuxButton(button)),
  ], {
    timeoutMs,
  });
  ensureNativeCommandOk(click, "xdotool click");
  return {
    driver: "linux-xdotool",
    button,
    count: repeat,
  };
}

async function scrollPointer(args, timeoutMs) {
  const deltaYRaw = Number(args?.delta_y ?? 0);
  const deltaY = Number.isFinite(deltaYRaw) ? Math.max(-1_000, Math.min(1_000, Math.round(deltaYRaw))) : 0;
  if (deltaY === 0) {
    return {
      driver: "linux-xdotool",
      delta_y: 0,
    };
  }
  const button = deltaY > 0 ? "5" : "4";
  const steps = Math.max(1, Math.min(160, Math.abs(deltaY)));
  const scrolled = await runNativeCommand("xdotool", ["click", "--repeat", String(steps), button], { timeoutMs });
  ensureNativeCommandOk(scrolled, "xdotool scroll click");
  return {
    driver: "linux-xdotool",
    delta_y: deltaY,
    steps,
  };
}

export {
  clickPointer,
  dragPointer,
  movePointer,
  scrollPointer,
};
