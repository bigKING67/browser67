#!/usr/bin/env node
import assert from "node:assert/strict";

import { parseArgs } from "./browser-managed-tab-live-smoke/cli.mjs";
import { createManagedSmokeContext } from "./browser-managed-tab-live-smoke/context.mjs";
import { runTmwdPerformanceCase } from "./browser-managed-tab-live-smoke/performance-case.mjs";
import { readRegistryRemaining } from "./browser-managed-tab-live-smoke/registry.mjs";

async function run(argv = process.argv.slice(2)) {
  const cli = parseArgs(argv);
  const context = await createManagedSmokeContext(cli);
  try {
    const performance = await runTmwdPerformanceCase(context);
    const registryRemaining = await readRegistryRemaining(context.registryPath);
    assert.equal(registryRemaining, 0, "TMWD performance live smoke left managed registry records");
    return { ok: true, performance, registry_remaining: registryRemaining };
  } finally {
    await context.cleanup();
  }
}

try {
  const result = await run();
  process.stdout.write(`${JSON.stringify(result)}\n`);
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`browser-tmwd-performance-live-smoke failed: ${message}\n`);
  process.stdout.write(`${JSON.stringify({ ok: false, error: message })}\n`);
  process.exitCode = 1;
}

export { run };
