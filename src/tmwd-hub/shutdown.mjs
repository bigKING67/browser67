import { clearPendingExec } from "./relay.mjs";

function installShutdownHandlers(resources) {
  process.on("SIGINT", () => {
    shutdown("SIGINT", resources);
  });
  process.on("SIGTERM", () => {
    shutdown("SIGTERM", resources);
  });
}

function shutdown(signal, { hub, wsServer, wsHttpServer, linkServer }) {
  process.stdout.write(`[tmwd-hub] shutting down (${signal})\n`);
  clearPendingExec(hub, `tmwd hub shutdown ${signal}`);
  for (const socket of hub.clientSockets) {
    try {
      socket.close();
    } catch {
      // no-op
    }
  }
  try {
    wsServer.close();
  } catch {
    // no-op
  }
  try {
    wsHttpServer.close();
  } catch {
    // no-op
  }
  try {
    linkServer.close();
  } catch {
    // no-op
  }
  setTimeout(() => process.exit(0), 0);
}

export {
  installShutdownHandlers,
  shutdown,
};
