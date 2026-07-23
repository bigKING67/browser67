import { buildDoctorArgs } from "./args.mjs";
import {
  parseLastJsonLine,
  runNodeScript,
  sleep,
} from "./child-process.mjs";
import {
  isRemoteCdpMode,
  shouldSuggestRemoteCdp,
} from "./modes.mjs";
import {
  liveDoctorPath,
  tmwdHubControlPath,
} from "./paths.mjs";

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
      tmwd_ws_runtime_ok: false,
      tmwd_link_runtime_ok: false,
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
    tmwd_ws_runtime_ok: payload?.checks?.tmwd_ws_runtime?.ok === true,
    tmwd_link_runtime_ok: payload?.checks?.tmwd_link_runtime?.ok === true,
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
  const poll = async (lastDoctorPayload) => {
    if (Date.now() >= deadline) {
      waitState.reason = "session_not_ready_timeout";
      waitState.doctor_after = doctorSummary(lastDoctorPayload);
      return {
        waitState,
        doctorPayloadAfter: lastDoctorPayload,
      };
    }
    await sleep(500);
    const currentDoctorPayload = runDoctorContract(config);
    if (currentDoctorPayload.ok === true) {
      waitState.reason = "session_ready";
      waitState.doctor_after = doctorSummary(currentDoctorPayload);
      return {
        waitState,
        doctorPayloadAfter: currentDoctorPayload,
      };
    }
    if (!shouldWaitForSessionReady(config, currentDoctorPayload)) {
      waitState.reason = "session_wait_not_applicable";
      waitState.doctor_after = doctorSummary(currentDoctorPayload);
      return {
        waitState,
        doctorPayloadAfter: currentDoctorPayload,
      };
    }
    return poll(currentDoctorPayload);
  };
  return poll(doctorPayloadBefore);
}

export {
  doctorHints,
  doctorSummary,
  ensureTmwdHub,
  runDoctorContract,
  shouldAttemptEnsureTmwdHub,
  shouldWaitForSessionReady,
  waitForSessionReady,
};
