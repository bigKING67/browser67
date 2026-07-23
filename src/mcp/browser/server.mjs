#!/usr/bin/env node

import { createInterface } from "node:readline";

import { createRequestHandler, sendError } from "../../server/protocol.mjs";
import { createBrowserToolDispatcher } from "./tool-registry.mjs";

const tools = createBrowserToolDispatcher();
const handleRequest = createRequestHandler({
  dispatchTool: tools.dispatch,
  listTools: tools.listTools,
});

const rl = createInterface({
  input: process.stdin,
  crlfDelay: Infinity,
});

rl.on("line", (line) => {
  const raw = line.trim();
  if (!raw) {
    return;
  }
  try {
    handleRequest(JSON.parse(raw));
  } catch (error) {
    sendError(null, -32700, `parse error: ${String(error)}`);
  }
});

rl.on("close", () => {
  tools.dispose().catch((error) => {
    process.stderr.write(`browser runtime dispose failed: ${String(error)}\n`);
  });
});
