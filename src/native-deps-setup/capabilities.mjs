const POINTER_ACTIONS = ["move", "click", "double_click", "scroll"];

function summarizeCapabilities(capabilities) {
  const supported = Array.isArray(capabilities?.supported_actions)
    ? capabilities.supported_actions
    : [];
  const unsupported = Array.isArray(capabilities?.unsupported_actions)
    ? capabilities.unsupported_actions
    : [];
  const requirements = Array.isArray(capabilities?.requirements)
    ? capabilities.requirements
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
  computeReportOk,
  summarizeCapabilities,
};
