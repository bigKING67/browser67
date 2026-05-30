#!/usr/bin/env node
import { Socket } from "node:net";
import WebSocket from "ws";

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

function parseArgs(argv) {
  const parsed = {
    timeout_ms: 1_500,
    tmwd_mode: "auto",
    tmwd_transport: "auto",
    tmwd_ws_endpoint: "ws://127.0.0.1:18765",
    tmwd_link_endpoint: "http://127.0.0.1:18766/link",
    cdp_endpoint: "http://127.0.0.1:9222",
    allow_empty_tabs: false,
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
    if (token === "--allow-empty-tabs") {
      parsed.allow_empty_tabs = true;
      continue;
    }
    if (token === "--json") {
      parsed.json = true;
      continue;
    }
    if (!token) {
      continue;
    }
    throw new Error(`unknown argument: ${token}`);
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
    if (protocol === "https" || protocol === "wss") {
      port = 443;
    } else {
      port = 80;
    }
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
    socket.once("error", (error) => {
      finish(false, String(error?.code ?? error?.message ?? "socket_error"));
    });
    socket.connect(parsed.port, parsed.host);
  });
}

async function probeCdpHttp(cdpEndpoint, timeoutMs) {
  const base = String(cdpEndpoint ?? "").replace(/\/$/, "");
  const startedAt = Date.now();
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const response = await fetch(`${base}/json/version`, {
      method: "GET",
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
    return {
      endpoint: `${base}/json/version`,
      ok: response.ok,
      status: response.status,
      latency_ms: Date.now() - startedAt,
      browser: typeof parsed?.Browser === "string" ? parsed.Browser : undefined,
      websocket_debugger_url: typeof parsed?.webSocketDebuggerUrl === "string"
        ? parsed.webSocketDebuggerUrl
        : undefined,
      detail: response.ok ? "http_ok" : `http_${String(response.status)}`,
    };
  } catch (error) {
    return {
      endpoint: `${base}/json/version`,
      ok: false,
      status: null,
      latency_ms: Date.now() - startedAt,
      detail: String(error?.name === "AbortError" ? "timeout" : (error?.message ?? error)),
    };
  }
}

async function probeCdpTargets(cdpEndpoint, timeoutMs) {
  const base = String(cdpEndpoint ?? "").replace(/\/$/, "");
  const startedAt = Date.now();
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const response = await fetch(`${base}/json/list`, {
      method: "GET",
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
    const rows = Array.isArray(parsed) ? parsed : [];
    const pageCount = rows.filter((item) => item?.type === "page").length;
    return {
      endpoint: `${base}/json/list`,
      ok: response.ok && Array.isArray(parsed),
      status: response.status,
      latency_ms: Date.now() - startedAt,
      page_count: pageCount,
      detail: response.ok
        ? (Array.isArray(parsed) ? "http_ok_with_list" : "http_ok_invalid_json")
        : `http_${String(response.status)}`,
    };
  } catch (error) {
    return {
      endpoint: `${base}/json/list`,
      ok: false,
      status: null,
      latency_ms: Date.now() - startedAt,
      page_count: 0,
      detail: String(error?.name === "AbortError" ? "timeout" : (error?.message ?? error)),
    };
  }
}

async function probeTmwdLinkHttp(tmwdLinkEndpoint, timeoutMs) {
  const endpoint = String(tmwdLinkEndpoint ?? "").trim();
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
      detail: String(error?.name === "AbortError" ? "timeout" : (error?.message ?? error)),
    };
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

function evaluateModeReadiness(cli, checks) {
  const allowEmpty = cli.allow_empty_tabs === true;
  const wsReady = checks.tmwd_ws_api.ok === true
    && (allowEmpty || Number(checks.tmwd_ws_api.tab_count ?? 0) > 0);
  const linkReady = checks.tmwd_link_http.ok === true
    && (allowEmpty || Number(checks.tmwd_link_http.session_count ?? 0) > 0);
  const cdpReady = checks.cdp_http.ok === true
    && checks.cdp_targets.ok === true
    && (allowEmpty || Number(checks.cdp_targets.page_count ?? 0) > 0);
  const tmwdReady = cli.tmwd_transport === "ws"
    ? wsReady
    : (cli.tmwd_transport === "link" ? linkReady : (wsReady || linkReady));
  if (cli.tmwd_mode === "tmwd") {
    return {
      ready: tmwdReady,
      reason: tmwdReady
        ? "tmwd_transport_ready"
        : (cli.tmwd_transport === "ws" ? "tmwd_ws_unavailable" : (cli.tmwd_transport === "link" ? "tmwd_link_unavailable" : "tmwd_no_route")),
      path: cli.tmwd_transport === "auto"
        ? (wsReady ? "tmwd_ws" : (linkReady ? "tmwd_link" : "none"))
        : `tmwd_${cli.tmwd_transport}`,
    };
  }
  if (isRemoteCdpMode(cli.tmwd_mode)) {
    return {
      ready: cdpReady,
      reason: cdpReady ? "cdp_ready" : "cdp_unavailable",
      path: "cdp",
    };
  }
  return {
    ready: tmwdReady || cdpReady,
    reason: tmwdReady || cdpReady ? "auto_has_route" : "auto_no_route",
    path: tmwdReady ? (wsReady ? "tmwd_ws" : "tmwd_link") : (cdpReady ? "cdp" : "none"),
  };
}

async function run() {
  const cli = parseArgs(process.argv.slice(2));
  const checks = {
    tmwd_ws_tcp: await probeTcp(cli.tmwd_ws_endpoint, cli.timeout_ms),
    tmwd_link_tcp: await probeTcp(cli.tmwd_link_endpoint, cli.timeout_ms),
    cdp_tcp: await probeTcp(cli.cdp_endpoint, cli.timeout_ms),
  };
  checks.tmwd_link_http = checks.tmwd_link_tcp.reachable
    ? await probeTmwdLinkHttp(cli.tmwd_link_endpoint, cli.timeout_ms)
    : {
      endpoint: cli.tmwd_link_endpoint,
      ok: false,
      status: null,
      latency_ms: 0,
      session_count: 0,
      detail: "skipped_tcp_unreachable",
    };
  checks.tmwd_ws_api = checks.tmwd_ws_tcp.reachable
    ? await probeTmwdWsApi(cli.tmwd_ws_endpoint, cli.timeout_ms)
    : {
      endpoint: cli.tmwd_ws_endpoint,
      ok: false,
      latency_ms: 0,
      tab_count: 0,
      detail: "skipped_tcp_unreachable",
    };
  checks.cdp_http = checks.cdp_tcp.reachable
    ? await probeCdpHttp(cli.cdp_endpoint, cli.timeout_ms)
    : {
      endpoint: `${String(cli.cdp_endpoint).replace(/\/$/, "")}/json/version`,
      ok: false,
      status: null,
      latency_ms: 0,
      detail: "skipped_tcp_unreachable",
    };
  checks.cdp_targets = checks.cdp_tcp.reachable
    ? await probeCdpTargets(cli.cdp_endpoint, cli.timeout_ms)
    : {
      endpoint: `${String(cli.cdp_endpoint).replace(/\/$/, "")}/json/list`,
      ok: false,
      status: null,
      latency_ms: 0,
      page_count: 0,
      detail: "skipped_tcp_unreachable",
    };

  const readiness = evaluateModeReadiness(cli, checks);
  const result = {
    ok: readiness.ready,
    mode: cli.tmwd_mode,
    transport: cli.tmwd_transport,
    allow_empty_tabs: cli.allow_empty_tabs,
    readiness,
    checks,
    suggestions: [
      "For TMWD path, run: npm run hub:start",
      "For remote-debugging CDP path, launch Chrome with --remote-debugging-port=9222",
      "Use --allow-empty-tabs when checking connectivity only (without active tabs/sessions).",
      "Then run live contract: npm run check:live",
    ],
  };

  process.stdout.write(`${JSON.stringify(result)}\n`);
  if (!readiness.ready) {
    process.exitCode = 1;
  }
}

try {
  await run();
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`browser-structured-mcp-live-doctor failed: ${message}\n`);
  process.exitCode = 1;
}
