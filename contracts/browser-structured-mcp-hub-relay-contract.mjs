#!/usr/bin/env node

import { runHubRelayContract } from "./browser-structured-mcp-hub-relay-contract/runner.mjs";

try {
  await runHubRelayContract();
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`browser-structured-mcp-hub-relay-contract failed: ${message}\n`);
  process.exitCode = 1;
}
