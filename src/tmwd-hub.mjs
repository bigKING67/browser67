#!/usr/bin/env node

import { readHubConfig } from "./tmwd-hub/config.mjs";
import { createHubState } from "./tmwd-hub/state.mjs";
import { createLinkServer } from "./tmwd-hub/link-server.mjs";
import { installShutdownHandlers } from "./tmwd-hub/shutdown.mjs";
import { createWsHubServer } from "./tmwd-hub/ws-server.mjs";

const config = readHubConfig(process.env);
const hub = createHubState();
const { wsHttpServer, wsServer } = createWsHubServer(hub, config);
const linkServer = createLinkServer(hub, config);

wsHttpServer.listen(config.wsPort, config.host, () => {
  process.stdout.write(`[tmwd-hub] ws listening on ws://${config.host}:${String(config.wsPort)}\n`);
});

linkServer.listen(config.linkPort, config.host, () => {
  process.stdout.write(`[tmwd-hub] link listening on http://${config.host}:${String(config.linkPort)}/link\n`);
});

installShutdownHandlers({
  hub,
  linkServer,
  wsHttpServer,
  wsServer,
});
