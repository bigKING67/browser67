import { spawnSync } from "node:child_process";

import { repoRoot } from "./paths.mjs";

const DEFAULT_CHILD_PROCESS_TIMEOUT_MS = 30_000;

function normalizeChildProcessTimeoutMs(raw, fallback = DEFAULT_CHILD_PROCESS_TIMEOUT_MS) {
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }
  return Math.max(250, Math.min(600_000, Math.floor(parsed)));
}

function parseLastJsonLine(stdout) {
  const rows = String(stdout ?? "")
    .split(/\r?\n/)
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
  for (let index = rows.length - 1; index >= 0; index -= 1) {
    const line = rows[index];
    try {
      return JSON.parse(line);
    } catch {
      // continue
    }
  }
  return null;
}

function runNodeScript(scriptPath, args, options = {}) {
  const timeoutMs = normalizeChildProcessTimeoutMs(
    options.timeout_ms ?? options.timeoutMs,
  );
  return spawnSync(process.execPath, [scriptPath, ...args], {
    cwd: repoRoot,
    env: process.env,
    encoding: "utf8",
    timeout: timeoutMs,
    killSignal: "SIGKILL",
  });
}

function childProcessTimedOut(result) {
  return result?.error?.code === "ETIMEDOUT";
}

function sleep(ms) {
  return new Promise((resolvePromise) => {
    setTimeout(resolvePromise, ms);
  });
}

export {
  childProcessTimedOut,
  normalizeChildProcessTimeoutMs,
  parseLastJsonLine,
  runNodeScript,
  sleep,
};
