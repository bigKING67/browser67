#!/usr/bin/env node

import { runRemoteCdpContract } from "./browser-structured-mcp-remote-cdp-contract/runner.mjs";

try {
  process.exitCode = await runRemoteCdpContract(process.argv.slice(2));
} catch (error) {
  process.stderr.write(`browser-structured-mcp-remote-cdp-contract failed: ${String(error?.message ?? error)}\n`);
  process.exitCode = 1;
}
