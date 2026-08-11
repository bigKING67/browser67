import { createServer } from "node:http";
import { WebSocketServer } from "ws";

import {
  markExtensionDisconnected,
  registerExtensionHandshake,
  updateExtensionIdentity,
} from "./extension-identity.mjs";
import {
  clearPendingByControllerSocket,
  clearPendingExec,
  handleControllerRequest,
  settlePendingFromExtension,
} from "./relay.mjs";
import {
  markBrowserInstanceSessionsDisconnected,
  registerTabs,
} from "./sessions.mjs";
import { sendWsPayload } from "./socket-utils.mjs";

function handleSocketMessage(hub, config, socket, raw) {
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
  if (type === "ext_ready") {
    const browserInstanceId = String(message.browser_instance_id ?? "").trim();
    const record = registerExtensionHandshake(hub, browserInstanceId, socket, message.extension_identity);
    if (!record || record.identity_status !== "valid") {
      sendWsPayload(socket, {
        type: "error",
        errorCode: "EXTENSION_PROTOCOL_INCOMPATIBLE",
        error: "browser67 extension handshake requires protocol revision 2 and browser_instance_id",
      });
      if (record) markExtensionDisconnected(hub, browserInstanceId, socket);
      return;
    }
    registerTabs(hub, browserInstanceId, message.tabs ?? [], config.sessionTtlMs);
    return;
  }

  const socketBrowserInstanceId = hub.socketBrowserInstances.get(socket);
  if (type === "tabs_update" && socketBrowserInstanceId) {
    const browserInstanceId = String(message.browser_instance_id ?? "").trim();
    if (browserInstanceId !== socketBrowserInstanceId) return;
    if (Object.prototype.hasOwnProperty.call(message, "extension_identity")) {
      updateExtensionIdentity(hub, browserInstanceId, message.extension_identity);
    }
    registerTabs(hub, browserInstanceId, message.tabs ?? [], config.sessionTtlMs);
    return;
  }

  if (socketBrowserInstanceId && (type === "result" || type === "error" || type === "ack")) {
    settlePendingFromExtension(hub, socket, message);
    return;
  }

  if (Object.prototype.hasOwnProperty.call(message, "id") && Object.prototype.hasOwnProperty.call(message, "code")) {
    handleControllerRequest(hub, config, socket, message);
    return;
  }

  if (type === "ping") {
    sendWsPayload(socket, { type: "pong" });
  }
}

function createWsHubServer(hub, config) {
  const wsHttpServer = createServer((_req, res) => {
    res.writeHead(200, { "content-type": "text/plain; charset=utf-8" });
    res.end("tmwd-hub up\n");
  });

  const wsServer = new WebSocketServer({ server: wsHttpServer });
  wsServer.on("connection", (socket) => {
    hub.clientSockets.add(socket);
    socket.on("message", (raw) => {
      handleSocketMessage(hub, config, socket, raw);
    });
    socket.on("close", () => {
      hub.clientSockets.delete(socket);
      clearPendingByControllerSocket(hub, socket, "tmwd controller websocket closed");
      const browserInstanceId = hub.socketBrowserInstances.get(socket);
      if (browserInstanceId) {
        markExtensionDisconnected(hub, browserInstanceId, socket);
        markBrowserInstanceSessionsDisconnected(hub, browserInstanceId);
        clearPendingExec(hub, "tmwd extension websocket closed", browserInstanceId);
      }
    });
    socket.on("error", () => {
      // close handler handles lifecycle cleanup.
    });
  });

  return {
    wsHttpServer,
    wsServer,
  };
}

export {
  createWsHubServer,
  handleSocketMessage,
};
