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

async function probeTmwdWsApi(tmwdWsEndpoint, timeoutMs) {
  const endpoint = String(tmwdWsEndpoint ?? "").trim();
  const startedAt = Date.now();
  return await new Promise((resolvePromise) => {
    const ws = new WebSocket(endpoint);
    let settled = false;
    const requestId = `live_doctor_${String(Date.now())}`;
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
        tab_count: 0,
        detail: "ws_timeout",
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
        code: {
          cmd: "tabs",
        },
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
          tab_count: 0,
          detail: "ws_invalid_json",
        });
        return;
      }
      if (String(parsed?.id ?? "") !== requestId) {
        return;
      }
      const success = parsed?.success === true;
      const tabs = Array.isArray(parsed?.result) ? parsed.result : [];
      settle({
        endpoint,
        ok: success,
        latency_ms: Date.now() - startedAt,
        tab_count: tabs.length,
        detail: success
          ? "ws_tabs_ok"
          : String(parsed?.error ?? "ws_tabs_failed"),
      });
    });

    ws.once("error", (error) => {
      settle({
        endpoint,
        ok: false,
        latency_ms: Date.now() - startedAt,
        tab_count: 0,
        detail: String(error?.message ?? error),
      });
    });

    ws.once("close", () => {
      settle({
        endpoint,
        ok: false,
        latency_ms: Date.now() - startedAt,
        tab_count: 0,
        detail: "ws_closed",
      });
    });
  });
}

export {
  probeTmwdLinkHttp,
  probeTmwdWsApi,
};
