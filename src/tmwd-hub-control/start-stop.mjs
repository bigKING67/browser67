import { spawn } from "node:child_process";

import { parseEndpoint } from "./endpoints.mjs";
import { tmwdHubPath, repoRoot } from "./paths.mjs";
import {
  probeLinkCommand,
  probeLinkHttp,
  probeTcp,
} from "./probe.mjs";
import {
  discoverHubPidByPs,
  isPidAlive,
  readState,
  removeState,
  shouldUseProcessScanFallback,
  writeState,
} from "./state.mjs";

function sleep(ms) {
  return new Promise((resolvePromise) => {
    setTimeout(resolvePromise, ms);
  });
}

function nowIso() {
  return new Date().toISOString();
}

function skippedLinkProbe(endpoint, detail) {
  return {
    endpoint,
    ok: false,
    status: null,
    latency_ms: 0,
    detail,
  };
}

async function collectStatus(config) {
  const state = await readState(config.state_file);
  const wsTcp = await probeTcp(config.tmwd_ws_endpoint, config.timeout_ms);
  const linkTcp = await probeTcp(config.tmwd_link_endpoint, config.timeout_ms);
  const linkHttp = linkTcp.reachable
    ? await probeLinkHttp(config.tmwd_link_endpoint, config.timeout_ms)
    : skippedLinkProbe(config.tmwd_link_endpoint, "skipped_tcp_unreachable");
  const linkCommand = linkTcp.reachable
    ? await probeLinkCommand(config.tmwd_link_endpoint, config.timeout_ms)
    : {
      ...skippedLinkProbe(config.tmwd_link_endpoint, "skipped_tcp_unreachable"),
      session_count: 0,
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
    throw new Error("tmwd ws/link host must match when auto-starting hub");
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
      await writeState(config.state_file, {
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
  await writeState(config.state_file, {
    pid: Number.isFinite(pid) ? pid : null,
    started_at: nowIso(),
    tmwd_ws_endpoint: config.tmwd_ws_endpoint,
    tmwd_link_endpoint: config.tmwd_link_endpoint,
  });

  const after = await waitForHubRunning(config, Date.now() + config.wait_ms, before);
  if (after.running) {
    return {
      ok: true,
      action: "start",
      started: true,
      reason: "started",
      status: after,
    };
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
  const after = await waitForHubStopped(config, statePid, deadline, before);
  if (!isPidAlive(statePid) && !after.running) {
    await removeState(config.state_file);
    return {
      ok: true,
      action: "stop",
      stopped: true,
      reason: signalSent ? "stopped_after_sigterm" : "already_stopped",
      status: after,
    };
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

async function waitForHubRunning(config, deadline, previous) {
  if (Date.now() >= deadline) {
    return previous;
  }
  await sleep(250);
  const status = await collectStatus(config);
  if (status.running) {
    return status;
  }
  return await waitForHubRunning(config, deadline, status);
}

async function waitForHubStopped(config, statePid, deadline, previous) {
  if (Date.now() >= deadline) {
    return previous;
  }
  await sleep(200);
  const status = await collectStatus(config);
  if (!isPidAlive(statePid) && !status.running) {
    return status;
  }
  return await waitForHubStopped(config, statePid, deadline, status);
}

export {
  buildHubEnv,
  collectStatus,
  startHub,
  stopHub,
};
