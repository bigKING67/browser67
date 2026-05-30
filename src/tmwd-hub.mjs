#!/usr/bin/env node

import { createServer } from "node:http";
import { randomUUID } from "node:crypto";
import { WebSocketServer, WebSocket } from "ws";

const DEFAULT_HOST = "127.0.0.1";
const DEFAULT_WS_PORT = 18765;
const DEFAULT_LINK_PORT = 18766;
const DEFAULT_REQUEST_TIMEOUT_MS = 20_000;
const DEFAULT_SESSION_TTL_MS = 10 * 60 * 1000;

const host = String(process.env.TMWD_HUB_HOST ?? DEFAULT_HOST).trim() || DEFAULT_HOST;
const wsPort = normalizePort(process.env.TMWD_HUB_WS_PORT, DEFAULT_WS_PORT);
const linkPort = normalizePort(process.env.TMWD_HUB_LINK_PORT, DEFAULT_LINK_PORT);
const requestTimeoutMs = normalizePositiveInt(process.env.TMWD_HUB_REQUEST_TIMEOUT_MS, DEFAULT_REQUEST_TIMEOUT_MS);
const sessionTtlMs = normalizePositiveInt(process.env.TMWD_HUB_SESSION_TTL_MS, DEFAULT_SESSION_TTL_MS);

let defaultSessionId = "";
let latestSessionId = "";

const sessions = new Map();
const pendingExec = new Map();
const clientSockets = new Set();
let extensionSocket = null;

function nowMs() {
  return Date.now();
}

function nowIso() {
  return new Date().toISOString();
}

function normalizePort(raw, fallback) {
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }
  const value = Math.floor(parsed);
  if (value < 1 || value > 65535) {
    return fallback;
  }
  return value;
}

function normalizePositiveInt(raw, fallback) {
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }
  const value = Math.floor(parsed);
  if (value <= 0) {
    return fallback;
  }
  return value;
}

function normalizeSessionId(raw) {
  return String(raw ?? "").trim();
}

function normalizeTab(tab) {
  if (!tab || typeof tab !== "object") {
    return null;
  }
  const id = normalizeSessionId(tab.id ?? tab.tabId ?? tab.sessionId);
  if (!id) {
    return null;
  }
  return {
    id,
    url: String(tab.url ?? ""),
    title: String(tab.title ?? ""),
    type: "ext_ws",
    connected_at: nowIso(),
    disconnect_at: null,
    active: true,
  };
}

function isSessionActive(sessionId) {
  const session = sessions.get(sessionId);
  return Boolean(session && session.disconnect_at === null);
}

function markSessionDisconnected(sessionId) {
  const session = sessions.get(sessionId);
  if (!session || session.disconnect_at !== null) {
    return;
  }
  session.active = false;
  session.disconnect_at = nowIso();
}

function markAllExtensionSessionsDisconnected() {
  for (const session of sessions.values()) {
    if (session.type === "ext_ws") {
      markSessionDisconnected(session.id);
    }
  }
}

function cleanupInactiveSessions() {
  const deadline = nowMs() - sessionTtlMs;
  for (const [id, session] of sessions.entries()) {
    if (session.disconnect_at === null) {
      continue;
    }
    const disconnectAt = Date.parse(session.disconnect_at);
    if (!Number.isFinite(disconnectAt) || disconnectAt < deadline) {
      sessions.delete(id);
    }
  }
  if (defaultSessionId && !isSessionActive(defaultSessionId)) {
    defaultSessionId = "";
  }
  if (latestSessionId && !sessions.has(latestSessionId)) {
    latestSessionId = "";
  }
}

function registerTabs(tabs) {
  const normalizedTabs = Array.isArray(tabs)
    ? tabs.map((tab) => normalizeTab(tab)).filter((tab) => tab !== null)
    : [];
  const activeSet = new Set(normalizedTabs.map((tab) => tab.id));

  for (const [id, session] of sessions.entries()) {
    if (session.type === "ext_ws" && session.disconnect_at === null && !activeSet.has(id)) {
      markSessionDisconnected(id);
    }
  }

  for (const tab of normalizedTabs) {
    const existing = sessions.get(tab.id);
    if (existing) {
      existing.url = tab.url;
      existing.title = tab.title;
      existing.type = "ext_ws";
      existing.connected_at = tab.connected_at;
      existing.disconnect_at = null;
      existing.active = true;
    } else {
      sessions.set(tab.id, tab);
    }
    latestSessionId = tab.id;
    if (!defaultSessionId) {
      defaultSessionId = tab.id;
    }
  }

  cleanupInactiveSessions();
}

function listActiveSessions() {
  cleanupInactiveSessions();
  return Array.from(sessions.values())
    .filter((session) => session.disconnect_at === null)
    .map((session) => ({
      id: session.id,
      url: session.url,
      title: session.title,
      type: session.type,
      connected_at: session.connected_at,
    }));
}

function pickSession(sessionId) {
  cleanupInactiveSessions();
  const requestedId = normalizeSessionId(sessionId);
  if (requestedId && isSessionActive(requestedId)) {
    return sessions.get(requestedId);
  }
  if (defaultSessionId && isSessionActive(defaultSessionId)) {
    return sessions.get(defaultSessionId);
  }
  const first = Array.from(sessions.values()).find((session) => session.disconnect_at === null);
  if (first) {
    defaultSessionId = first.id;
  }
  return first ?? null;
}

function findSessions(urlPattern) {
  cleanupInactiveSessions();
  const pattern = String(urlPattern ?? "");
  if (!pattern) {
    if (latestSessionId && sessions.has(latestSessionId)) {
      const latest = sessions.get(latestSessionId);
      if (latest && latest.disconnect_at === null) {
        return [[latest.id, {
          url: latest.url,
          title: latest.title,
          type: latest.type,
          connected_at: latest.connected_at,
        }]];
      }
    }
    return [];
  }
  const matches = [];
  for (const session of sessions.values()) {
    if (session.disconnect_at !== null) {
      continue;
    }
    if (session.url.includes(pattern) || session.title.includes(pattern)) {
      matches.push([
        session.id,
        {
          url: session.url,
          title: session.title,
          type: session.type,
          connected_at: session.connected_at,
        },
      ]);
    }
  }
  return matches;
}

function toSerializableError(error) {
  if (!error) {
    return { name: "Error", message: "unknown error", stack: "" };
  }
  if (typeof error === "string") {
    return { name: "Error", message: error, stack: "" };
  }
  const name = String(error.name ?? "Error");
  const message = String(error.message ?? error.toString?.() ?? "unknown error");
  const stack = typeof error.stack === "string" ? error.stack : "";
  return { name, message, stack };
}

function isSocketOpen(socket) {
  return Boolean(socket && socket.readyState === WebSocket.OPEN);
}

function ensureExtensionSocketReady() {
  if (!isSocketOpen(extensionSocket)) {
    throw new Error("tmwd hub has no active extension websocket connection");
  }
}

function clearPendingExec(reason) {
  for (const [id, pending] of pendingExec.entries()) {
    clearTimeout(pending.timer);
    pendingExec.delete(id);
    pending.reject(new Error(reason));
  }
}

function clearPendingByControllerSocket(socket, reason) {
  for (const [id, pending] of pendingExec.entries()) {
    if (pending.replySocket !== socket) {
      continue;
    }
    clearTimeout(pending.timer);
    pendingExec.delete(id);
    pending.reject(new Error(reason));
  }
}

function sendWsPayload(socket, payload) {
  if (!isSocketOpen(socket)) {
    return;
  }
  socket.send(JSON.stringify(payload));
}

function relayExecToExtension({ sessionId, code, timeoutMs, replySocket = null, replyId = "" }) {
  ensureExtensionSocketReady();
  const tabId = Number(sessionId);
  if (!Number.isFinite(tabId)) {
    throw new Error(`invalid numeric tab/session id: ${String(sessionId)}`);
  }

  const relayId = `hub_${randomUUID()}`;
  const clampedTimeoutMs = Math.max(500, Math.min(120_000, timeoutMs));

  const promise = new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      pendingExec.delete(relayId);
      reject(new Error(`tmwd hub exec timeout id=${relayId}`));
    }, clampedTimeoutMs);

    pendingExec.set(relayId, {
      timer,
      resolve,
      reject,
      replySocket,
      replyId,
    });
  });

  try {
    extensionSocket.send(JSON.stringify({
      id: relayId,
      tabId,
      code,
    }));
  } catch (error) {
    const pending = pendingExec.get(relayId);
    if (pending) {
      clearTimeout(pending.timer);
      pendingExec.delete(relayId);
      pending.reject(error instanceof Error ? error : new Error(String(error)));
    }
  }

  return promise;
}

function settlePendingFromExtension(message) {
  const relayId = String(message.id ?? "").trim();
  if (!relayId) {
    return;
  }
  const pending = pendingExec.get(relayId);
  if (!pending) {
    return;
  }

  const type = String(message.type ?? "").trim();
  if (type === "ack") {
    return;
  }

  pendingExec.delete(relayId);
  clearTimeout(pending.timer);

  const payload = {
    ok: type === "result",
    result: message.result,
    error: message.error,
    newTabs: Array.isArray(message.newTabs) ? message.newTabs : [],
  };

  if (pending.replySocket) {
    sendWsPayload(pending.replySocket, {
      type: payload.ok ? "result" : "error",
      id: pending.replyId || relayId,
      result: payload.result,
      error: payload.error,
      newTabs: payload.newTabs,
    });
  }

  pending.resolve(payload);
}

function handleControllerRequest(socket, message) {
  const requestId = String(message.id ?? "").trim();
  if (!requestId) {
    return;
  }
  const code = message?.code;
  const bridgeCmd = code && typeof code === "object"
    ? String(code.cmd ?? "").trim()
    : "";
  if (bridgeCmd === "tabs") {
    const tabs = listActiveSessions().map((session) => ({
      id: session.id,
      url: session.url,
      title: session.title,
    }));
    sendWsPayload(socket, {
      id: requestId,
      success: true,
      result: tabs,
    });
    return;
  }
  const tabId = Number(message.tabId ?? "");
  if (!Number.isFinite(tabId)) {
    sendWsPayload(socket, {
      type: "error",
      id: requestId,
      error: "invalid or missing numeric tabId",
    });
    return;
  }

  relayExecToExtension({
    sessionId: tabId,
    code: message.code,
    timeoutMs: requestTimeoutMs,
    replySocket: socket,
    replyId: requestId,
  }).catch((error) => {
    sendWsPayload(socket, {
      type: "error",
      id: requestId,
      error: toSerializableError(error).message,
    });
  });
}

function handleSocketMessage(socket, raw) {
  let message;
  try {
    message = JSON.parse(String(raw));
  } catch {
    return;
  }
  if (!message || typeof message !== "object") {
    return;
  }

  const type = String(message.type ?? "").trim();
  if (type === "ext_ready" || type === "tabs_update") {
    extensionSocket = socket;
    registerTabs(message.tabs ?? []);
    return;
  }

  if (socket === extensionSocket && (type === "result" || type === "error" || type === "ack")) {
    settlePendingFromExtension(message);
    return;
  }

  if (Object.prototype.hasOwnProperty.call(message, "id") && Object.prototype.hasOwnProperty.call(message, "code")) {
    handleControllerRequest(socket, message);
    return;
  }

  if (type === "ping") {
    sendWsPayload(socket, { type: "pong" });
  }
}

const wsHttpServer = createServer((req, res) => {
  res.writeHead(200, { "content-type": "text/plain; charset=utf-8" });
  res.end("tmwd-hub up\n");
});

const wsServer = new WebSocketServer({ server: wsHttpServer });
wsServer.on("connection", (socket) => {
  clientSockets.add(socket);
  socket.on("message", (raw) => {
    handleSocketMessage(socket, raw);
  });
  socket.on("close", () => {
    clientSockets.delete(socket);
    clearPendingByControllerSocket(socket, "tmwd controller websocket closed");
    if (socket === extensionSocket) {
      extensionSocket = null;
      markAllExtensionSessionsDisconnected();
      clearPendingExec("tmwd extension websocket closed");
    }
  });
  socket.on("error", () => {
    // close handler handles lifecycle cleanup.
  });
});

const linkServer = createServer((req, res) => {
  if (!req.url || !req.url.startsWith("/link")) {
    respondJson(res, 404, { error: "not found" });
    return;
  }

  if (req.method === "GET") {
    respondJson(res, 200, { ok: true, service: "tmwd-hub", at: nowIso() });
    return;
  }

  if (req.method !== "POST") {
    respondJson(res, 405, { error: "method not allowed" });
    return;
  }

  const chunks = [];
  req.on("data", (chunk) => {
    chunks.push(chunk);
  });
  req.on("end", async () => {
    try {
      const raw = Buffer.concat(chunks).toString("utf8");
      const payload = raw.trim() ? JSON.parse(raw) : {};
      const cmd = String(payload.cmd ?? "").trim();

      if (cmd === "get_all_sessions") {
        respondJson(res, 200, { r: listActiveSessions() });
        return;
      }

      if (cmd === "find_session") {
        respondJson(res, 200, { r: findSessions(payload.url_pattern) });
        return;
      }

      if (cmd === "execute_js") {
        const session = pickSession(payload.sessionId);
        if (!session) {
          respondJson(res, 200, { r: { error: "no active session available" } });
          return;
        }

        const timeoutSec = Number(payload.timeout ?? 10);
        const timeoutMs = Number.isFinite(timeoutSec)
          ? Math.max(500, Math.min(120_000, Math.floor(timeoutSec * 1000)))
          : requestTimeoutMs;

        let execResult;
        try {
          execResult = await relayExecToExtension({
            sessionId: session.id,
            code: payload.code,
            timeoutMs,
          });
        } catch (error) {
          respondJson(res, 200, { r: { error: toSerializableError(error).message } });
          return;
        }

        if (!execResult.ok) {
          respondJson(res, 200, {
            r: {
              error: execResult.error ?? "unknown extension error",
              newTabs: execResult.newTabs,
            },
          });
          return;
        }

        const resultPayload = {
          data: execResult.result,
        };
        if (Array.isArray(execResult.newTabs) && execResult.newTabs.length > 0) {
          resultPayload.newTabs = execResult.newTabs;
        }
        respondJson(res, 200, { r: resultPayload });
        return;
      }

      respondJson(res, 200, { r: { ok: false, error: `unknown cmd: ${cmd}` } });
    } catch (error) {
      respondJson(res, 400, { error: toSerializableError(error) });
    }
  });
});

function respondJson(res, status, body) {
  res.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(body));
}

wsHttpServer.listen(wsPort, host, () => {
  process.stdout.write(`[tmwd-hub] ws listening on ws://${host}:${String(wsPort)}\n`);
});

linkServer.listen(linkPort, host, () => {
  process.stdout.write(`[tmwd-hub] link listening on http://${host}:${String(linkPort)}/link\n`);
});

process.on("SIGINT", () => {
  shutdown("SIGINT");
});
process.on("SIGTERM", () => {
  shutdown("SIGTERM");
});

function shutdown(signal) {
  process.stdout.write(`[tmwd-hub] shutting down (${signal})\n`);
  clearPendingExec(`tmwd hub shutdown ${signal}`);
  for (const socket of clientSockets) {
    try {
      socket.close();
    } catch {
      // no-op
    }
  }
  try {
    wsServer.close();
  } catch {
    // no-op
  }
  try {
    wsHttpServer.close();
  } catch {
    // no-op
  }
  try {
    linkServer.close();
  } catch {
    // no-op
  }
  setTimeout(() => process.exit(0), 0);
}
