import { createServer } from "node:http";

const FIXTURE_HTML = "<!doctype html><html><head><title>remote-cdp-fixture</title></head><body>remote cdp fixture</body></html>";

function createFixtureServer() {
  return createServer((_request, response) => {
    response.writeHead(200, {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "no-store",
    });
    response.end(FIXTURE_HTML);
  });
}

function createReservedServer() {
  return createServer((_request, response) => {
    response.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
    response.end("reserved");
  });
}

function listen(server, host = "127.0.0.1") {
  return new Promise((resolvePromise, rejectPromise) => {
    server.once("error", rejectPromise);
    server.listen(0, host, () => {
      server.off("error", rejectPromise);
      const address = server.address();
      if (!address || typeof address === "string") {
        rejectPromise(new Error("server returned invalid address"));
        return;
      }
      resolvePromise(address.port);
    });
  });
}

function closeServer(server) {
  return new Promise((resolvePromise) => {
    try {
      server.close(() => resolvePromise());
    } catch {
      resolvePromise();
    }
  });
}

async function reservePort() {
  const cdpServer = createReservedServer();
  const cdpPort = await listen(cdpServer);
  await closeServer(cdpServer);
  return cdpPort;
}

export {
  closeServer,
  createFixtureServer,
  listen,
  reservePort,
};
