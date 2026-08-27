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

function createWsMessagePromise(ws, predicate, label, timeoutMs, afterSubscribe = null) {
  return new Promise((resolvePromise, rejectPromise) => {
    let settled = false;
    let timer;
    const finish = (callback, value) => {
      if (settled) return;
      settled = true;
      cleanup();
      callback(value);
    };
    timer = setTimeout(() => {
      finish(rejectPromise, new Error(`timed out waiting for websocket message: ${label}`));
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
      finish(resolvePromise, parsed);
    };
    const onClose = () => {
      finish(rejectPromise, new Error(`websocket closed while waiting for: ${label}`));
    };
    const onError = (error) => {
      finish(rejectPromise, error instanceof Error ? error : new Error(String(error)));
    };
    function cleanup() {
      if (timer) clearTimeout(timer);
      ws.off("message", onMessage);
      ws.off("close", onClose);
      ws.off("error", onError);
    }
    ws.on("message", onMessage);
    ws.once("close", onClose);
    ws.once("error", onError);
    try {
      afterSubscribe?.();
    } catch (error) {
      finish(rejectPromise, error instanceof Error ? error : new Error(String(error)));
    }
  });
}

function waitForWsMessage(ws, predicate, label, timeoutMs = 3_000) {
  return createWsMessagePromise(ws, predicate, label, timeoutMs);
}

async function sendControllerRequest(ws, payload) {
  return createWsMessagePromise(
    ws,
    (message) => String(message.id ?? "") === String(payload.id),
    `controller response ${String(payload.id)}`,
    3_000,
    () => ws.send(JSON.stringify(payload)),
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
