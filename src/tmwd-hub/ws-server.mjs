import { createServer } from "node:http";
import { WebSocketServer } from "ws";

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
    hub.extensionSocket = socket;
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
