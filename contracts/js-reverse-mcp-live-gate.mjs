#!/usr/bin/env node

import { runJsReverseLiveGate } from "./js-reverse-mcp-live-gate/runner.mjs";

try {
  await runJsReverseLiveGate(process.argv.slice(2));
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`js-reverse-mcp-live-gate failed: ${message}\n`);
  process.exitCode = 1;
}
