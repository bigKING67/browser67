#!/usr/bin/env node

import { createInterface } from "node:readline";

import { createRequestHandler, sendError } from "./server/protocol.mjs";

const handleRequest = createRequestHandler();

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
