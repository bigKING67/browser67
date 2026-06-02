#!/usr/bin/env node

import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";
import process from "node:process";

const POINTER_ACTIONS = ["move", "click", "double_click", "scroll"];
const TIMEOUT_MS = 45_000;

function parseArgs(argv) {
  const flags = new Set(argv.slice(2));
  return {
    install: flags.has("--install"),
    yes: flags.has("--yes"),
    json: flags.has("--json"),
    quiet: flags.has("--quiet"),
  };
}

function emit(payload, options = {}) {
  if (options.json) {
    process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
    return;
  }
  if (options.quiet) {
    return;
  }
  if (typeof payload === "object" && payload !== null) {
    process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
    return;
  }
  process.stdout.write(`${String(payload)}\n`);
}

function runCommand(command, args, timeoutMs = 120_000) {
  return new Promise((resolve) => {
    const proc = spawn(command, args, {
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    let done = false;
    const timer = setTimeout(() => {
      if (done) {
        return;
      }
      done = true;
      proc.kill("SIGTERM");
      resolve({
        ok: false,
        code: null,
        stdout,
        stderr: `${stderr}\nTIMEOUT after ${String(timeoutMs)}ms`.trim(),
      });
    }, timeoutMs);
    proc.stdout.on("data", (chunk) => {
      stdout += chunk.toString("utf8");
    });
    proc.stderr.on("data", (chunk) => {
      stderr += chunk.toString("utf8");
    });
    proc.on("error", (error) => {
      if (done) {
        return;
      }
      done = true;
      clearTimeout(timer);
      resolve({
        ok: false,
        code: null,
        stdout,
        stderr: `${stderr}\n${String(error)}`.trim(),
      });
    });
    proc.on("close", (code) => {
      if (done) {
        return;
      }
      done = true;
      clearTimeout(timer);
      resolve({
        ok: code === 0,
        code,
        stdout,
        stderr,
      });
    });
  });
}

async function commandExists(command) {
  const probe = process.platform === "win32" ? "where" : "which";
  const result = await runCommand(probe, [command], 5_000);
  return result.ok;
}

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

function createMcpClient(serverPath) {
  const proc = spawn("node", [serverPath], {
    stdio: ["pipe", "pipe", "pipe"],
  });
  let nextId = 1;
  let buffer = "";
  const pending = new Map();
  let processClosed = false;
  let processFailure = null;

  proc.stdout.on("data", (chunk) => {
    buffer += chunk.toString("utf8");
    while (true) {
      const idx = buffer.indexOf("\n");
      if (idx < 0) {
        break;
      }
      const line = buffer.slice(0, idx).trim();
      buffer = buffer.slice(idx + 1);
      if (!line) {
        continue;
      }
      let message;
      try {
        message = JSON.parse(line);
      } catch {
        continue;
      }
      if (!message.id || !pending.has(message.id)) {
        continue;
      }
      const { resolve } = pending.get(message.id);
      pending.delete(message.id);
      resolve(message);
    }
  });

  proc.stderr.on("data", () => {
    // keep silent; this script reports structured output
  });

  proc.on("error", (error) => {
    processFailure = error;
    for (const { reject } of pending.values()) {
      reject(new Error(`mcp process error: ${String(error?.message ?? error)}`));
    }
    pending.clear();
  });

  proc.on("close", (code) => {
    processClosed = true;
    if (code === 0) {
      return;
    }
    if (!processFailure) {
      processFailure = new Error(`mcp process exited code=${String(code)}`);
    }
    for (const { reject } of pending.values()) {
      reject(new Error(`mcp process closed: ${String(processFailure?.message ?? processFailure)}`));
    }
    pending.clear();
  });

  function request(method, params, timeoutMs = TIMEOUT_MS) {
    if (processFailure) {
      return Promise.reject(new Error(`mcp unavailable: ${String(processFailure?.message ?? processFailure)}`));
    }
    if (processClosed) {
      return Promise.reject(new Error(`mcp unavailable: process closed method=${method}`));
    }
    const id = nextId++;
    return new Promise((resolve, reject) => {
      try {
        proc.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`);
      } catch (error) {
        reject(new Error(`mcp write failed method=${method}: ${String(error?.message ?? error)}`));
        return;
      }
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(new Error(`mcp timeout method=${method}`));
      }, timeoutMs);
      pending.set(id, {
        resolve: (message) => {
          clearTimeout(timer);
          resolve(message);
        },
        reject: (error) => {
          clearTimeout(timer);
          reject(error);
        },
      });
    });
  }

  async function toolCall(name, args) {
    const response = await request("tools/call", { name, arguments: args });
    if (response.error) {
      throw new Error(`tool_call_error ${name}: ${JSON.stringify(response.error)}`);
    }
    const content = response?.result?.content;
    if (!Array.isArray(content)) {
      throw new Error(`tool_call_bad_payload ${name}: missing content`);
    }
    const jsonPayload = content
      .map((item) => {
        if (item?.type === "json" && typeof item.json === "object" && item.json !== null) {
          return item.json;
        }
        if (item?.type === "text" && typeof item.text === "string") {
          try {
            const parsed = JSON.parse(item.text);
            return typeof parsed === "object" && parsed !== null ? parsed : null;
          } catch {
            return null;
          }
        }
        return null;
      })
      .find(Boolean);
    if (!jsonPayload) {
      throw new Error(`tool_call_bad_payload ${name}: missing JSON payload`);
    }
    return jsonPayload;
  }

  async function close() {
    proc.kill("SIGTERM");
  }

  return {
    request,
    toolCall,
    close,
  };
}

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
  const candidates = [
    { binary: "apt-get", args: ["sudo", "apt-get", "install", "-y", "xdotool", "xclip"] },
    { binary: "dnf", args: ["sudo", "dnf", "install", "-y", "xdotool", "xclip"] },
    { binary: "yum", args: ["sudo", "yum", "install", "-y", "xdotool", "xclip"] },
    { binary: "pacman", args: ["sudo", "pacman", "-Sy", "--noconfirm", "xdotool", "xclip"] },
    { binary: "zypper", args: ["sudo", "zypper", "--non-interactive", "install", "xdotool", "xclip"] },
  ];
  return candidates;
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
  let selected = null;
  for (const manager of managers) {
    if (await commandExists(manager.binary)) {
      selected = manager;
      break;
    }
  }
  if (!selected) {
    actions.push({
      step: "install_linux_native_tools",
      ok: false,
      message: "No supported package manager found for auto-install.",
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

async function main() {
  const options = parseArgs(process.argv);
  const scriptPath = fileURLToPath(import.meta.url);
  const serverPath = path.resolve(path.dirname(scriptPath), "server.mjs");
  const actions = [];
  const client = createMcpClient(serverPath);
  const report = {
    ok: false,
    platform: process.platform,
    install_requested: options.install,
    install_attempted: false,
    actions,
    before: null,
    after: null,
  };

  try {
    const init = await client.request("initialize", {
      protocolVersion: "2024-11-05",
      capabilities: {},
      clientInfo: {
        name: "native-deps-setup",
        version: "0.1.0",
      },
    });
    if (init.error) {
      throw new Error(`initialize failed: ${JSON.stringify(init.error)}`);
    }
    const beforeCaps = await client.toolCall("browser_native_input", { action: "capabilities" });
    report.before = {
      raw: beforeCaps,
      summary: summarizeCapabilities(beforeCaps),
    };
    const changed = await maybeInstallDependencies(process.platform, beforeCaps, options, actions);
    report.install_attempted = options.install;
    const afterCaps = changed
      ? await client.toolCall("browser_native_input", { action: "capabilities" })
      : beforeCaps;
    report.after = {
      raw: afterCaps,
      summary: summarizeCapabilities(afterCaps),
    };
    report.ok = computeReportOk(process.platform, report.after.summary);
    if (!report.ok && !options.json && !options.quiet) {
      emit("native deps not fully ready. See requirements below:");
      for (const item of report.after.summary.requirements) {
        emit(`- ${item}`);
      }
    }
    emit(report, options);
    process.exitCode = report.ok ? 0 : 2;
  } catch (error) {
    report.ok = false;
    report.error = String(error?.message ?? error);
    emit(report, options);
    process.exitCode = 1;
  } finally {
    await client.close();
  }
}

main();
