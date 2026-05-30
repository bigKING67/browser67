import { spawn } from "node:child_process";

import { compactText, nowIso } from "./common.mjs";
import { createToolError } from "./errors.mjs";

const NATIVE_INPUT_DEFAULT_TIMEOUT_MS = 8_000;
const NATIVE_INPUT_MAX_TIMEOUT_MS = 30_000;

function normalizeNativeInputTimeoutMs(raw) {
  const parsed = Number(raw ?? NATIVE_INPUT_DEFAULT_TIMEOUT_MS);
  if (!Number.isFinite(parsed)) {
    return NATIVE_INPUT_DEFAULT_TIMEOUT_MS;
  }
  return Math.max(500, Math.min(NATIVE_INPUT_MAX_TIMEOUT_MS, Math.floor(parsed)));
}

function normalizeNativeInputAction(raw) {
  const value = String(raw ?? "").trim().toLowerCase();
  const allowed = new Set([
    "activate_window",
    "move",
    "click",
    "double_click",
    "press",
    "type",
    "paste",
    "scroll",
    "get_window_rect",
    "capabilities",
  ]);
  if (!allowed.has(value)) {
    throw createToolError("ACTION_NOT_SUPPORTED", `action not supported: ${value || "<empty>"}`);
  }
  return value;
}

function allNativeInputActions() {
  return [
    "activate_window",
    "move",
    "click",
    "double_click",
    "press",
    "type",
    "paste",
    "scroll",
    "get_window_rect",
  ];
}

function validateNativeInputArguments(action, args) {
  const input = args ?? {};
  if (action === "capabilities") {
    return {};
  }
  if (action === "activate_window") {
    const selector = parseWindowSelector(input);
    if (!selector.title && !selector.pid) {
      throw createToolError("WINDOW_NOT_FOUND", "window not found: window_title or window_pid is required");
    }
    return {
      window_title: selector.title || undefined,
      window_pid: selector.pid ?? undefined,
    };
  }
  if (action === "move") {
    return {
      x: normalizeCoordinate(input.x, "x"),
      y: normalizeCoordinate(input.y, "y"),
    };
  }
  if (action === "click" || action === "double_click") {
    const normalized = {
      button: normalizeMouseButton(input.button),
    };
    const hasX = input.x !== undefined;
    const hasY = input.y !== undefined;
    if (hasX !== hasY) {
      throw createToolError("COORDINATE_OUT_OF_RANGE", "coordinate out of range: both x and y are required together");
    }
    if (hasX && hasY) {
      normalized.x = normalizeCoordinate(input.x, "x");
      normalized.y = normalizeCoordinate(input.y, "y");
    }
    return normalized;
  }
  if (action === "press") {
    const key = String(input.key ?? "").trim();
    if (!key) {
      throw createToolError("ACTION_NOT_SUPPORTED", "action not supported: press requires key");
    }
    return {
      key,
    };
  }
  if (action === "type") {
    if (input.text === undefined || input.text === null) {
      throw createToolError("ACTION_NOT_SUPPORTED", "action not supported: type requires text");
    }
    const text = String(input.text);
    const delayRaw = Number(input.delay_ms ?? 6);
    const delayMs = Number.isFinite(delayRaw) ? Math.max(0, Math.min(10_000, Math.floor(delayRaw))) : 6;
    return {
      text,
      text_length: text.length,
      delay_ms: delayMs,
    };
  }
  if (action === "paste") {
    if (input.text === undefined || input.text === null) {
      return {
        use_existing_clipboard: true,
      };
    }
    const text = String(input.text);
    return {
      text,
      text_length: text.length,
      use_existing_clipboard: false,
    };
  }
  if (action === "scroll") {
    const deltaXRaw = Number(input.delta_x ?? 0);
    const deltaYRaw = Number(input.delta_y ?? 0);
    const deltaX = Number.isFinite(deltaXRaw) ? Math.max(-24_000, Math.min(24_000, Math.round(deltaXRaw))) : 0;
    const deltaY = Number.isFinite(deltaYRaw) ? Math.max(-24_000, Math.min(24_000, Math.round(deltaYRaw))) : 0;
    return {
      delta_x: deltaX,
      delta_y: deltaY,
    };
  }
  if (action === "get_window_rect") {
    const selector = parseWindowSelector(input);
    return {
      window_title: selector.title || undefined,
      window_pid: selector.pid ?? undefined,
    };
  }
  throw createToolError("ACTION_NOT_SUPPORTED", `action not supported: ${action}`);
}

function buildNativeInputDriverPlan(platform, action) {
  if (platform === "win32") {
    return {
      primary_driver: "windows-powershell",
      binary_requirements: ["powershell|pwsh"],
      permission_requirements: ["Foreground window/focus permissions managed by OS policy."],
    };
  }
  if (platform === "darwin") {
    const pointerActions = new Set(["move", "click", "double_click", "scroll"]);
    return {
      primary_driver: pointerActions.has(action) ? "macos-cliclick" : "macos-osascript",
      binary_requirements: pointerActions.has(action) ? ["osascript", "cliclick"] : ["osascript"],
      permission_requirements: ["Accessibility + Automation permissions for terminal process."],
    };
  }
  if (platform === "linux") {
    const requirements = ["xdotool", "DISPLAY"];
    if (action === "paste") {
      requirements.push("xclip (optional for clipboard paste)");
    }
    return {
      primary_driver: "linux-xdotool",
      binary_requirements: requirements,
      permission_requirements: ["Window manager/focus policy can still block specific actions."],
    };
  }
  return {
    primary_driver: "unsupported",
    binary_requirements: [],
    permission_requirements: [],
  };
}

function buildNativeInputDryRunResponse(action, args, timeoutMs, capabilities) {
  const validatedArgs = validateNativeInputArguments(action, args);
  const supportedActions = Array.isArray(capabilities?.supported_actions) ? capabilities.supported_actions : [];
  const unsupportedActions = Array.isArray(capabilities?.unsupported_actions) ? capabilities.unsupported_actions : [];
  const requirements = Array.isArray(capabilities?.requirements) ? capabilities.requirements : [];
  const checks = (
    typeof capabilities?.checks === "object"
    && capabilities.checks !== null
    && !Array.isArray(capabilities.checks)
  ) ? capabilities.checks : {};
  const supported = supportedActions.includes(action);
  return {
    status: "success",
    dry_run: true,
    platform: String(capabilities?.platform ?? process.platform),
    action,
    timeout_ms: timeoutMs,
    validated_args: validatedArgs,
    driver_plan: buildNativeInputDriverPlan(String(capabilities?.platform ?? process.platform), action),
    capabilities_summary: {
      supported,
      checks,
      supported_actions: supportedActions,
      unsupported_actions: unsupportedActions,
      requirements,
    },
    next_step: supported ? "safe_to_execute" : "requirements_missing",
    at: nowIso(),
  };
}

function normalizeMouseButton(raw) {
  const value = String(raw ?? "left").trim().toLowerCase();
  if (value === "left" || value === "middle" || value === "right") {
    return value;
  }
  throw createToolError("ACTION_NOT_SUPPORTED", `action not supported: button=${value}`);
}

function normalizeCoordinate(raw, axisName) {
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) {
    throw createToolError("COORDINATE_OUT_OF_RANGE", `coordinate out of range: ${axisName} is not finite`);
  }
  const value = Math.round(parsed);
  if (value < 0 || value > 100_000) {
    throw createToolError("COORDINATE_OUT_OF_RANGE", `coordinate out of range: ${axisName}=${String(value)}`);
  }
  return value;
}

function parseWindowSelector(args) {
  const title = String(args?.window_title ?? "").trim();
  const pidParsed = Number(args?.window_pid);
  const pid = Number.isInteger(pidParsed) && pidParsed > 0 ? pidParsed : null;
  return { title, pid };
}

function parseJsonFromCommandOutput(stdout) {
  const rows = String(stdout ?? "")
    .split(/\r?\n/g)
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
  for (let index = rows.length - 1; index >= 0; index -= 1) {
    try {
      return JSON.parse(rows[index]);
    } catch {
      // continue
    }
  }
  return null;
}

async function runNativeCommand(command, args = [], options = {}) {
  const timeoutMs = normalizeNativeInputTimeoutMs(options.timeoutMs);
  const env = options.env ?? process.env;
  const input = typeof options.input === "string" ? options.input : null;
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      env,
      stdio: ["pipe", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) {
        return;
      }
      settled = true;
      try {
        child.kill("SIGKILL");
      } catch {
        // no-op
      }
      reject(new Error(`native input execution failed: ${command} timeout after ${String(timeoutMs)}ms`));
    }, timeoutMs);
    const finish = (payload) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      resolve(payload);
    };
    child.on("error", (error) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      reject(error);
    });
    child.stdout.on("data", (chunk) => {
      stdout += String(chunk);
    });
    child.stderr.on("data", (chunk) => {
      stderr += String(chunk);
    });
    child.on("close", (code, signal) => {
      finish({
        code: typeof code === "number" ? code : -1,
        signal: signal ? String(signal) : "",
        stdout,
        stderr,
        command,
        args,
      });
    });
    if (input !== null) {
      child.stdin.write(input);
    }
    child.stdin.end();
  });
}

async function commandExists(command, timeoutMs = 2_000) {
  const probeCommand = process.platform === "win32" ? "where" : "which";
  try {
    const result = await runNativeCommand(probeCommand, [command], { timeoutMs });
    return result.code === 0;
  } catch {
    return false;
  }
}

function ensureNativeCommandOk(result, label) {
  if (result.code === 0) {
    return;
  }
  const detail = compactText(result.stderr || result.stdout || "unknown command failure", 600);
  throw new Error(`${label} failed exit=${String(result.code)} detail=${detail}`);
}

export {
  NATIVE_INPUT_DEFAULT_TIMEOUT_MS,
  NATIVE_INPUT_MAX_TIMEOUT_MS,
  allNativeInputActions,
  buildNativeInputDryRunResponse,
  commandExists,
  ensureNativeCommandOk,
  normalizeCoordinate,
  normalizeMouseButton,
  normalizeNativeInputAction,
  normalizeNativeInputTimeoutMs,
  parseJsonFromCommandOutput,
  parseWindowSelector,
  runNativeCommand,
  validateNativeInputArguments,
};
