function tcpCheck(endpoint, reachable) {
  return {
    endpoint,
    host: "127.0.0.1",
    port: Number(new URL(endpoint).port || 80),
    reachable,
    latency_ms: reachable ? 1 : 0,
    detail: reachable ? "connect_ok" : "ECONNREFUSED",
  };
}

function unavailableApiCheck(endpoint) {
  return {
    endpoint,
    ok: false,
    status: null,
    latency_ms: 0,
    detail: "skipped_tcp_unreachable",
  };
}

const remoteDebuggingSuggestion = "For remote-debugging CDP path, launch Chrome with --remote-debugging-port=9222";

function doctorSuggestions({ ok, mode, path }) {
  const tmwdReady = ok === true && (path === "tmwd_ws" || path === "tmwd_link");
  const cdpReady = ok === true && path === "cdp";
  if (mode === "remote_cdp" || mode === "cdp") {
    return [remoteDebuggingSuggestion];
  }
  const suggestions = [
    "For TMWD path, run: npm run hub:start",
    "Install or enable the TMWD browser extension, then keep a Chrome/Edge tab open.",
  ];
  if (mode === "auto" && !tmwdReady && !cdpReady) {
    suggestions.push(remoteDebuggingSuggestion);
  }
  return suggestions;
}

function buildDoctorPayload({ ok, mode = "auto", path = "tmwd_ws", reason = "auto_has_route" }) {
  const tmwdReachable = path === "tmwd_ws" || path === "tmwd_link";
  return {
    ok,
    stage: "doctor_only",
    doctor: {
      ok,
      mode,
      transport: "auto",
      allow_empty_tabs: false,
      readiness: {
        ready: ok,
        reason,
        path,
      },
      checks: {
        tmwd_ws_tcp: tcpCheck("ws://127.0.0.1:18765/", tmwdReachable),
        tmwd_link_tcp: tcpCheck("http://127.0.0.1:18766/link", tmwdReachable),
        cdp_tcp: tcpCheck("http://127.0.0.1:9222/", false),
        tmwd_ws_api: {
          endpoint: "ws://127.0.0.1:18765",
          ok: tmwdReachable,
          latency_ms: tmwdReachable ? 3 : 0,
          tab_count: tmwdReachable ? 1 : 0,
          detail: tmwdReachable ? "ws_tabs_ok" : "skipped_tcp_unreachable",
        },
        tmwd_link_http: {
          endpoint: "http://127.0.0.1:18766/link",
          ok: tmwdReachable,
          status: tmwdReachable ? 200 : null,
          latency_ms: tmwdReachable ? 3 : 0,
          session_count: tmwdReachable ? 1 : 0,
          detail: tmwdReachable ? "http_ok_with_r" : "skipped_tcp_unreachable",
        },
        cdp_http: unavailableApiCheck("http://127.0.0.1:9222/json/version"),
        cdp_targets: {
          ...unavailableApiCheck("http://127.0.0.1:9222/json/list"),
          page_count: 0,
        },
      },
      suggestions: doctorSuggestions({ ok, mode, path }),
    },
    ensure_tmwd_hub: {
      attempted: false,
      enabled: true,
      reason: "not_needed",
    },
    session_wait: {
      attempted: false,
      wait_ms: 6000,
      reason: "not_needed",
    },
    event_log: {
      enabled: false,
    },
  };
}

export {
  buildDoctorPayload,
  remoteDebuggingSuggestion,
};
