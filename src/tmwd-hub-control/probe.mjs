import { Socket } from "node:net";

import { parseEndpoint } from "./endpoints.mjs";

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
  let timer = null;
  try {
    const controller = new AbortController();
    timer = setTimeout(() => controller.abort(), timeoutMs);
    const response = await fetch(endpoint, { method: "GET", signal: controller.signal });
    clearTimeout(timer);
    timer = null;
    return {
      endpoint,
      ok: response.ok,
      status: response.status,
      latency_ms: Date.now() - startedAt,
      detail: response.ok ? "http_ok" : `http_${String(response.status)}`,
    };
  } catch (error) {
    if (timer) {
      clearTimeout(timer);
    }
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
  let timer = null;
  try {
    const controller = new AbortController();
    timer = setTimeout(() => controller.abort(), timeoutMs);
    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({ cmd: "get_all_sessions" }),
      signal: controller.signal,
    });
    clearTimeout(timer);
    timer = null;
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
    if (timer) {
      clearTimeout(timer);
    }
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

export {
  probeLinkCommand,
  probeLinkHttp,
  probeTcp,
};
