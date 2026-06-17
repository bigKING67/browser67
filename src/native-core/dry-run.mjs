import { nowIso } from "../common.mjs";
import { validateNativeInputArguments } from "./validation.mjs";

function buildNativeInputDriverPlan(platform, action) {
  if (platform === "win32") {
    return {
      primary_driver: "windows-powershell",
      binary_requirements: ["powershell|pwsh"],
      permission_requirements: ["Foreground window/focus permissions managed by OS policy."],
    };
  }
  if (platform === "darwin") {
    const pointerActions = new Set(["move", "drag", "click", "double_click", "scroll"]);
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

export {
  buildNativeInputDryRunResponse,
};
