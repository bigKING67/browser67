import { spawn } from "node:child_process";

import { compactText } from "../common.mjs";
import { normalizeNativeInputTimeoutMs } from "./normalize.mjs";

function parseJsonFromCommandOutput(stdout) {
  const rows = String(stdout ?? "")
    .split(/\r?\n/g)
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
  for (let index = rows.length - 1; index >= 0; index -= 1) {
    try {
      return JSON.parse(rows[index]);
    } catch {
      // continue
    }
  }
  return null;
}

async function runNativeCommand(command, args = [], options = {}) {
  const timeoutMs = normalizeNativeInputTimeoutMs(options.timeoutMs);
  const env = options.env ?? process.env;
  const input = typeof options.input === "string" ? options.input : null;
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      env,
      stdio: ["pipe", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) {
        return;
      }
      settled = true;
      try {
        child.kill("SIGKILL");
      } catch {
        // no-op
      }
      reject(new Error(`native input execution failed: ${command} timeout after ${String(timeoutMs)}ms`));
    }, timeoutMs);
    const finish = (payload) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      resolve(payload);
    };
    child.on("error", (error) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      reject(error);
    });
    child.stdout.on("data", (chunk) => {
      stdout += String(chunk);
    });
    child.stderr.on("data", (chunk) => {
      stderr += String(chunk);
    });
    child.on("close", (code, signal) => {
      finish({
        code: typeof code === "number" ? code : -1,
        signal: signal ? String(signal) : "",
        stdout,
        stderr,
        command,
        args,
      });
    });
    if (input !== null) {
      child.stdin.write(input);
    }
    child.stdin.end();
  });
}

async function commandExists(command, timeoutMs = 2_000) {
  const probeCommand = process.platform === "win32" ? "where" : "which";
  try {
    const result = await runNativeCommand(probeCommand, [command], { timeoutMs });
    return result.code === 0;
  } catch {
    return false;
  }
}

function ensureNativeCommandOk(result, label) {
  if (result.code === 0) {
    return;
  }
  const detail = compactText(result.stderr || result.stdout || "unknown command failure", 600);
  throw new Error(`${label} failed exit=${String(result.code)} detail=${detail}`);
}

export {
  commandExists,
  ensureNativeCommandOk,
  parseJsonFromCommandOutput,
  runNativeCommand,
};
