import { allNativeInputActions, commandExists } from "../native-core.mjs";

async function detectWindowsCapabilities(actions) {
  const [hasWindowsPowerShell, hasPowerShellCore] = await Promise.all([
    commandExists("powershell", 1_200),
    commandExists("pwsh", 1_200),
  ]);
  const hasPowerShell = hasWindowsPowerShell || hasPowerShellCore;
  return {
    platform: "win32",
    driver: "windows-powershell",
    checks: {
      powershell: hasPowerShell,
    },
    supported_actions: hasPowerShell ? [...actions] : [],
    unsupported_actions: hasPowerShell ? [] : [...actions],
    requirements: hasPowerShell
      ? []
      : ["Install PowerShell (`powershell` or `pwsh`) and ensure it is on PATH."],
    permission_notes: [
      "Some actions may require foreground window focus permissions managed by OS policy.",
    ],
  };
}

async function detectDarwinCapabilities(actions) {
  const [hasOsaScript, hasCliclick] = await Promise.all([
    commandExists("osascript", 1_200),
    commandExists("cliclick", 1_200),
  ]);
  const noPointerActions = [
    "activate_window",
    "press",
    "type",
    "paste",
    "get_window_rect",
  ];
  const pointerActions = [
    "move",
    "drag",
    "click",
    "double_click",
    "scroll",
  ];
  const supported = new Set();
  if (hasOsaScript) {
    for (const action of noPointerActions) {
      supported.add(action);
    }
  }
  if (hasCliclick) {
    for (const action of pointerActions) {
      supported.add(action);
    }
  }
  const supportedActions = actions.filter((action) => supported.has(action));
  const unsupportedActions = actions.filter((action) => !supported.has(action));
  const requirements = [];
  if (!hasOsaScript) {
    requirements.push("macOS requires `osascript` for keyboard/window actions.");
  }
  if (!hasCliclick) {
    requirements.push("Install `cliclick` for pointer actions (`move/drag/click/double_click/scroll`).");
  }
  return {
    platform: "darwin",
    driver: "macos-osascript-cliclick",
    checks: {
      osascript: hasOsaScript,
      cliclick: hasCliclick,
    },
    supported_actions: supportedActions,
    unsupported_actions: unsupportedActions,
    requirements,
    permission_notes: [
      "Grant Accessibility and Automation permissions to the terminal process.",
    ],
  };
}

async function detectLinuxCapabilities(actions) {
  const hasDisplay = String(process.env.DISPLAY ?? "").trim().length > 0;
  const hasWaylandOnly = !hasDisplay && String(process.env.WAYLAND_DISPLAY ?? "").trim().length > 0;
  const [hasXdotool, hasXclip] = await Promise.all([
    commandExists("xdotool", 1_200),
    commandExists("xclip", 1_200),
  ]);
  const baseSupported = hasDisplay && hasXdotool;
  const requirements = [];
  if (!hasDisplay) {
    if (hasWaylandOnly) {
      requirements.push("Wayland-only session detected; X11 DISPLAY or equivalent bridge is required.");
    } else {
      requirements.push("Set DISPLAY for X11-compatible native input.");
    }
  }
  if (!hasXdotool) {
    requirements.push("Install `xdotool` for keyboard/mouse actions.");
  }
  if (!hasXclip) {
    requirements.push("Optional: install `xclip` for true clipboard paste (fallback can type text).");
  }
  return {
    platform: "linux",
    driver: "linux-xdotool",
    checks: {
      display: hasDisplay,
      wayland_only: hasWaylandOnly,
      xdotool: hasXdotool,
      xclip: hasXclip,
    },
    supported_actions: baseSupported ? [...actions] : [],
    unsupported_actions: baseSupported ? [] : [...actions],
    requirements,
    permission_notes: [
      "Window manager/focus policies may still block specific actions even when tooling is present.",
    ],
  };
}

function detectUnsupportedCapabilities(platform, actions) {
  return {
    platform,
    driver: "unsupported",
    checks: {},
    supported_actions: [],
    unsupported_actions: [...actions],
    requirements: [`Unsupported platform: ${platform}`],
    permission_notes: [],
  };
}

async function detectNativeInputCapabilitiesUncached() {
  const platform = process.platform;
  const actions = allNativeInputActions();
  if (platform === "win32") {
    return detectWindowsCapabilities(actions);
  }
  if (platform === "darwin") {
    return detectDarwinCapabilities(actions);
  }
  if (platform === "linux") {
    return detectLinuxCapabilities(actions);
  }
  return detectUnsupportedCapabilities(platform, actions);
}

export {
  detectNativeInputCapabilitiesUncached,
};
