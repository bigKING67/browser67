#!/usr/bin/env node

import { runRemoteCdpContract } from "./browser67-remote-cdp-contract/runner.mjs";

try {
  process.exitCode = await runRemoteCdpContract(process.argv.slice(2));
} catch (error) {
  process.stderr.write(`browser67-remote-cdp-contract failed: ${String(error?.message ?? error)}\n`);
  process.exitCode = 1;
}
