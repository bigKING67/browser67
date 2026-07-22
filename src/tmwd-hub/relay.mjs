import { randomUUID } from "node:crypto";

import { listActiveSessions } from "./sessions.mjs";
import {
  isSocketOpen,
  sendWsPayload,
  toSerializableError,
} from "./socket-utils.mjs";

function ensureExtensionSocketReady(hub) {
  if (!isSocketOpen(hub.extensionSocket)) {
    throw new Error("tmwd hub has no active extension websocket connection");
  }
}

function clearPendingExec(hub, reason) {
  for (const [id, pending] of hub.pendingExec.entries()) {
    clearTimeout(pending.timer);
    hub.pendingExec.delete(id);
    pending.reject(new Error(reason));
  }
}

function clearPendingByControllerSocket(hub, socket, reason) {
  for (const [id, pending] of hub.pendingExec.entries()) {
    if (pending.replySocket !== socket) {
      continue;
    }
    clearTimeout(pending.timer);
    hub.pendingExec.delete(id);
    pending.reject(new Error(reason));
  }
}

async function relayExecToExtension(
  hub,
  {
    sessionId,
    code,
    timeoutMs,
    monitorNewTabs = true,
    replySocket = null,
    replyId = "",
  },
) {
  ensureExtensionSocketReady(hub);
  const tabId = Number(sessionId);
  if (!Number.isFinite(tabId)) {
    throw new Error(`invalid numeric tab/session id: ${String(sessionId)}`);
  }

  const relayId = `hub_${randomUUID()}`;
  const clampedTimeoutMs = Math.max(500, Math.min(120_000, timeoutMs));

  const promise = new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      hub.pendingExec.delete(relayId);
      reject(new Error(`tmwd hub exec timeout id=${relayId}`));
    }, clampedTimeoutMs);

    hub.pendingExec.set(relayId, {
      timer,
      resolve,
      reject,
      replySocket,
      replyId,
    });
  });

  try {
    hub.extensionSocket.send(JSON.stringify({
      id: relayId,
      tabId,
      code,
      monitorNewTabs: monitorNewTabs !== false,
    }));
  } catch (error) {
    const pending = hub.pendingExec.get(relayId);
    if (pending) {
      clearTimeout(pending.timer);
      hub.pendingExec.delete(relayId);
      pending.reject(error instanceof Error ? error : new Error(String(error)));
    }
  }

  return promise;
}

function settlePendingFromExtension(hub, message) {
  const relayId = String(message.id ?? "").trim();
  if (!relayId) {
    return;
  }
  const pending = hub.pendingExec.get(relayId);
  if (!pending) {
    return;
  }

  const type = String(message.type ?? "").trim();
  if (type === "ack") {
    return;
  }

  hub.pendingExec.delete(relayId);
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

function handleControllerRequest(hub, config, socket, message) {
  const requestId = String(message.id ?? "").trim();
  if (!requestId) {
    return;
  }
  const code = message?.code;
  const bridgeCmd = code && typeof code === "object"
    ? String(code.cmd ?? "").trim()
    : "";
  const bridgeMethod = code && typeof code === "object"
    ? String(code.method ?? "").trim().toLowerCase()
    : "";
  if (bridgeCmd === "tabs" && (!bridgeMethod || bridgeMethod === "list")) {
    const tabs = listActiveSessions(hub, config.sessionTtlMs).map((session) => ({
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

  relayExecToExtension(hub, {
    sessionId: tabId,
    code: message.code,
    timeoutMs: config.requestTimeoutMs,
    monitorNewTabs: message.monitorNewTabs !== false,
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

export {
  clearPendingByControllerSocket,
  clearPendingExec,
  handleControllerRequest,
  relayExecToExtension,
  settlePendingFromExtension,
};
