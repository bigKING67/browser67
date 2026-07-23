import WebSocket from "ws";

function abortableFetchTimeout(timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  return {
    controller,
    clear: () => clearTimeout(timer),
  };
}

function errorDetail(error) {
  return String(error?.name === "AbortError" ? "timeout" : (error?.message ?? error));
}

async function probeTmwdLinkHttp(tmwdLinkEndpoint, timeoutMs) {
  const endpoint = String(tmwdLinkEndpoint ?? "").trim();
  const startedAt = Date.now();
  const timeout = abortableFetchTimeout(timeoutMs);
  try {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({ cmd: "get_all_sessions" }),
      signal: timeout.controller.signal,
    });
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
      detail: response.ok
        ? (hasR ? "http_ok_with_r" : "http_ok_without_r")
        : `http_${String(response.status)}`,
    };
  } catch (error) {
    return {
      endpoint,
      ok: false,
      status: null,
      latency_ms: Date.now() - startedAt,
      session_count: 0,
      detail: errorDetail(error),
    };
  } finally {
    timeout.clear();
  }
}

async function probeTmwdLinkRuntimeInfo(tmwdLinkEndpoint, timeoutMs) {
  const endpoint = String(tmwdLinkEndpoint ?? "").trim();
  const startedAt = Date.now();
  const timeout = abortableFetchTimeout(timeoutMs);
  try {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ cmd: "get_runtime_info" }),
      signal: timeout.controller.signal,
    });
    const text = await response.text();
    let parsed;
    try {
      parsed = JSON.parse(text);
    } catch {
      parsed = null;
    }
    const runtimeInfo = parsed?.r && typeof parsed.r === "object" ? parsed.r : null;
    return {
      endpoint,
      ok: response.ok && runtimeInfo !== null,
      status: response.status,
      latency_ms: Date.now() - startedAt,
      runtime_info: runtimeInfo,
      detail: response.ok
        ? (runtimeInfo ? "http_runtime_info_ok" : "http_runtime_info_missing")
        : `http_${String(response.status)}`,
    };
  } catch (error) {
    return {
      endpoint,
      ok: false,
      status: null,
      latency_ms: Date.now() - startedAt,
      runtime_info: null,
      detail: errorDetail(error),
    };
  } finally {
    timeout.clear();
  }
}

async function requestTmwdWs(tmwdWsEndpoint, timeoutMs, command, requestPrefix) {
  const endpoint = String(tmwdWsEndpoint ?? "").trim();
  const startedAt = Date.now();
  return await new Promise((resolvePromise) => {
    const ws = new WebSocket(endpoint);
    let settled = false;
    const requestId = `${requestPrefix}_${String(Date.now())}`;
    const timer = setTimeout(() => {
      if (settled) {
        return;
      }
      settled = true;
      try {
        ws.terminate();
      } catch {
        // ignore
      }
      resolvePromise({
        endpoint,
        ok: false,
        latency_ms: Date.now() - startedAt,
        detail: "ws_timeout",
        response: null,
      });
    }, timeoutMs);

    const settle = (payload) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      try {
        ws.close();
      } catch {
        // ignore
      }
      resolvePromise(payload);
    };

    ws.once("open", () => {
      ws.send(JSON.stringify({
        id: requestId,
        code: command,
      }));
    });

    ws.on("message", (raw) => {
      let parsed;
      try {
        parsed = JSON.parse(String(raw));
      } catch {
        settle({
          endpoint,
          ok: false,
          latency_ms: Date.now() - startedAt,
          detail: "ws_invalid_json",
          response: null,
        });
        return;
      }
      if (String(parsed?.id ?? "") !== requestId) {
        return;
      }
      const success = parsed?.success === true || parsed?.type === "result";
      settle({
        endpoint,
        ok: success,
        latency_ms: Date.now() - startedAt,
        detail: success
          ? "ws_request_ok"
          : String(parsed?.error ?? "ws_request_failed"),
        response: parsed,
      });
    });

    ws.once("error", (error) => {
      settle({
        endpoint,
        ok: false,
        latency_ms: Date.now() - startedAt,
        detail: String(error?.message ?? error),
        response: null,
      });
    });

    ws.once("close", () => {
      settle({
        endpoint,
        ok: false,
        latency_ms: Date.now() - startedAt,
        detail: "ws_closed",
        response: null,
      });
    });
  });
}

async function probeTmwdWsApi(tmwdWsEndpoint, timeoutMs) {
  const probe = await requestTmwdWs(
    tmwdWsEndpoint,
    timeoutMs,
    { cmd: "tabs" },
    "live_doctor_tabs",
  );
  const tabs = Array.isArray(probe.response?.result) ? probe.response.result : [];
  return {
    endpoint: probe.endpoint,
    ok: probe.ok,
    latency_ms: probe.latency_ms,
    tab_count: tabs.length,
    detail: probe.ok ? "ws_tabs_ok" : probe.detail,
  };
}

async function probeTmwdWsRuntimeInfo(tmwdWsEndpoint, timeoutMs) {
  const probe = await requestTmwdWs(
    tmwdWsEndpoint,
    timeoutMs,
    { cmd: "browser67_runtime_info" },
    "live_doctor_runtime",
  );
  const runtimeInfo = probe.response?.result && typeof probe.response.result === "object"
    ? probe.response.result
    : null;
  return {
    endpoint: probe.endpoint,
    ok: probe.ok && runtimeInfo !== null,
    latency_ms: probe.latency_ms,
    runtime_info: runtimeInfo,
    detail: probe.ok
      ? (runtimeInfo ? "ws_runtime_info_ok" : "ws_runtime_info_missing")
      : probe.detail,
  };
}

export {
  probeTmwdLinkHttp,
  probeTmwdLinkRuntimeInfo,
  probeTmwdWsApi,
  probeTmwdWsRuntimeInfo,
};
