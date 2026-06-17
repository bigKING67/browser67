import process from "node:process";

function supportsNativePointerAction(capabilities, action) {
  return Array.isArray(capabilities?.supported_actions) && capabilities.supported_actions.includes(action);
}

function nativePointerRequirements(capabilities) {
  return Array.isArray(capabilities?.requirements) ? capabilities.requirements : [];
}

function buildNativePointerNextSteps(capabilities, options = {}) {
  const requirements = nativePointerRequirements(capabilities);
  const readinessCommand = options.readiness_command ?? "Run npm run check:native-pointer.";
  if (requirements.length > 0) {
    return options.include_readiness_command === true
      ? [readinessCommand, ...requirements]
      : requirements;
  }
  if (supportsNativePointerAction(capabilities, "click") && supportsNativePointerAction(capabilities, "drag")) {
    return [
      options.ready_message ?? "Native pointer click/drag are ready; run physical CAPTCHA assist only after explicit confirmation.",
    ];
  }
  return [
    options.missing_message ?? "Native pointer click/drag are not available on this platform/provider.",
  ];
}

function buildNativePointerReadinessReport(capabilities, options = {}) {
  const clickReady = supportsNativePointerAction(capabilities, "click");
  const dragReady = supportsNativePointerAction(capabilities, "drag");
  const report = {
    ok: clickReady && dragReady,
    status: clickReady && dragReady ? "pointer_ready" : "requirements_missing",
    platform: capabilities?.platform ?? options.platform ?? process.platform,
    driver: capabilities?.driver ?? "unknown",
    supports_click: clickReady,
    supports_drag: dragReady,
    supported_actions: Array.isArray(capabilities?.supported_actions) ? capabilities.supported_actions : [],
    unsupported_actions: Array.isArray(capabilities?.unsupported_actions) ? capabilities.unsupported_actions : [],
    checks: capabilities?.checks ?? {},
    requirements: nativePointerRequirements(capabilities),
    permission_notes: Array.isArray(capabilities?.permission_notes) ? capabilities.permission_notes : [],
    next_steps: buildNativePointerNextSteps(capabilities, options),
  };
  if (options.check) {
    report.check = options.check;
  }
  return report;
}

export {
  buildNativePointerNextSteps,
  buildNativePointerReadinessReport,
  supportsNativePointerAction,
};
