#!/usr/bin/env node

import { createInterface } from "node:readline";

import {
  handleRequest,
  sendError,
} from "../../js-reverse-server/protocol.mjs";

const rl = createInterface({ input: process.stdin, crlfDelay: Infinity });

rl.on("line", (line) => {
  const raw = line.trim();
  if (!raw) return;
  try {
    handleRequest(JSON.parse(raw));
  } catch (error) {
    sendError(null, -32700, `parse error: ${String(error)}`);
  }
});
