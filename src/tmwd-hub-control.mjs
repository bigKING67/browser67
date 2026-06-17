#!/usr/bin/env node

import { parseArgs } from "./tmwd-hub-control/cli.mjs";
import { formatStatusHuman } from "./tmwd-hub-control/format.mjs";
import {
  collectStatus,
  startHub,
  stopHub,
} from "./tmwd-hub-control/start-stop.mjs";

async function run() {
  const config = parseArgs(process.argv.slice(2));
  let payload;
  if (config.command === "status") {
    payload = await collectStatus(config);
  } else if (config.command === "start") {
    payload = await startHub(config);
  } else if (config.command === "stop") {
    payload = await stopHub(config);
  } else {
    throw new Error(`unsupported command: ${config.command}`);
  }
  if (config.json) {
    process.stdout.write(`${JSON.stringify(payload)}\n`);
  } else if (payload.action === "status") {
    process.stdout.write(`${formatStatusHuman(payload)}\n`);
  } else {
    process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
  }
  if (payload.ok !== true) {
    process.exitCode = 1;
  }
}

try {
  await run();
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`tmwd-hub-control failed: ${message}\n`);
  process.exitCode = 1;
}
