import { WebSocket } from "ws";

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

function sendWsPayload(socket, payload) {
  if (!isSocketOpen(socket)) {
    return;
  }
  socket.send(JSON.stringify(payload));
}

function respondJson(res, status, body) {
  res.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(body));
}

export {
  isSocketOpen,
  respondJson,
  sendWsPayload,
  toSerializableError,
};
