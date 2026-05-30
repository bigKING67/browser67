import { createToolError } from "./errors.mjs";
import {
  commandExists,
  ensureNativeCommandOk,
  normalizeCoordinate,
  normalizeMouseButton,
  parseWindowSelector,
  runNativeCommand,
} from "./native-core.mjs";

function toLinuxXdotoolKey(raw) {
  const normalized = String(raw ?? "").trim();
  if (!normalized) {
    throw createToolError("ACTION_NOT_SUPPORTED", "action not supported: empty key");
  }
  const pieces = normalized.split("+").map((item) => item.trim().toLowerCase()).filter(Boolean);
  const mapped = pieces.map((piece) => {
    if (piece === "cmd" || piece === "command" || piece === "meta" || piece === "win") {
      return "super";
    }
    if (piece === "control") {
      return "ctrl";
    }
    if (piece === "option") {
      return "alt";
    }
    if (piece === "enter") {
      return "Return";
    }
    if (piece === "esc") {
      return "Escape";
    }
    if (piece === "space") {
      return "space";
    }
    return piece;
  });
  return mapped.join("+");
}

function parseWindowGeometryFromShell(raw) {
  const pairs = {};
  for (const line of String(raw ?? "").split(/\r?\n/g)) {
    const match = line.match(/^([A-Z_]+)=(.+)$/);
    if (!match) {
      continue;
    }
    pairs[match[1]] = match[2];
  }
  const x = Number.parseInt(pairs.X ?? "", 10);
  const y = Number.parseInt(pairs.Y ?? "", 10);
  const width = Number.parseInt(pairs.WIDTH ?? "", 10);
  const height = Number.parseInt(pairs.HEIGHT ?? "", 10);
  if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(width) || !Number.isFinite(height)) {
    throw new Error(`native input execution failed: invalid geometry payload=${raw}`);
  }
  return { x, y, width, height };
}

function resolveLinuxButton(button) {
  if (button === "left") {
    return 1;
  }
  if (button === "middle") {
    return 2;
  }
  if (button === "right") {
    return 3;
  }
  return 1;
}

function ensureLinuxDisplayBackend() {
  const display = String(process.env.DISPLAY ?? "").trim();
  if (display) {
    return;
  }
  const wayland = String(process.env.WAYLAND_DISPLAY ?? "").trim();
  if (wayland) {
    throw createToolError(
      "DISPLAY_BACKEND_UNSUPPORTED",
      "display backend unsupported: Wayland session without X11 DISPLAY",
    );
  }
  throw createToolError("DISPLAY_BACKEND_UNSUPPORTED", "display backend unsupported: DISPLAY is not set");
}

async function resolveLinuxWindowId(selector, timeoutMs) {
  if (selector.pid) {
    const byPid = await runNativeCommand("xdotool", ["search", "--pid", String(selector.pid)], { timeoutMs });
    ensureNativeCommandOk(byPid, "xdotool search --pid");
    const id = String(byPid.stdout ?? "").split(/\r?\n/g).find((item) => item.trim().length > 0)?.trim() ?? "";
    if (!id) {
      throw createToolError("WINDOW_NOT_FOUND", `window not found: pid=${String(selector.pid)}`);
    }
    return id;
  }
  if (selector.title) {
    const byTitle = await runNativeCommand("xdotool", ["search", "--name", selector.title], { timeoutMs });
    ensureNativeCommandOk(byTitle, "xdotool search --name");
    const id = String(byTitle.stdout ?? "").split(/\r?\n/g).find((item) => item.trim().length > 0)?.trim() ?? "";
    if (!id) {
      throw createToolError("WINDOW_NOT_FOUND", `window not found: title=${selector.title}`);
    }
    return id;
  }
  const active = await runNativeCommand("xdotool", ["getactivewindow"], { timeoutMs });
  ensureNativeCommandOk(active, "xdotool getactivewindow");
  const id = String(active.stdout ?? "").trim();
  if (!id) {
    throw createToolError("WINDOW_NOT_FOUND", "window not found: no active window");
  }
  return id;
}

async function runNativeInputLinux(action, args, timeoutMs) {
  ensureLinuxDisplayBackend();
  const hasXdotool = await commandExists("xdotool", Math.min(timeoutMs, 2_000));
  if (!hasXdotool) {
    throw createToolError("ACTION_NOT_SUPPORTED", "action not supported: xdotool is required on linux");
  }
  const selector = parseWindowSelector(args);
  if (action === "activate_window") {
    const windowId = await resolveLinuxWindowId(selector, timeoutMs);
    const activate = await runNativeCommand("xdotool", ["windowactivate", "--sync", windowId], { timeoutMs });
    ensureNativeCommandOk(activate, "xdotool windowactivate");
    return {
      driver: "linux-xdotool",
      window_id: windowId,
    };
  }
  if (action === "move") {
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
  if (action === "click" || action === "double_click") {
    if (args?.x !== undefined || args?.y !== undefined) {
      const x = normalizeCoordinate(args?.x, "x");
      const y = normalizeCoordinate(args?.y, "y");
      const move = await runNativeCommand("xdotool", ["mousemove", String(x), String(y)], { timeoutMs });
      ensureNativeCommandOk(move, "xdotool mousemove");
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
  if (action === "press") {
    const key = toLinuxXdotoolKey(args?.key);
    const press = await runNativeCommand("xdotool", ["key", "--clearmodifiers", key], { timeoutMs });
    ensureNativeCommandOk(press, "xdotool key");
    return {
      driver: "linux-xdotool",
      key,
    };
  }
  if (action === "type") {
    const text = String(args?.text ?? "");
    const delayRaw = Number(args?.delay_ms ?? 6);
    const delay = Number.isFinite(delayRaw) ? Math.max(0, Math.min(1_000, Math.floor(delayRaw))) : 6;
    const typed = await runNativeCommand("xdotool", ["type", "--delay", String(delay), text], { timeoutMs });
    ensureNativeCommandOk(typed, "xdotool type");
    return {
      driver: "linux-xdotool",
      text_length: text.length,
      delay_ms: delay,
    };
  }
  if (action === "paste") {
    const text = args?.text === undefined ? null : String(args?.text);
    let fallbackUsed = "none";
    if (text !== null) {
      const hasXclip = await commandExists("xclip", Math.min(timeoutMs, 2_000));
      if (hasXclip) {
        const clipboard = await runNativeCommand(
          "xclip",
          ["-selection", "clipboard"],
          { timeoutMs, input: text },
        );
        ensureNativeCommandOk(clipboard, "xclip");
      } else {
        const typed = await runNativeCommand("xdotool", ["type", "--delay", "6", text], { timeoutMs });
        ensureNativeCommandOk(typed, "xdotool type (paste fallback)");
        fallbackUsed = "typed_text_instead_of_clipboard";
        return {
          driver: "linux-xdotool",
          used_clipboard: false,
          fallback_used: fallbackUsed,
          text_length: text.length,
        };
      }
    }
    const paste = await runNativeCommand("xdotool", ["key", "--clearmodifiers", "ctrl+v"], { timeoutMs });
    ensureNativeCommandOk(paste, "xdotool key ctrl+v");
    return {
      driver: "linux-xdotool",
      used_clipboard: text !== null,
      fallback_used: fallbackUsed,
    };
  }
  if (action === "scroll") {
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
  if (action === "get_window_rect") {
    const windowId = await resolveLinuxWindowId(selector, timeoutMs);
    const geometry = await runNativeCommand("xdotool", ["getwindowgeometry", "--shell", windowId], { timeoutMs });
    ensureNativeCommandOk(geometry, "xdotool getwindowgeometry");
    const parsed = parseWindowGeometryFromShell(geometry.stdout);
    return {
      driver: "linux-xdotool",
      window_id: windowId,
      ...parsed,
    };
  }
  throw createToolError("ACTION_NOT_SUPPORTED", `action not supported: ${action}`);
}

export { runNativeInputLinux };
