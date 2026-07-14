import {
  detectNativeInputCapabilities,
  handleBrowserNativeInput,
} from "../../native-input.mjs";

const PROVIDER_ID = "native-os";

function normalizeCapabilities(capabilities = {}) {
  const supportedActions = Array.isArray(capabilities.supported_actions)
    ? [...capabilities.supported_actions]
    : [];
  const unsupportedActions = Array.isArray(capabilities.unsupported_actions)
    ? [...capabilities.unsupported_actions]
    : [];
  return {
    provider_id: PROVIDER_ID,
    provider_name: "Native OS input",
    status: supportedActions.length > 0 ? "available" : "unavailable",
    execution_mode: "native_physical_input",
    coordinate_system: String(capabilities.coordinate_system ?? "screen_pixels"),
    supports_window_activation: supportedActions.includes("activate_window"),
    supports_window_rect: supportedActions.includes("get_window_rect"),
    supports_window_region_capture: false,
    supports_background_capture: false,
    supported_actions: supportedActions,
    unsupported_actions: unsupportedActions,
    requirements: Array.isArray(capabilities.requirements) ? [...capabilities.requirements] : [],
    permission_notes: Array.isArray(capabilities.permission_notes) ? [...capabilities.permission_notes] : [],
    driver: capabilities.driver,
    platform: capabilities.platform,
    checks: capabilities.checks ?? {},
  };
}

async function getNativeOsPhysicalInputProviderCapabilities(options = {}) {
  const nativeCapabilities = await detectNativeInputCapabilities(options);
  return normalizeCapabilities(nativeCapabilities);
}

async function runNativeOsPhysicalInputAction(action, args = {}) {
  return handleBrowserNativeInput({
    ...args,
    action,
  });
}

export {
  PROVIDER_ID as NATIVE_OS_PROVIDER_ID,
  getNativeOsPhysicalInputProviderCapabilities,
  runNativeOsPhysicalInputAction,
};
