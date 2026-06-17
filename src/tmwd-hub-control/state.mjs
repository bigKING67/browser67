import { spawnSync } from "node:child_process";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

import {
  DEFAULT_TMWD_LINK_ENDPOINT,
  DEFAULT_TMWD_WS_ENDPOINT,
  repoRoot,
} from "./paths.mjs";

function isPidAlive(pid) {
  if (!Number.isFinite(Number(pid))) {
    return false;
  }
  try {
    process.kill(Number(pid), 0);
    return true;
  } catch {
    return false;
  }
}

function discoverHubPidByPs() {
  const result = spawnSync("ps", ["-Ao", "pid=,command="], {
    encoding: "utf8",
  });
  if (result.error || result.status !== 0) {
    return null;
  }
  const lines = String(result.stdout ?? "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  const matches = [];
  for (const line of lines) {
    const firstSpace = line.indexOf(" ");
    if (firstSpace <= 0) {
      continue;
    }
    const pidText = line.slice(0, firstSpace).trim();
    const command = line.slice(firstSpace + 1).trim();
    if (!command.includes("tmwd-hub.mjs")) {
      continue;
    }
    if (!command.includes(repoRoot)) {
      continue;
    }
    if (command.includes("tmwd-hub-control.mjs")) {
      continue;
    }
    const pid = Number(pidText);
    if (Number.isFinite(pid) && pid > 1) {
      matches.push(pid);
    }
  }
  if (matches.length === 1) {
    return matches[0];
  }
  return null;
}

function shouldUseProcessScanFallback(config) {
  const wsEndpoint = String(config?.tmwd_ws_endpoint ?? "").trim();
  const linkEndpoint = String(config?.tmwd_link_endpoint ?? "").trim();
  return wsEndpoint === DEFAULT_TMWD_WS_ENDPOINT && linkEndpoint === DEFAULT_TMWD_LINK_ENDPOINT;
}

async function readState(statePath) {
  try {
    const raw = await readFile(statePath, "utf8");
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

async function writeState(statePath, payload) {
  await mkdir(dirname(statePath), { recursive: true });
  await writeFile(statePath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
}

async function removeState(statePath) {
  try {
    await rm(statePath, { force: true });
  } catch {
    // ignore
  }
}

export {
  discoverHubPidByPs,
  isPidAlive,
  readState,
  removeState,
  shouldUseProcessScanFallback,
  writeState,
};
