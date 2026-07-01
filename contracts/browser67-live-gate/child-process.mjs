import { spawnSync } from "node:child_process";

import { repoRoot } from "./paths.mjs";

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

function runNodeScript(scriptPath, args) {
  return spawnSync("node", [scriptPath, ...args], {
    cwd: repoRoot,
    env: process.env,
    encoding: "utf8",
  });
}

function sleep(ms) {
  return new Promise((resolvePromise) => {
    setTimeout(resolvePromise, ms);
  });
}

export {
  parseLastJsonLine,
  runNodeScript,
  sleep,
};
