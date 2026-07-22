import { createServer } from "node:http";

async function startHttpFixture() {
  const sockets = new Set();
  const server = createServer((req, res) => {
    const parsedUrl = new URL(req.url ?? "/", "http://127.0.0.1");
    const pathname = parsedUrl.pathname;
    if (pathname === "/network-probe") {
      const delayMs = Math.max(0, Math.min(500, Number(parsedUrl.searchParams.get("ms") ?? 120)));
      setTimeout(() => {
        res.writeHead(200, {
          "content-type": "application/json; charset=utf-8",
          "cache-control": "no-store",
        });
        res.end(JSON.stringify({ ok: true, delay_ms: delayMs }));
      }, delayMs);
      return;
    }
    const title = pathname.replace(/^\//, "") || "tmwd-managed-tab-live-smoke";
    const performanceNodes = pathname === "/tmwd-performance-live"
      ? Math.max(1, Math.min(500, Number(parsedUrl.searchParams.get("nodes") ?? 120)))
      : 0;
    const performanceMarkup = performanceNodes > 0
      ? `<section id="performance-root" data-performance-root="true">${Array.from(
        { length: performanceNodes },
        (_, index) => `<button id="performance-node-${String(index)}" data-performance-node="${String(index)}" type="button">Performance node ${String(index)}</button>`,
      ).join("")}</section>`
      : "";
    res.writeHead(200, {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "no-store",
      "content-security-policy": "script-src 'none'; object-src 'none'",
    });
    res.end(`<!doctype html>
<html>
<head><meta charset="utf-8"><title>${title}</title></head>
<body>
  <main data-smoke-title="${title}">${title}</main>
  ${performanceMarkup}
  <script>globalThis.__browser67InlineScriptRan = true;</script>
</body>
</html>`);
  });
  server.keepAliveTimeout = 1_000;
  server.on("connection", (socket) => {
    sockets.add(socket);
    socket.once("close", () => sockets.delete(socket));
  });
  await new Promise((resolvePromise, rejectPromise) => {
    server.once("error", rejectPromise);
    server.listen(0, "127.0.0.1", resolvePromise);
  });
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("fixture server did not expose a TCP port");
  }
  return {
    origin: `http://127.0.0.1:${String(address.port)}`,
    close: () => new Promise((resolvePromise) => {
      for (const socket of sockets) {
        socket.destroy();
      }
      if (typeof server.closeAllConnections === "function") {
        server.closeAllConnections();
      }
      server.close(resolvePromise);
    }),
  };
}

export {
  startHttpFixture,
};
