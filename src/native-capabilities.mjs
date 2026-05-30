import { allNativeInputActions, commandExists } from "./native-core.mjs";

async function detectNativeInputCapabilities() {
  const platform = process.platform;
  const actions = allNativeInputActions();
  if (platform === "win32") {
    const hasPowerShell = await commandExists("powershell", 1_200) || await commandExists("pwsh", 1_200);
    return {
      platform,
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
  if (platform === "darwin") {
    const hasOsaScript = await commandExists("osascript", 1_200);
    const hasCliclick = await commandExists("cliclick", 1_200);
    const noPointerActions = [
      "activate_window",
      "press",
      "type",
      "paste",
      "get_window_rect",
    ];
    const pointerActions = [
      "move",
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
      requirements.push("Install `cliclick` for pointer actions (`move/click/double_click/scroll`).");
    }
    return {
      platform,
      driver: "macos-osascript-cliclick",
      checks: {
        osascript: hasOsaScript,
        cliclick: hasCliclick,
      },
      supported_actions: supportedActions,
      unsupported_actions: unsupportedActions,
      requirements,
      permission_notes: [
        "Grant Accessibility and Automation permissions to terminal process for native input.",
      ],
    };
  }
  if (platform === "linux") {
    const hasDisplay = String(process.env.DISPLAY ?? "").trim().length > 0;
    const hasWaylandOnly = !hasDisplay && String(process.env.WAYLAND_DISPLAY ?? "").trim().length > 0;
    const hasXdotool = await commandExists("xdotool", 1_200);
    const hasXclip = await commandExists("xclip", 1_200);
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
      platform,
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

export { detectNativeInputCapabilities };
