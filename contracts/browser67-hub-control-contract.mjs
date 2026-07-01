#!/usr/bin/env node

import { runHubControlContract } from "./browser67-hub-control-contract/runner.mjs";

try {
  await runHubControlContract();
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`browser67-hub-control-contract failed: ${message}\n`);
  process.exitCode = 1;
}
