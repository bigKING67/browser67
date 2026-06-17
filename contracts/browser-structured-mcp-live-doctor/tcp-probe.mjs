import { Socket } from "node:net";

import { parseEndpoint } from "./endpoints.mjs";

async function probeTcp(endpoint, timeoutMs) {
  const parsed = parseEndpoint(endpoint);
  const startedAt = Date.now();
  return await new Promise((resolvePromise) => {
    const socket = new Socket();
    let finished = false;
    const finish = (reachable, detail) => {
      if (finished) {
        return;
      }
      finished = true;
      try {
        socket.destroy();
      } catch {
        // Best-effort cleanup for already-closed sockets.
      }
      resolvePromise({
        endpoint: parsed.href,
        host: parsed.host,
        port: parsed.port,
        reachable,
        latency_ms: Date.now() - startedAt,
        detail,
      });
    };
    socket.setTimeout(timeoutMs);
    socket.once("connect", () => finish(true, "connect_ok"));
    socket.once("timeout", () => finish(false, "timeout"));
    socket.once("error", (error) => {
      finish(false, String(error?.code ?? error?.message ?? "socket_error"));
    });
    socket.connect(parsed.port, parsed.host);
  });
}

export {
  probeTcp,
};
