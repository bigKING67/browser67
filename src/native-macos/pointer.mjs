import { createToolError } from "../errors.mjs";
import {
  ensureNativeCommandOk,
  normalizeCoordinate,
  normalizeDragDurationMs,
  normalizeDragSteps,
  normalizeMouseButton,
  runNativeCommand,
} from "../native-core.mjs";
import { runCliclickAgainstChromiumTab } from "./chromium-window.mjs";

async function runCliclickPointerCommands(args, cliclickArgs, timeoutMs) {
  const windowUrl = String(args?.window_url ?? "").trim();
  const windowTabId = args?.window_tab_id;
  if (windowUrl || windowTabId !== undefined) {
    return {
      foregroundActivation: await runCliclickAgainstChromiumTab({
        cliclickArgs,
        preferredApplication: args?.window_application,
        timeoutMs,
        windowTabId,
        windowUrl,
      }),
      result: null,
    };
  }
  const result = await runNativeCommand("cliclick", cliclickArgs, { timeoutMs });
  ensureNativeCommandOk(result, "cliclick pointer input");
  return {
    foregroundActivation: null,
    result,
  };
}

function buildCliclickDragCommands({
  durationMs,
  fromX,
  fromY,
  steps,
  toX,
  toY,
}) {
  const easing = 2;
  const waitMs = steps > 0 ? Math.max(20, Math.round(durationMs / Math.max(1, steps + 3))) : 20;
  const moveCommands = Array.from({ length: steps }, (_item, index) => {
    const ratio = (index + 1) / steps;
    const x = Math.round(fromX + (toX - fromX) * ratio);
    const y = Math.round(fromY + (toY - fromY) * ratio);
    return `dm:${String(x)},${String(y)}`;
  });
  const commands = [
    `m:${String(fromX)},${String(fromY)}`,
    `dd:${String(fromX)},${String(fromY)}`,
    ...moveCommands,
    `du:${String(toX)},${String(toY)}`,
  ];
  return {
    easing,
    wait_ms: waitMs,
    commands,
    command_sequence: commands.map((command) => String(command).split(":", 1)[0]),
    pre_move: true,
  };
}

function buildCliclickClickCommands({
  action,
  button,
  x,
  y,
}) {
  const base = button === "right" ? "rc" : (button === "middle" ? "mc" : "c");
  const count = action === "double_click" ? 2 : 1;
  const preMoveX = Math.max(0, Math.round(x - 6));
  const preMoveY = Math.max(0, Math.round(y - 4));
  const commands = [
    `m:${String(preMoveX)},${String(preMoveY)}`,
    ...Array.from({ length: count }, () => `${base}:${String(x)},${String(y)}`),
  ];
  return {
    wait_ms: 140,
    commands,
    command_sequence: commands.map((command) => String(command).split(":", 1)[0]),
    pre_move: true,
    pre_move_point: {
      x: preMoveX,
      y: preMoveY,
    },
  };
}

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
  const dragPlan = buildCliclickDragCommands({
    durationMs,
    fromX,
    fromY,
    steps,
    toX,
    toY,
  });
  const execution = await runCliclickPointerCommands(
    args,
    ["-e", String(dragPlan.easing), "-w", String(dragPlan.wait_ms), ...dragPlan.commands],
    timeoutMs,
  );
  return {
    driver: "macos-cliclick",
    from_x: fromX,
    from_y: fromY,
    to_x: toX,
    to_y: toY,
    button,
    duration_ms: durationMs,
    steps,
    command_sequence: dragPlan.command_sequence,
    easing: dragPlan.easing,
    pre_move: dragPlan.pre_move,
    wait_ms: dragPlan.wait_ms,
    foreground_activation: execution.foregroundActivation ?? undefined,
  };
}

async function clickPointer(action, args, timeoutMs) {
  const x = normalizeCoordinate(args?.x, "x");
  const y = normalizeCoordinate(args?.y, "y");
  const button = normalizeMouseButton(args?.button);
  const clickPlan = buildCliclickClickCommands({
    action,
    button,
    x,
    y,
  });
  const execution = await runCliclickPointerCommands(
    args,
    ["-w", String(clickPlan.wait_ms), ...clickPlan.commands],
    timeoutMs,
  );
  return {
    driver: "macos-cliclick",
    x,
    y,
    button,
    count: action === "double_click" ? 2 : 1,
    command_sequence: clickPlan.command_sequence,
    pre_move: clickPlan.pre_move,
    pre_move_point: clickPlan.pre_move_point,
    wait_ms: clickPlan.wait_ms,
    foreground_activation: execution.foregroundActivation ?? undefined,
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
  buildCliclickClickCommands,
  buildCliclickDragCommands,
  clickPointer,
  dragPointer,
  movePointer,
  scrollPointer,
};
