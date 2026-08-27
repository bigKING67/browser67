#!/usr/bin/env node

import { runHubRelayContract } from "./browser67-hub-relay-contract/runner.mjs";

try {
  await runHubRelayContract();
} catch (error) {
  const detail = error instanceof Error ? (error.stack ?? error.message) : String(error);
  process.stderr.write(`browser67-hub-relay-contract failed:\n${detail}\n`);
  process.exitCode = 1;
}
