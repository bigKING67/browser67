#!/usr/bin/env node
import { parseArgs } from "./browser-managed-tab-live-smoke/cli.mjs";
import { runAdoptionCase } from "./browser-managed-tab-live-smoke/adoption-case.mjs";
import { createManagedSmokeContext } from "./browser-managed-tab-live-smoke/context.mjs";
import { runDirectBridgeCase } from "./browser-managed-tab-live-smoke/direct-bridge-case.mjs";
import { runExternalCloseCase } from "./browser-managed-tab-live-smoke/external-close-case.mjs";
import { runManagedLifecycleCase } from "./browser-managed-tab-live-smoke/managed-lifecycle-case.mjs";
import { readRegistryRemaining } from "./browser-managed-tab-live-smoke/registry.mjs";

async function run(argv = process.argv.slice(2)) {
  const cli = parseArgs(argv);
  const context = await createManagedSmokeContext(cli);
  try {
    const directBridge = await runDirectBridgeCase(context);
    const managedLifecycle = await runManagedLifecycleCase(context);
    const externalClose = await runExternalCloseCase(context);
    const adoption = await runAdoptionCase(context);
    const registryRemaining = await readRegistryRemaining(context.registryPath);
    return {
      ok: true,
      direct_bridge: directBridge,
      managed_lifecycle: {
        ...managedLifecycle,
        externally_closed_not_reused: externalClose.externally_closed_not_reused,
        registry_remaining: registryRemaining,
      },
      adoption,
    };
  } finally {
    await context.cleanup();
  }
}

try {
  const result = await run();
  process.stdout.write(`${JSON.stringify(result)}\n`);
} catch (error) {
  let message = error instanceof Error ? error.message : String(error);
  if (message.includes("unsupported tabs method: get")) {
    message = `${message}; reload the unpacked TMWD extension so the running bridge picks up tabs.get`;
  }
  process.stderr.write(`browser-managed-tab-live-smoke failed: ${message}\n`);
  process.stdout.write(`${JSON.stringify({ ok: false, error: message })}\n`);
  process.exitCode = 1;
}

export {
  run,
};
