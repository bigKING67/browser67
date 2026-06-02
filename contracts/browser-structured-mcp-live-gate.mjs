#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { appendFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const repoRoot = resolve(__dirname, "..");
const liveDoctorPath = resolve(
  repoRoot,
  "contracts/browser-structured-mcp-live-doctor.mjs",
);
const liveContractPath = resolve(
  repoRoot,
  "contracts/browser-structured-mcp-live-contract.mjs",
);
const tmwdHubControlPath = resolve(
  repoRoot,
  "src/tmwd-hub-control.mjs",
);
const runtimeHome = resolve(
  process.env.TMWD_BROWSER_MCP_HOME
    || process.env.TMWD_HOME
    || `${process.env.HOME || process.cwd()}/.tmwd-browser-mcp`,
);
const DEFAULT_EVENT_LOG_PATH = resolve(
  runtimeHome,
  "runtime",
  "browser-live-gate-events.jsonl",
);

function normalizeTmwdMode(value) {
  const normalized = String(value ?? "").trim().toLowerCase();
  if (normalized === "auto" || normalized === "tmwd" || normalized === "remote_cdp" || normalized === "cdp") {
    return normalized;
  }
  throw new Error("invalid --tmwd-mode value (expected auto|tmwd|remote_cdp|cdp)");
}

function isRemoteCdpMode(mode) {
  return mode === "remote_cdp" || mode === "cdp";
}

function isTmwdReadyPath(readiness) {
  return readiness?.ready === true
    && (readiness.path === "tmwd_ws" || readiness.path === "tmwd_link");
}

function isCdpReadyPath(readiness) {
  return readiness?.ready === true && readiness.path === "cdp";
}

function shouldSuggestRemoteCdp(config, doctorPayload) {
  if (isRemoteCdpMode(config.tmwd_mode)) {
    return true;
  }
  if (config.tmwd_mode === "tmwd") {
    return false;
  }
  return !isTmwdReadyPath(doctorPayload?.readiness) && !isCdpReadyPath(doctorPayload?.readiness);
}

function parseArgs(argv) {
  const parsed = {
    timeout_ms: 12_000,
    tmwd_mode: "auto",
    tmwd_transport: "auto",
    tmwd_ws_endpoint: "ws://127.0.0.1:18765",
    tmwd_link_endpoint: "http://127.0.0.1:18766/link",
    cdp_endpoint: "http://127.0.0.1:9222",
    target_url_contains: "",
    require_cookie: false,
    allow_empty_tabs: false,
    doctor_only: false,
    force_live: false,
    ensure_tmwd_hub: true,
    ensure_tmwd_hub_wait_ms: 4_000,
    session_ready_wait_ms: 6_000,
    event_log_enabled: String(process.env.BROWSER_LIVE_GATE_LOG_ENABLED ?? "1").trim() !== "0",
    event_log_path: String(process.env.BROWSER_LIVE_GATE_LOG_PATH ?? DEFAULT_EVENT_LOG_PATH).trim() || DEFAULT_EVENT_LOG_PATH,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index] ?? "";
    if (token === "--timeout-ms") {
      const value = Number(argv[index + 1] ?? "");
      if (!Number.isFinite(value) || value <= 0) {
        throw new Error("invalid --timeout-ms value");
      }
      parsed.timeout_ms = Math.floor(value);
      index += 1;
      continue;
    }
    if (token === "--tmwd-mode") {
      parsed.tmwd_mode = normalizeTmwdMode(argv[index + 1]);
      index += 1;
      continue;
    }
    if (token === "--tmwd-transport") {
      const value = String(argv[index + 1] ?? "").trim().toLowerCase();
      if (value !== "auto" && value !== "ws" && value !== "link") {
        throw new Error("invalid --tmwd-transport value");
      }
      parsed.tmwd_transport = value;
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
    if (token === "--cdp-endpoint") {
      const value = String(argv[index + 1] ?? "").trim();
      if (!value) {
        throw new Error("invalid --cdp-endpoint value");
      }
      parsed.cdp_endpoint = value;
      index += 1;
      continue;
    }
    if (token === "--target-url-contains") {
      parsed.target_url_contains = String(argv[index + 1] ?? "").trim();
      index += 1;
      continue;
    }
    if (token === "--require-cookie") {
      parsed.require_cookie = true;
      continue;
    }
    if (token === "--allow-empty-tabs") {
      parsed.allow_empty_tabs = true;
      continue;
    }
    if (token === "--doctor-only") {
      parsed.doctor_only = true;
      continue;
    }
    if (token === "--json") {
      parsed.json = true;
      continue;
    }
    if (token === "--force-live") {
      parsed.force_live = true;
      continue;
    }
    if (token === "--no-ensure-tmwd-hub") {
      parsed.ensure_tmwd_hub = false;
      continue;
    }
    if (token === "--ensure-tmwd-hub-wait-ms") {
      const value = Number(argv[index + 1] ?? "");
      if (!Number.isFinite(value) || value <= 0) {
        throw new Error("invalid --ensure-tmwd-hub-wait-ms value");
      }
      parsed.ensure_tmwd_hub_wait_ms = Math.floor(value);
      index += 1;
      continue;
    }
    if (token === "--session-ready-wait-ms") {
      const value = Number(argv[index + 1] ?? "");
      if (!Number.isFinite(value) || value <= 0) {
        throw new Error("invalid --session-ready-wait-ms value");
      }
      parsed.session_ready_wait_ms = Math.floor(value);
      index += 1;
      continue;
    }
    if (token === "--disable-event-log") {
      parsed.event_log_enabled = false;
      continue;
    }
    if (token === "--event-log-path") {
      const value = String(argv[index + 1] ?? "").trim();
      if (!value) {
        throw new Error("invalid --event-log-path value");
      }
      parsed.event_log_path = value;
      index += 1;
      continue;
    }
    if (!token) {
      continue;
    }
    throw new Error(`unknown argument: ${token}`);
  }
  return parsed;
}

function buildCommonArgs(config) {
  return [
    "--timeout-ms", String(config.timeout_ms),
    "--tmwd-mode", config.tmwd_mode,
    "--tmwd-transport", config.tmwd_transport,
    "--tmwd-ws-endpoint", config.tmwd_ws_endpoint,
    "--tmwd-link-endpoint", config.tmwd_link_endpoint,
    "--cdp-endpoint", config.cdp_endpoint,
  ];
}

function buildDoctorArgs(config) {
  const args = [...buildCommonArgs(config)];
  if (config.allow_empty_tabs) {
    args.push("--allow-empty-tabs");
  }
  return args;
}

function buildLiveArgs(config) {
  const args = [...buildCommonArgs(config)];
  if (config.target_url_contains) {
    args.push("--target-url-contains", config.target_url_contains);
  }
  if (config.require_cookie) {
    args.push("--require-cookie");
  }
  return args;
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

function runNodeScript(scriptPath, args) {
  return spawnSync("node", [scriptPath, ...args], {
    cwd: repoRoot,
    env: process.env,
    encoding: "utf8",
  });
}

function appendGateEvent(config, payload) {
  if (config.event_log_enabled !== true) {
    return {
      enabled: false,
    };
  }
  const logPath = String(config.event_log_path ?? "").trim() || DEFAULT_EVENT_LOG_PATH;
  const record = {
    ts: new Date().toISOString(),
    mode: config.tmwd_mode,
    transport: config.tmwd_transport,
    payload,
  };
  try {
    mkdirSync(dirname(logPath), { recursive: true });
    appendFileSync(logPath, `${JSON.stringify(record)}\n`, "utf8");
    return {
      enabled: true,
      ok: true,
      path: logPath,
    };
  } catch (error) {
    return {
      enabled: true,
      ok: false,
      path: logPath,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

function emitAndReturn(config, payload) {
  const eventLog = appendGateEvent(config, payload);
  const output = {
    ...payload,
    event_log: eventLog,
  };
  process.stdout.write(`${JSON.stringify(output)}\n`);
  if (payload.ok !== true) {
    process.exitCode = 1;
  }
}

function doctorHints(config, doctorPayload) {
  const hints = [];
  if (isRemoteCdpMode(config.tmwd_mode)) {
    hints.push("Launch remote-debugging CDP Chrome: --remote-debugging-port=9222");
  } else {
    hints.push(
      "Run TMWD hub: npm run hub:start",
      "Install or enable the TMWD browser extension, then keep a Chrome/Edge tab open.",
    );
  }
  if (!isRemoteCdpMode(config.tmwd_mode) && shouldSuggestRemoteCdp(config, doctorPayload)) {
    hints.push("Optional remote-debugging CDP debug path: launch Chrome with --remote-debugging-port=9222");
  }
  hints.push(
    "Then retry gate: npm run check:live",
    `Current mode=${config.tmwd_mode} transport=${config.tmwd_transport}`,
  );
  if (config.ensure_tmwd_hub !== true) {
    hints.push("Gate auto-ensure is disabled: remove --no-ensure-tmwd-hub to allow auto-start.");
  }
  return hints;
}

function doctorSummary(payload) {
  if (!payload || typeof payload !== "object") {
    return {
      ok: false,
      readiness_reason: "invalid_payload",
      path: "none",
      tmwd_ws_tcp: false,
      tmwd_link_tcp: false,
      cdp_tcp: false,
      tmwd_ws_api_ok: false,
      tmwd_link_http_ok: false,
      cdp_http_ok: false,
      cdp_targets_ok: false,
    };
  }
  return {
    ok: payload.ok === true,
    readiness_reason: String(payload?.readiness?.reason ?? ""),
    path: String(payload?.readiness?.path ?? ""),
    tmwd_ws_tcp: payload?.checks?.tmwd_ws_tcp?.reachable === true,
    tmwd_link_tcp: payload?.checks?.tmwd_link_tcp?.reachable === true,
    cdp_tcp: payload?.checks?.cdp_tcp?.reachable === true,
    tmwd_ws_api_ok: payload?.checks?.tmwd_ws_api?.ok === true,
    tmwd_link_http_ok: payload?.checks?.tmwd_link_http?.ok === true,
    cdp_http_ok: payload?.checks?.cdp_http?.ok === true,
    cdp_targets_ok: payload?.checks?.cdp_targets?.ok === true,
  };
}

function runDoctorContract(config) {
  const result = runNodeScript(liveDoctorPath, buildDoctorArgs(config));
  if (result.error) {
    throw result.error;
  }
  const payload = parseLastJsonLine(result.stdout);
  if (!payload || typeof payload !== "object") {
    throw new Error(`live gate doctor returned invalid output: ${result.stdout}`);
  }
  return payload;
}

function shouldAttemptEnsureTmwdHub(config, doctorPayload) {
  if (config.ensure_tmwd_hub !== true) {
    return false;
  }
  if (isRemoteCdpMode(config.tmwd_mode)) {
    return false;
  }
  const wsReachable = doctorPayload?.checks?.tmwd_ws_tcp?.reachable === true;
  const linkReachable = doctorPayload?.checks?.tmwd_link_tcp?.reachable === true;
  if (config.tmwd_transport === "ws") {
    return !wsReachable;
  }
  if (config.tmwd_transport === "link") {
    return !linkReachable;
  }
  return !wsReachable && !linkReachable;
}

function sleep(ms) {
  return new Promise((resolvePromise) => {
    setTimeout(resolvePromise, ms);
  });
}

async function ensureTmwdHub(config, doctorPayloadBefore) {
  const ensureState = {
    attempted: true,
    enabled: config.ensure_tmwd_hub === true,
    wait_ms: config.ensure_tmwd_hub_wait_ms,
    control: null,
    doctor_before: doctorSummary(doctorPayloadBefore),
    doctor_after: null,
    reason: "",
  };

  const controlResult = runNodeScript(tmwdHubControlPath, [
    "start",
    "--json",
    "--wait-ms", String(config.ensure_tmwd_hub_wait_ms),
    "--tmwd-ws-endpoint", config.tmwd_ws_endpoint,
    "--tmwd-link-endpoint", config.tmwd_link_endpoint,
  ]);
  if (controlResult.error) {
    ensureState.reason = "control_exec_failed";
    ensureState.error = controlResult.error instanceof Error
      ? controlResult.error.message
      : String(controlResult.error);
    return {
      ensureState,
      doctorPayloadAfter: doctorPayloadBefore,
    };
  }
  const controlPayload = parseLastJsonLine(controlResult.stdout);
  if (!controlPayload || typeof controlPayload !== "object") {
    ensureState.reason = "control_invalid_output";
    ensureState.control = {
      exit_code: controlResult.status,
      stdout: String(controlResult.stdout ?? "").trim(),
      stderr: String(controlResult.stderr ?? "").trim(),
    };
    return {
      ensureState,
      doctorPayloadAfter: doctorPayloadBefore,
    };
  }
  ensureState.control = controlPayload;
  if (controlPayload?.ok !== true) {
    ensureState.reason = "tmwd_control_failed";
    return {
      ensureState,
      doctorPayloadAfter: doctorPayloadBefore,
    };
  }
  ensureState.reason = controlPayload?.started === true
    ? "tmwd_control_started"
    : "tmwd_control_existing";

  const doctorPayloadAfter = runDoctorContract(config);
  ensureState.doctor_after = doctorSummary(doctorPayloadAfter);
  return {
    ensureState,
    doctorPayloadAfter,
  };
}

function shouldWaitForSessionReady(config, doctorPayload) {
  if (config.allow_empty_tabs === true) {
    return false;
  }
  if (isRemoteCdpMode(config.tmwd_mode)) {
    return false;
  }
  const wsTcpReachable = doctorPayload?.checks?.tmwd_ws_tcp?.reachable === true;
  const linkTcpReachable = doctorPayload?.checks?.tmwd_link_tcp?.reachable === true;
  if (!wsTcpReachable && !linkTcpReachable) {
    return false;
  }
  const wsTabCount = Number(doctorPayload?.checks?.tmwd_ws_api?.tab_count ?? 0);
  const linkSessionCount = Number(doctorPayload?.checks?.tmwd_link_http?.session_count ?? 0);
  if (Number.isFinite(wsTabCount) && wsTabCount > 0) {
    return false;
  }
  if (Number.isFinite(linkSessionCount) && linkSessionCount > 0) {
    return false;
  }
  const wsApiOk = doctorPayload?.checks?.tmwd_ws_api?.ok === true;
  const linkApiOk = doctorPayload?.checks?.tmwd_link_http?.ok === true;
  return wsApiOk || linkApiOk;
}

async function waitForSessionReady(config, doctorPayloadBefore) {
  const waitState = {
    attempted: true,
    wait_ms: config.session_ready_wait_ms,
    reason: "",
    doctor_before: doctorSummary(doctorPayloadBefore),
    doctor_after: null,
  };

  const deadline = Date.now() + config.session_ready_wait_ms;
  let lastDoctorPayload = doctorPayloadBefore;
  while (Date.now() < deadline) {
    await sleep(500);
    lastDoctorPayload = runDoctorContract(config);
    if (lastDoctorPayload.ok === true) {
      waitState.reason = "session_ready";
      waitState.doctor_after = doctorSummary(lastDoctorPayload);
      return {
        waitState,
        doctorPayloadAfter: lastDoctorPayload,
      };
    }
    if (!shouldWaitForSessionReady(config, lastDoctorPayload)) {
      waitState.reason = "session_wait_not_applicable";
      waitState.doctor_after = doctorSummary(lastDoctorPayload);
      return {
        waitState,
        doctorPayloadAfter: lastDoctorPayload,
      };
    }
  }

  waitState.reason = "session_not_ready_timeout";
  waitState.doctor_after = doctorSummary(lastDoctorPayload);
  return {
    waitState,
    doctorPayloadAfter: lastDoctorPayload,
  };
}

async function run() {
  const config = parseArgs(process.argv.slice(2));

  let doctorPayload = runDoctorContract(config);
  let ensureTmwdHubState = {
    attempted: false,
    enabled: config.ensure_tmwd_hub === true,
    reason: "not_needed",
  };
  let sessionReadyWaitState = {
    attempted: false,
    wait_ms: config.session_ready_wait_ms,
    reason: "not_needed",
  };

  if (doctorPayload.ok !== true && shouldAttemptEnsureTmwdHub(config, doctorPayload)) {
    const ensured = await ensureTmwdHub(config, doctorPayload);
    ensureTmwdHubState = ensured.ensureState;
    doctorPayload = ensured.doctorPayloadAfter;
  }
  if (doctorPayload.ok !== true && shouldWaitForSessionReady(config, doctorPayload)) {
    const waited = await waitForSessionReady(config, doctorPayload);
    sessionReadyWaitState = waited.waitState;
    doctorPayload = waited.doctorPayloadAfter;
  }

  if (config.doctor_only) {
    emitAndReturn(config, {
      ok: doctorPayload.ok === true,
      stage: "doctor_only",
      doctor: doctorPayload,
      ensure_tmwd_hub: ensureTmwdHubState,
      session_wait: sessionReadyWaitState,
    });
    return;
  }

  if (doctorPayload.ok !== true && !config.force_live) {
    emitAndReturn(config, {
      ok: false,
      stage: "doctor_blocked",
      doctor: doctorPayload,
      ensure_tmwd_hub: ensureTmwdHubState,
      session_wait: sessionReadyWaitState,
      hints: doctorHints(config, doctorPayload),
    });
    return;
  }

  const liveResult = runNodeScript(liveContractPath, buildLiveArgs(config));
  if (liveResult.error) {
    throw liveResult.error;
  }
  const livePayload = parseLastJsonLine(liveResult.stdout);
  const liveOk = liveResult.status === 0 && livePayload && typeof livePayload === "object" && livePayload.ok === true;

  if (!liveOk) {
    emitAndReturn(config, {
      ok: false,
      stage: "live_failed",
      doctor: doctorPayload,
      ensure_tmwd_hub: ensureTmwdHubState,
      session_wait: sessionReadyWaitState,
      live_exit_code: liveResult.status,
      live_payload: livePayload,
      live_stdout: String(liveResult.stdout ?? "").trim(),
      live_stderr: String(liveResult.stderr ?? "").trim(),
      hints: doctorHints(config, doctorPayload),
    });
    return;
  }

  emitAndReturn(config, {
    ok: true,
    stage: "live_passed",
    doctor: doctorPayload,
    ensure_tmwd_hub: ensureTmwdHubState,
    session_wait: sessionReadyWaitState,
    live: livePayload,
  });
}

try {
  await run();
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`browser-structured-mcp-live-gate failed: ${message}\n`);
  process.exitCode = 1;
}
