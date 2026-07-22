function waitForWebSocketOpen(socket, timeoutMs) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`cdp websocket open timeout after ${String(timeoutMs)}ms`));
    }, timeoutMs);
    socket.addEventListener("open", () => {
      clearTimeout(timer);
      resolve();
    }, { once: true });
    socket.addEventListener("error", (event) => {
      clearTimeout(timer);
      reject(new Error(String(event?.message || "websocket error")));
    }, { once: true });
  });
}

function createCdpClient(webSocketDebuggerUrl) {
  const socket = new WebSocket(webSocketDebuggerUrl);
  const pending = new Map();
  const eventListeners = new Set();
  let seq = 1;

  const rejectAllPending = (error) => {
    for (const [, deferred] of pending) {
      deferred.reject(error);
    }
    pending.clear();
  };

  socket.addEventListener("message", (event) => {
    let payload;
    try {
      payload = JSON.parse(String(event.data));
    } catch {
      return;
    }
    if (!payload || typeof payload !== "object") {
      return;
    }
    const id = payload.id;
    if (typeof id !== "number") {
      for (const listener of eventListeners) {
        try {
          listener(payload);
        } catch {
          // Event consumers are isolated from the CDP response channel.
        }
      }
      return;
    }
    const deferred = pending.get(id);
    if (!deferred) {
      return;
    }
    pending.delete(id);
    if (payload.error) {
      deferred.reject(new Error(String(payload.error.message ?? "cdp command failed")));
      return;
    }
    deferred.resolve(payload.result ?? {});
  });

  socket.addEventListener("close", () => {
    rejectAllPending(new Error("cdp websocket closed"));
  });

  socket.addEventListener("error", () => {
    rejectAllPending(new Error("cdp websocket error"));
  });

  return {
    async connect(timeoutMs) {
      await waitForWebSocketOpen(socket, timeoutMs);
    },
    send(method, params = {}, timeoutMs = 10_000) {
      const id = seq;
      seq += 1;
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          pending.delete(id);
          reject(new Error(`cdp command timeout method=${method}`));
        }, timeoutMs);
        pending.set(id, {
          resolve: (value) => {
            clearTimeout(timer);
            resolve(value);
          },
          reject: (error) => {
            clearTimeout(timer);
            reject(error);
          },
        });
        socket.send(JSON.stringify({ id, method, params }));
      });
    },
    onEvent(listener) {
      eventListeners.add(listener);
      return () => eventListeners.delete(listener);
    },
    close() {
      eventListeners.clear();
      try {
        socket.close();
      } catch {
        // no-op
      }
    },
  };
}

export { createCdpClient };
