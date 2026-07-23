const POINTER_ACTIONS = ["move", "click", "double_click", "scroll"];

function capabilityPayload(capabilities) {
  if (capabilities?.schema !== "browser67.tool-outcome.v3") return capabilities ?? {};
  if (capabilities.ok !== true || !capabilities.data || typeof capabilities.data !== "object") {
    const code = String(capabilities?.error?.code ?? "NATIVE_CAPABILITY_PROBE_FAILED");
    const message = String(capabilities?.error?.message ?? "native capability probe failed");
    throw new Error(`${code}: ${message}`);
  }
  return capabilities.data;
}

function summarizeCapabilities(capabilities) {
  const payload = capabilityPayload(capabilities);
  const supported = Array.isArray(payload?.supported_actions)
    ? payload.supported_actions
    : [];
  const unsupported = Array.isArray(payload?.unsupported_actions)
    ? payload.unsupported_actions
    : [];
  const requirements = Array.isArray(payload?.requirements)
    ? payload.requirements
    : [];
  const pointerReady = POINTER_ACTIONS.every((action) => supported.includes(action));
  return {
    pointer_ready: pointerReady,
    keyboard_ready: ["press", "type", "paste"].every((action) => supported.includes(action)),
    window_ready: supported.includes("activate_window"),
    fully_ready: unsupported.length === 0,
    supported_actions: supported,
    unsupported_actions: unsupported,
    requirements,
  };
}

function computeReportOk(platform, summary) {
  if (platform === "darwin" || platform === "linux") {
    return summary.pointer_ready;
  }
  if (platform === "win32") {
    return summary.fully_ready;
  }
  return summary.fully_ready;
}

export {
  capabilityPayload,
  computeReportOk,
  summarizeCapabilities,
};
