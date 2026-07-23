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
  markAllExtensionSessionsDisconnected,
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
  if (type === "ext_ready" || type === "tabs_update") {
    const newExtensionSocket = socket !== hub.extensionSocket;
    hub.extensionSocket = socket;
    if (type === "ext_ready" || newExtensionSocket) {
      registerExtensionHandshake(hub, message.extension_identity);
    } else if (Object.prototype.hasOwnProperty.call(message, "extension_identity")) {
      updateExtensionIdentity(hub, message.extension_identity);
    }
    registerTabs(hub, message.tabs ?? [], config.sessionTtlMs);
    return;
  }

  if (socket === hub.extensionSocket && (type === "result" || type === "error" || type === "ack")) {
    settlePendingFromExtension(hub, message);
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
      if (socket === hub.extensionSocket) {
        hub.extensionSocket = null;
        markExtensionDisconnected(hub);
        markAllExtensionSessionsDisconnected(hub);
        clearPendingExec(hub, "tmwd extension websocket closed");
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
