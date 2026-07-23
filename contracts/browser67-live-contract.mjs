#!/usr/bin/env node
import { createRpcClient } from "./browser67-browser-mcp-contract/rpc-client.mjs";
import { parseArgs, commonArgs } from "./browser67-live-contract/cli.mjs";
import { runExecuteCase, runScanCase } from "./browser67-live-contract/live-cases.mjs";
import {
  createManagedLiveFixture,
  finalizeManagedLiveFixture,
} from "./browser67-live-contract/managed-fixture.mjs";
import { initializeAndAssertTools } from "./browser67-live-contract/session.mjs";
import { assertLiveTargetIdentity } from "./browser67-live-contract/target-routing.mjs";

async function run(argv = process.argv.slice(2)) {
  const cli = parseArgs(argv);
  const rpc = createRpcClient();
  let fixtureContext = null;
  let runError = null;
  let outputPayload = null;
  try {
    await initializeAndAssertTools(rpc, cli);
    const baseArgs = commonArgs(cli);
    const externalTargetRequested = Boolean(
      String(cli.target_tab_id ?? "").trim()
      || String(cli.target_url_contains ?? "").trim()
      || cli.require_cookie === true,
    );
    if (!externalTargetRequested) {
      fixtureContext = await createManagedLiveFixture({ rpc, cli, commonArgs: baseArgs });
    }
    const effectiveCli = fixtureContext
      ? { ...cli, target_tab_id: fixtureContext.tab_id }
      : cli;
    const scanPayload = await runScanCase({ rpc, cli: effectiveCli, commonArgs: baseArgs });
    const executePayload = await runExecuteCase({
      rpc,
      cli: effectiveCli,
      commonArgs: baseArgs,
      targetTabId: fixtureContext?.tab_id ?? scanPayload?.metadata?.active_tab,
    });
    assertLiveTargetIdentity({ cli: effectiveCli, scanPayload, executePayload });
    const tabsCount = Number(scanPayload?.metadata?.tabs_count ?? 0);
    outputPayload = {
      ok: true,
      transport: executePayload.transport,
      transport_attempts: executePayload.transport_attempts,
      tabs_count: tabsCount,
      active_tab: scanPayload?.metadata?.active_tab,
      tab_id: executePayload?.tab_id,
      title: executePayload?.js_return?.title,
      href: executePayload?.js_return?.href,
      cookie_length: executePayload?.js_return?.cookie?.length ?? 0,
      require_cookie: cli.require_cookie,
      managed_fixture: fixtureContext !== null,
      managed_fixture_workspace: fixtureContext?.workspace_key ?? null,
      tmwd_mode: cli.tmwd_mode,
      tmwd_transport: cli.tmwd_transport,
      tmwd_ws_endpoint: cli.tmwd_ws_endpoint,
      tmwd_link_endpoint: cli.tmwd_link_endpoint,
      cdp_endpoint: cli.cdp_endpoint,
    };
  } catch (error) {
    runError = error;
    throw error;
  } finally {
    try {
      await finalizeManagedLiveFixture({
        rpc,
        cli,
        commonArgs: commonArgs(cli),
        fixtureContext,
      });
    } catch (cleanupError) {
      if (!runError) throw cleanupError;
    }
    await rpc.close();
  }
  process.stdout.write(`${JSON.stringify(outputPayload)}\n`);
}

try {
  await run();
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`browser67-live-contract failed: ${message}\n`);
  process.exitCode = 1;
}

export {
  run,
};
