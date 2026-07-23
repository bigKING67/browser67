import { createToolError } from "../runtime/tool-errors.mjs";
import {
  ensureNativeCommandOk,
  runNativeCommand,
} from "../native-core/index.mjs";

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

export {
  ensureLinuxDisplayBackend,
  parseWindowGeometryFromShell,
  resolveLinuxButton,
  resolveLinuxWindowId,
  toLinuxXdotoolKey,
};
