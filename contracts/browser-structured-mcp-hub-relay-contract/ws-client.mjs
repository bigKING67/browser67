import { WebSocket } from "ws";

function openWs(url) {
  return new Promise((resolvePromise, rejectPromise) => {
    const ws = new WebSocket(url);
    ws.once("open", () => resolvePromise(ws));
    ws.once("error", rejectPromise);
  });
}

function parseWsMessage(raw) {
  return JSON.parse(String(raw));
}

function waitForWsMessage(ws, predicate, label, timeoutMs = 3_000) {
  return new Promise((resolvePromise, rejectPromise) => {
    const timer = setTimeout(() => {
      cleanup();
      rejectPromise(new Error(`timed out waiting for websocket message: ${label}`));
    }, timeoutMs);
    const onMessage = (raw) => {
      let parsed;
      try {
        parsed = parseWsMessage(raw);
      } catch {
        return;
      }
      if (!predicate(parsed)) {
        return;
      }
      cleanup();
      resolvePromise(parsed);
    };
    const onClose = () => {
      cleanup();
      rejectPromise(new Error(`websocket closed while waiting for: ${label}`));
    };
    const onError = (error) => {
      cleanup();
      rejectPromise(error instanceof Error ? error : new Error(String(error)));
    };
    function cleanup() {
      clearTimeout(timer);
      ws.off("message", onMessage);
      ws.off("close", onClose);
      ws.off("error", onError);
    }
    ws.on("message", onMessage);
    ws.once("close", onClose);
    ws.once("error", onError);
  });
}

async function sendControllerRequest(ws, payload) {
  ws.send(JSON.stringify(payload));
  return waitForWsMessage(
    ws,
    (message) => String(message.id ?? "") === String(payload.id),
    `controller response ${String(payload.id)}`,
  );
}

function closeWs(ws) {
  try {
    ws?.close();
  } catch {
    // ignore
  }
}

export {
  closeWs,
  openWs,
  sendControllerRequest,
  waitForWsMessage,
};
