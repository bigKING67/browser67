import { commandExists, runCommand } from "./process-runner.mjs";

async function installForDarwin(actions, options) {
  const hasBrew = await commandExists("brew");
  if (!hasBrew) {
    actions.push({
      step: "install_cliclick",
      ok: false,
      message: "Homebrew not found; cannot auto-install cliclick.",
      hint: "Install Homebrew first, then run: brew install cliclick",
    });
    return false;
  }
  if (!options.yes) {
    actions.push({
      step: "install_cliclick",
      ok: false,
      message: "Auto-install requires --yes",
      hint: "Run with --install --yes",
    });
    return false;
  }
  const install = await runCommand("brew", ["install", "cliclick"], 10 * 60_000);
  actions.push({
    step: "install_cliclick",
    ok: install.ok,
    code: install.code,
    stdout_tail: install.stdout.trim().split("\n").slice(-8),
    stderr_tail: install.stderr.trim().split("\n").slice(-8),
  });
  return install.ok;
}

function detectLinuxPackageManager() {
  return [
    { binary: "apt-get", args: ["sudo", "apt-get", "install", "-y", "xdotool", "xclip"] },
    { binary: "dnf", args: ["sudo", "dnf", "install", "-y", "xdotool", "xclip"] },
    { binary: "yum", args: ["sudo", "yum", "install", "-y", "xdotool", "xclip"] },
    { binary: "pacman", args: ["sudo", "pacman", "-Sy", "--noconfirm", "xdotool", "xclip"] },
    { binary: "zypper", args: ["sudo", "zypper", "--non-interactive", "install", "xdotool", "xclip"] },
  ];
}

async function installForLinux(actions, options) {
  if (!options.yes) {
    actions.push({
      step: "install_linux_native_tools",
      ok: false,
      message: "Auto-install requires --yes",
      hint: "Run with --install --yes",
    });
    return false;
  }
  const managers = detectLinuxPackageManager();
  const availability = await Promise.all(
    managers.map(async (manager) => ({
      manager,
      exists: await commandExists(manager.binary),
    })),
  );
  const selected = availability.find((row) => row.exists === true)?.manager ?? null;
  if (!selected) {
    actions.push({
      step: "install_linux_native_tools",
      ok: false,
      message: "No supported package manager found.",
      hint: "Install xdotool and xclip manually.",
    });
    return false;
  }
  const install = await runCommand(selected.args[0], selected.args.slice(1), 10 * 60_000);
  actions.push({
    step: "install_linux_native_tools",
    manager: selected.binary,
    ok: install.ok,
    code: install.code,
    stdout_tail: install.stdout.trim().split("\n").slice(-8),
    stderr_tail: install.stderr.trim().split("\n").slice(-8),
  });
  return install.ok;
}

async function maybeInstallDependencies(platform, capabilities, options, actions) {
  if (!options.install) {
    return false;
  }
  if (platform === "win32") {
    const hasPowerShell = capabilities?.checks?.powershell === true;
    if (hasPowerShell) {
      actions.push({
        step: "install_windows_native_tools",
        ok: true,
        message: "powershell already available",
      });
      return false;
    }
    actions.push({
      step: "install_windows_native_tools",
      ok: false,
      message: "PowerShell not found on PATH.",
      hint: "Install PowerShell and ensure `powershell` or `pwsh` is available. Example: winget install --id Microsoft.PowerShell -e",
    });
    return false;
  }
  if (platform === "darwin") {
    const hasCliclick = capabilities?.checks?.cliclick === true;
    if (hasCliclick) {
      actions.push({
        step: "install_cliclick",
        ok: true,
        message: "cliclick already installed",
      });
      return false;
    }
    return installForDarwin(actions, options);
  }
  if (platform === "linux") {
    const hasXdotool = capabilities?.checks?.xdotool === true;
    const hasXclip = capabilities?.checks?.xclip === true;
    if (hasXdotool && hasXclip) {
      actions.push({
        step: "install_linux_native_tools",
        ok: true,
        message: "xdotool and xclip already installed",
      });
      return false;
    }
    return installForLinux(actions, options);
  }
  actions.push({
    step: "install_skipped",
    ok: true,
    message: `No install action needed for platform=${platform}`,
  });
  return false;
}

export {
  maybeInstallDependencies,
};
