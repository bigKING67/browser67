#!/usr/bin/env node

import { createInterface } from "node:readline";

import {
  handleRequest,
  sendError,
} from "../../js-reverse-server/protocol.mjs";
import { disposeJsReverseRuntime } from "./tool-registry.mjs";

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

rl.on("close", () => {
  disposeJsReverseRuntime().catch((error) => {
    process.stderr.write(`js-reverse runtime dispose failed: ${String(error)}\n`);
  });
});
