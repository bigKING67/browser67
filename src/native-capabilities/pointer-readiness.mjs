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

function buildNativePointerRecoveryPlan(capabilities, options = {}) {
  const platform = capabilities?.platform ?? options.platform ?? process.platform;
  const checks = capabilities?.checks ?? {};
  const verifyCommand = options.verify_command ?? "npm run check:native-pointer";
  const physicalGateCommand = options.physical_gate_command
    ?? "TMWD_CAPTCHA_ASSIST_PHYSICAL=1 TMWD_CAPTCHA_ASSIST_CONFIRM=1 npm run check:captcha-assist-physical-live";
  if (platform !== "darwin") {
    return null;
  }
  const hasCliclick = checks.cliclick === true;
  const needsAccessibility = hasCliclick && checks.cliclick_accessibility !== true;
  if (!needsAccessibility) {
    return null;
  }
  return {
    platform: "darwin",
    status: "permission_required",
    blocker: "macos_accessibility_for_current_terminal",
    affected_actions: ["click", "drag"],
    settings_path: "System Settings -> Privacy & Security -> Accessibility",
    open_settings_command: "open \"x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility\"",
    manual_steps: [
      "Open Accessibility settings for this Mac user.",
      "Enable the current Terminal, iTerm, or Codex host application.",
      "Restart the terminal/Codex host if macOS keeps the old permission state.",
      `Verify with: ${verifyCommand}`,
      `Only then run the physical gate with explicit opt-in: ${physicalGateCommand}`,
    ],
    safe_defaults: [
      "This report does not move the mouse.",
      "This report does not open Chrome or create a managed tab.",
      "This report does not read browser private state.",
    ],
  };
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
    permission_recovery: buildNativePointerRecoveryPlan(capabilities, options),
  };
  if (options.check) {
    report.check = options.check;
  }
  return report;
}

export {
  buildNativePointerNextSteps,
  buildNativePointerRecoveryPlan,
  buildNativePointerReadinessReport,
  supportsNativePointerAction,
};
