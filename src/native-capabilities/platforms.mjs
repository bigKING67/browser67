import { allNativeInputActions, commandExists, runNativeCommand } from "../native-core/index.mjs";

function cliclickAccessibilityWarning(output) {
  return String(output ?? "").toLowerCase().includes("accessibility privileges not enabled");
}

async function probeCliclickAccessibility() {
  try {
    const result = await runNativeCommand("cliclick", ["-m", "test", "c:0,0"], { timeoutMs: 1_200 });
    const output = `${result.stdout ?? ""}\n${result.stderr ?? ""}`;
    return {
      ok: result.code === 0 && !cliclickAccessibilityWarning(output),
      warning: cliclickAccessibilityWarning(output),
    };
  } catch (error) {
    return {
      ok: false,
      warning: false,
      error: String(error?.message ?? error),
    };
  }
}

async function detectWindowsCapabilities(actions) {
  const [hasWindowsPowerShell, hasPowerShellCore] = await Promise.all([
    commandExists("powershell", 1_200),
    commandExists("pwsh", 1_200),
  ]);
  const hasPowerShell = hasWindowsPowerShell || hasPowerShellCore;
  return {
    platform: "win32",
    driver: "windows-powershell",
    coordinate_system: "physical_screen_pixels",
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
  const [hasOsaScript, hasCliclick, cliclickAccessibility] = await Promise.all([
    commandExists("osascript", 1_200),
    commandExists("cliclick", 1_200),
    probeCliclickAccessibility(),
  ]);
  const cliclickPointerReady = hasCliclick && cliclickAccessibility.ok === true;
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
  if (cliclickPointerReady) {
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
  if (hasCliclick && !cliclickPointerReady) {
    requirements.push("Grant Accessibility permission to the current terminal/Codex host so `cliclick` pointer actions can affect Chrome.");
  }
  return {
    platform: "darwin",
    driver: "macos-osascript-cliclick",
    coordinate_system: "screen_points",
    checks: {
      osascript: hasOsaScript,
      cliclick: hasCliclick,
      cliclick_accessibility: cliclickAccessibility.ok === true,
      cliclick_accessibility_warning: cliclickAccessibility.warning === true,
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
    coordinate_system: "screen_pixels",
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
    coordinate_system: "screen_pixels",
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
