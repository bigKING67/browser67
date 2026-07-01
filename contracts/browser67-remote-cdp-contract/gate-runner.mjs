import { spawnSync } from "node:child_process";

import { liveGatePath, repoRoot } from "./paths.mjs";

function parseLastJsonLine(stdout) {
  const rows = String(stdout ?? "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  for (let index = rows.length - 1; index >= 0; index -= 1) {
    try {
      return JSON.parse(rows[index]);
    } catch {
      // continue
    }
  }
  return null;
}

function runGate(args, timeoutMs) {
  const result = spawnSync(process.execPath, [liveGatePath, ...args], {
    cwd: repoRoot,
    env: process.env,
    encoding: "utf8",
    timeout: timeoutMs,
  });
  return {
    status: result.status,
    signal: result.signal,
    stdout: String(result.stdout ?? ""),
    stderr: String(result.stderr ?? ""),
    payload: parseLastJsonLine(result.stdout),
    error: result.error ? String(result.error.message ?? result.error) : "",
  };
}

export {
  runGate,
};
