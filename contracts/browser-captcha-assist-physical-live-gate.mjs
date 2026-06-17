#!/usr/bin/env node

import { runPhysicalLiveGate } from "./browser-captcha-assist-physical-live-gate/runner.mjs";

function jsonLine(payload) {
  process.stdout.write(`${JSON.stringify(payload)}\n`);
}

const result = await runPhysicalLiveGate({
  argv: process.argv.slice(2),
  cwd: process.cwd(),
  env: process.env,
});
jsonLine(result.payload);
process.exitCode = result.exitCode;
