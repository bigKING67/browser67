#!/usr/bin/env node

import { spawn, spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { Socket } from "node:net";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const repoRoot = resolve(__dirname, "..");
const runtimeHome = resolve(
  process.env.TMWD_BROWSER_MCP_HOME
    || process.env.TMWD_HOME
    || `${process.env.HOME || process.cwd()}/.tmwd-browser-mcp`,
);
const tmwdHubPath = resolve(__dirname, "tmwd-hub.mjs");
const defaultStatePath = resolve(runtimeHome, "runtime", "tmwd-hub-state.json");
const DEFAULT_TMWD_WS_ENDPOINT = "ws://127.0.0.1:18765";
const DEFAULT_TMWD_LINK_ENDPOINT = "http://127.0.0.1:18766/link";

function parseArgs(argv) {
  const command = String(argv[0] ?? "").trim().toLowerCase();
  const parsed = {
    command,
    json: false,
    wait_ms: 4_000,
    timeout_ms: 800,
    tmwd_ws_endpoint: DEFAULT_TMWD_WS_ENDPOINT,
    tmwd_link_endpoint: DEFAULT_TMWD_LINK_ENDPOINT,
    state_file: defaultStatePath,
  };
  for (let index = 1; index < argv.length; index += 1) {
    const token = argv[index] ?? "";
    if (token === "--json") {
      parsed.json = true;
      continue;
    }
    if (token === "--wait-ms") {
      const value = Number(argv[index + 1] ?? "");
      if (!Number.isFinite(value) || value <= 0) {
        throw new Error("invalid --wait-ms value");
      }
      parsed.wait_ms = Math.floor(value);
      index += 1;
      continue;
    }
    if (token === "--timeout-ms") {
      const value = Number(argv[index + 1] ?? "");
      if (!Number.isFinite(value) || value <= 0) {
        throw new Error("invalid --timeout-ms value");
      }
      parsed.timeout_ms = Math.floor(value);
      index += 1;
      continue;
    }
    if (token === "--tmwd-ws-endpoint") {
      const value = String(argv[index + 1] ?? "").trim();
      if (!value) {
        throw new Error("invalid --tmwd-ws-endpoint value");
      }
      parsed.tmwd_ws_endpoint = value;
      index += 1;
      continue;
    }
    if (token === "--tmwd-link-endpoint") {
      const value = String(argv[index + 1] ?? "").trim();
      if (!value) {
        throw new Error("invalid --tmwd-link-endpoint value");
      }
      parsed.tmwd_link_endpoint = value;
      index += 1;
      continue;
    }
    if (token === "--state-file") {
      const value = String(argv[index + 1] ?? "").trim();
      if (!value) {
        throw new Error("invalid --state-file value");
      }
      parsed.state_file = value;
      index += 1;
      continue;
    }
    if (!token) {
      continue;
    }
    throw new Error(`unknown argument: ${token}`);
  }
  if (!["start", "stop", "status"].includes(parsed.command)) {
    throw new Error("usage: tmwd-hub-control.mjs <start|stop|status> [options]");
  }
  return parsed;
}

function parseEndpoint(endpoint) {
  const value = String(endpoint ?? "").trim();
  if (!value) {
    throw new Error("empty endpoint");
  }
  const url = new URL(value);
  const protocol = url.protocol.replace(":", "");
  let port = Number(url.port || "");
  if (!Number.isFinite(port) || port <= 0) {
    port = protocol === "https" || protocol === "wss" ? 443 : 80;
  }
  return {
    protocol,
    host: url.hostname,
    port,
    href: url.href,
  };
}

async function probeTcp(endpoint, timeoutMs) {
  const parsed = parseEndpoint(endpoint);
  const startedAt = Date.now();
  return await new Promise((resolvePromise) => {
    const socket = new Socket();
    let finished = false;
    const finish = (reachable, detail) => {
      if (finished) {
        return;
      }
      finished = true;
      try {
        socket.destroy();
      } catch {
        // ignore
      }
      resolvePromise({
        endpoint: parsed.href,
        host: parsed.host,
        port: parsed.port,
        reachable,
        latency_ms: Date.now() - startedAt,
        detail,
      });
    };
    socket.setTimeout(timeoutMs);
    socket.once("connect", () => finish(true, "connect_ok"));
    socket.once("timeout", () => finish(false, "timeout"));
    socket.once("error", (error) => finish(false, String(error?.code ?? error?.message ?? "socket_error")));
    socket.connect(parsed.port, parsed.host);
  });
}

async function probeLinkHttp(endpoint, timeoutMs) {
  const startedAt = Date.now();
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const response = await fetch(endpoint, { method: "GET", signal: controller.signal });
    clearTimeout(timer);
    return {
      endpoint,
      ok: response.ok,
      status: response.status,
      latency_ms: Date.now() - startedAt,
      detail: response.ok ? "http_ok" : `http_${String(response.status)}`,
    };
  } catch (error) {
    return {
      endpoint,
      ok: false,
      status: null,
      latency_ms: Date.now() - startedAt,
      detail: String(error?.name === "AbortError" ? "timeout" : (error?.message ?? error)),
    };
  }
}

async function probeLinkCommand(endpoint, timeoutMs) {
  const startedAt = Date.now();
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({ cmd: "get_all_sessions" }),
      signal: controller.signal,
    });
    clearTimeout(timer);
    const text = await response.text();
    let parsed;
    try {
      parsed = JSON.parse(text);
    } catch {
      parsed = null;
    }
    const hasR = parsed && typeof parsed === "object" && "r" in parsed;
    const sessions = Array.isArray(parsed?.r) ? parsed.r : [];
    return {
      endpoint,
      ok: response.ok && hasR,
      status: response.status,
      latency_ms: Date.now() - startedAt,
      session_count: sessions.length,
      detail: response.ok ? (hasR ? "http_ok_with_r" : "http_ok_without_r") : `http_${String(response.status)}`,
    };
  } catch (error) {
    return {
      endpoint,
      ok: false,
      status: null,
      latency_ms: Date.now() - startedAt,
      session_count: 0,
      detail: String(error?.name === "AbortError" ? "timeout" : (error?.message ?? error)),
    };
  }
}

function sleep(ms) {
  return new Promise((resolvePromise) => {
    setTimeout(resolvePromise, ms);
  });
}

function nowIso() {
  return new Date().toISOString();
}

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

function readState(statePath) {
  try {
    const raw = readFileSync(statePath, "utf8");
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

function writeState(statePath, payload) {
  mkdirSync(dirname(statePath), { recursive: true });
  writeFileSync(statePath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
}

function removeState(statePath) {
  try {
    rmSync(statePath, { force: true });
  } catch {
    // ignore
  }
}

function formatStatusHuman(payload) {
  const rows = [];
  rows.push(`tmwd_hub running=${payload.running ? "yes" : "no"} managed=${payload.managed ? "yes" : "no"}`);
  rows.push(`ws_tcp=${payload.checks.ws_tcp.reachable ? "up" : "down"} ${payload.checks.ws_tcp.endpoint}`);
  rows.push(`link_tcp=${payload.checks.link_tcp.reachable ? "up" : "down"} ${payload.checks.link_tcp.endpoint}`);
  rows.push(`link_http=${payload.checks.link_http.ok ? "ok" : "fail"} status=${String(payload.checks.link_http.status ?? "null")}`);
  rows.push(`link_cmd=${payload.checks.link_cmd.ok ? "ok" : "fail"} sessions=${String(payload.checks.link_cmd.session_count ?? 0)}`);
  rows.push(`tmwd_signature=${payload.tmwd_signature_ok ? "yes" : "no"} conflict_suspected=${payload.conflict_suspected ? "yes" : "no"}`);
  if (Number.isFinite(Number(payload.state?.pid ?? NaN))) {
    rows.push(`pid=${String(payload.state.pid)} source=${payload.pid_source} alive=${payload.pid_alive ? "yes" : "no"}`);
  } else {
    rows.push("pid=unknown");
  }
  rows.push(`state_file=${payload.state_file}`);
  return rows.join("\n");
}

async function collectStatus(config) {
  const state = readState(config.state_file);
  const wsTcp = await probeTcp(config.tmwd_ws_endpoint, config.timeout_ms);
  const linkTcp = await probeTcp(config.tmwd_link_endpoint, config.timeout_ms);
  const linkHttp = linkTcp.reachable
    ? await probeLinkHttp(config.tmwd_link_endpoint, config.timeout_ms)
    : {
      endpoint: config.tmwd_link_endpoint,
      ok: false,
      status: null,
      latency_ms: 0,
      detail: "skipped_tcp_unreachable",
    };
  const linkCommand = linkTcp.reachable
    ? await probeLinkCommand(config.tmwd_link_endpoint, config.timeout_ms)
    : {
      endpoint: config.tmwd_link_endpoint,
      ok: false,
      status: null,
      latency_ms: 0,
      session_count: 0,
      detail: "skipped_tcp_unreachable",
    };
  const statePid = Number(state?.pid ?? NaN);
  const statePidAlive = Number.isFinite(statePid) ? isPidAlive(statePid) : false;
  const scannedPid = !statePidAlive && shouldUseProcessScanFallback(config)
    ? discoverHubPidByPs()
    : null;
  const discoveredPid = statePidAlive
    ? statePid
    : (Number.isFinite(scannedPid) ? scannedPid : null);
  const pidAlive = Number.isFinite(discoveredPid) ? isPidAlive(discoveredPid) : false;
  const running = wsTcp.reachable || linkTcp.reachable;
  const tmwdSignatureOk = linkCommand.ok === true;
  const conflictSuspected = running && !Number.isFinite(discoveredPid) && !tmwdSignatureOk;
  const pidSource = statePidAlive
    ? "state"
    : (Number.isFinite(scannedPid) ? "process_scan" : "none");
  const effectiveState = {
    ...(state ?? {}),
    ...(Number.isFinite(discoveredPid) ? { pid: discoveredPid } : {}),
  };
  return {
    ok: true,
    action: "status",
    running,
    managed: Number.isFinite(discoveredPid),
    pid_alive: pidAlive,
    pid_source: pidSource,
    tmwd_signature_ok: tmwdSignatureOk,
    conflict_suspected: conflictSuspected,
    state_file: config.state_file,
    state: effectiveState,
    checks: {
      ws_tcp: wsTcp,
      link_tcp: linkTcp,
      link_http: linkHttp,
      link_cmd: linkCommand,
    },
  };
}

function buildHubEnv(config) {
  const ws = parseEndpoint(config.tmwd_ws_endpoint);
  const link = parseEndpoint(config.tmwd_link_endpoint);
  if (!["ws", "wss"].includes(ws.protocol)) {
    throw new Error("tmwd ws endpoint must use ws/wss");
  }
  if (!["http", "https"].includes(link.protocol)) {
    throw new Error("tmwd link endpoint must use http/https");
  }
  if (ws.host !== link.host) {
    throw new Error("tmwd ws/link host must match for hub auto-start");
  }
  return {
    ...process.env,
    TMWD_HUB_HOST: ws.host,
    TMWD_HUB_WS_PORT: String(ws.port),
    TMWD_HUB_LINK_PORT: String(link.port),
  };
}

async function startHub(config) {
  const before = await collectStatus(config);
  if (before.running) {
    if (before.conflict_suspected === true) {
      return {
        ok: false,
        action: "start",
        started: false,
        reason: "port_in_use_unmanaged",
        hint: "tmwd port is occupied by an unmanaged process; free 18765/18766 or stop that process first",
        status: before,
      };
    }
    if (before.pid_source === "process_scan" && Number.isFinite(Number(before?.state?.pid ?? NaN))) {
      writeState(config.state_file, {
        pid: Number(before.state.pid),
        adopted_at: nowIso(),
        tmwd_ws_endpoint: config.tmwd_ws_endpoint,
        tmwd_link_endpoint: config.tmwd_link_endpoint,
      });
    }
    return {
      ok: true,
      action: "start",
      started: false,
      reason: before.pid_source === "process_scan"
        ? "already_running_adopted"
        : (before.pid_source === "none" ? "already_running_unmanaged" : "already_running"),
      status: before,
    };
  }
  const child = spawn("node", [tmwdHubPath], {
    cwd: repoRoot,
    env: buildHubEnv(config),
    detached: true,
    stdio: "ignore",
  });
  child.unref();
  const pid = Number(child.pid ?? NaN);
  writeState(config.state_file, {
    pid: Number.isFinite(pid) ? pid : null,
    started_at: nowIso(),
    tmwd_ws_endpoint: config.tmwd_ws_endpoint,
    tmwd_link_endpoint: config.tmwd_link_endpoint,
  });

  const deadline = Date.now() + config.wait_ms;
  let after = before;
  while (Date.now() < deadline) {
    await sleep(250);
    after = await collectStatus(config);
    if (after.running) {
      return {
        ok: true,
        action: "start",
        started: true,
        reason: "started",
        status: after,
      };
    }
  }
  return {
    ok: false,
    action: "start",
    started: false,
    reason: "start_timeout",
    status: after,
  };
}

async function stopHub(config) {
  const before = await collectStatus(config);
  const statePid = Number(before?.state?.pid ?? NaN);
  if (!Number.isFinite(statePid)) {
    return {
      ok: !before.running,
      action: "stop",
      stopped: !before.running,
      reason: before.running ? "running_unmanaged_pid_unknown" : "already_stopped",
      status: before,
    };
  }

  let signalSent = false;
  if (isPidAlive(statePid)) {
    try {
      process.kill(statePid, "SIGTERM");
      signalSent = true;
    } catch {
      // ignore
    }
  }

  const deadline = Date.now() + config.wait_ms;
  let after = before;
  while (Date.now() < deadline) {
    await sleep(200);
    after = await collectStatus(config);
    const alive = isPidAlive(statePid);
    if (!alive && !after.running) {
      removeState(config.state_file);
      return {
        ok: true,
        action: "stop",
        stopped: true,
        reason: signalSent ? "stopped_after_sigterm" : "already_stopped",
        status: after,
      };
    }
  }

  return {
    ok: false,
    action: "stop",
    stopped: false,
    reason: "stop_timeout",
    signal_sent: signalSent,
    status: after,
  };
}

async function run() {
  const config = parseArgs(process.argv.slice(2));
  let payload;
  if (config.command === "status") {
    payload = await collectStatus(config);
  } else if (config.command === "start") {
    payload = await startHub(config);
  } else if (config.command === "stop") {
    payload = await stopHub(config);
  } else {
    throw new Error(`unsupported command: ${config.command}`);
  }
  if (config.json) {
    process.stdout.write(`${JSON.stringify(payload)}\n`);
  } else if (payload.action === "status") {
    process.stdout.write(`${formatStatusHuman(payload)}\n`);
  } else {
    process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
  }
  if (payload.ok !== true) {
    process.exitCode = 1;
  }
}

try {
  await run();
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`tmwd-hub-control failed: ${message}\n`);
  process.exitCode = 1;
}
