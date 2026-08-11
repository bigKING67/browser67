import { randomUUID } from "node:crypto";

import { extensionRuntimeInfo } from "./extension-identity.mjs";
import { listActiveSessions, pickSession, resolveBrowserInstance } from "./sessions.mjs";
import { isSocketOpen, sendWsPayload, toSerializableError } from "./socket-utils.mjs";

function extensionSocketFor(hub, browserInstanceId) {
  const instance = hub.browserInstances.get(browserInstanceId);
  if (!instance || !isSocketOpen(instance.socket)) {
    const error = new Error(`tmwd hub has no active extension websocket for browser instance ${browserInstanceId}`);
    error.errorCode = "BROWSER_INSTANCE_UNAVAILABLE";
    throw error;
  }
  return instance.socket;
}

function clearPendingExec(hub, reason, browserInstanceId = "") {
  for (const [id, pending] of hub.pendingExec.entries()) {
    if (browserInstanceId && pending.browserInstanceId !== browserInstanceId) continue;
    clearTimeout(pending.timer);
    hub.pendingExec.delete(id);
    pending.reject(new Error(reason));
  }
}

function clearPendingByControllerSocket(hub, socket, reason) {
  for (const [id, pending] of hub.pendingExec.entries()) {
    if (pending.replySocket !== socket) continue;
    clearTimeout(pending.timer);
    hub.pendingExec.delete(id);
    pending.reject(new Error(reason));
  }
}

async function relayExecToExtension(hub, {
  browserInstanceId,
  sessionId,
  code,
  timeoutMs,
  monitorNewTabs = true,
  replySocket = null,
  replyId = "",
}) {
  const socket = extensionSocketFor(hub, browserInstanceId);
  const tabId = Number(sessionId);
  if (!Number.isFinite(tabId)) throw new Error(`invalid numeric tab/session id: ${String(sessionId)}`);
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
      browserInstanceId,
      extensionSocket: socket,
    });
  });
  try {
    socket.send(JSON.stringify({
      id: relayId,
      browser_instance_id: browserInstanceId,
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

function settlePendingFromExtension(hub, socket, message) {
  const relayId = String(message.id ?? "").trim();
  if (!relayId) return;
  const pending = hub.pendingExec.get(relayId);
  if (!pending || pending.extensionSocket !== socket) return;
  const socketInstanceId = hub.socketBrowserInstances.get(socket);
  if (socketInstanceId !== pending.browserInstanceId) return;
  if (String(message.browser_instance_id ?? "").trim() !== pending.browserInstanceId) return;
  const type = String(message.type ?? "").trim();
  if (type === "ack") return;
  hub.pendingExec.delete(relayId);
  clearTimeout(pending.timer);
  const payload = {
    ok: type === "result",
    result: message.result,
    error: message.error,
    browser_instance_id: pending.browserInstanceId,
    newTabs: Array.isArray(message.newTabs)
      ? message.newTabs.map((tab) => ({ ...tab, browser_instance_id: pending.browserInstanceId }))
      : [],
  };
  if (pending.replySocket) {
    sendWsPayload(pending.replySocket, {
      type: payload.ok ? "result" : "error",
      id: pending.replyId || relayId,
      result: payload.result,
      error: payload.error,
      browser_instance_id: payload.browser_instance_id,
      newTabs: payload.newTabs,
    });
  }
  pending.resolve(payload);
}

function handleControllerRequest(hub, config, socket, message) {
  const requestId = String(message.id ?? "").trim();
  if (!requestId) return;
  const code = message?.code;
  const bridgeCmd = code && typeof code === "object" ? String(code.cmd ?? "").trim() : "";
  const bridgeMethod = code && typeof code === "object"
    ? String(code.method ?? "").trim().toLowerCase()
    : "";
  if (bridgeCmd === "tabs" && (!bridgeMethod || bridgeMethod === "list")) {
    try {
      const browserInstanceId = resolveBrowserInstance(
        hub,
        message.browser_instance_id ?? message.browserInstanceId,
      );
      sendWsPayload(socket, {
        id: requestId,
        success: true,
        browser_instance_id: browserInstanceId,
        result: listActiveSessions(hub, config.sessionTtlMs).filter((session) => (
          session.browser_instance_id === browserInstanceId
        )),
      });
    } catch (error) {
      sendWsPayload(socket, {
        type: "error",
        id: requestId,
        error: toSerializableError(error).message,
        errorCode: error?.errorCode,
        details: error?.details,
      });
    }
    return;
  }
  if (bridgeCmd === "browser67_runtime_info") {
    sendWsPayload(socket, { id: requestId, success: true, result: extensionRuntimeInfo(hub) });
    return;
  }
  try {
    const session = pickSession(
      hub,
      config.sessionTtlMs,
      message.tabId,
      message.browser_instance_id ?? message.browserInstanceId,
    );
    if (!session) throw new Error("no active session available");
    relayExecToExtension(hub, {
      browserInstanceId: session.browser_instance_id,
      sessionId: session.tab_id,
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
        errorCode: error?.errorCode,
        details: error?.details,
      });
    });
  } catch (error) {
    sendWsPayload(socket, {
      type: "error",
      id: requestId,
      error: toSerializableError(error).message,
      errorCode: error?.errorCode,
      details: error?.details,
    });
  }
}

export {
  clearPendingByControllerSocket,
  clearPendingExec,
  handleControllerRequest,
  relayExecToExtension,
  settlePendingFromExtension,
};
