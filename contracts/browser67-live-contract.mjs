#!/usr/bin/env node
import { createRpcClient } from "./browser67-browser-mcp-contract/rpc-client.mjs";
import { parseArgs, commonArgs } from "./browser67-live-contract/cli.mjs";
import { runExecuteCase, runScanCase } from "./browser67-live-contract/live-cases.mjs";
import { initializeAndAssertTools } from "./browser67-live-contract/session.mjs";

async function run(argv = process.argv.slice(2)) {
  const cli = parseArgs(argv);
  const rpc = createRpcClient();
  try {
    await initializeAndAssertTools(rpc, cli);
    const baseArgs = commonArgs(cli);
    const scanPayload = await runScanCase({ rpc, cli, commonArgs: baseArgs });
    const executePayload = await runExecuteCase({ rpc, cli, commonArgs: baseArgs });
    const tabsCount = Number(scanPayload?.metadata?.tabs_count ?? 0);
    process.stdout.write(
      `${JSON.stringify({
        ok: true,
        transport: executePayload.transport,
        transport_attempts: executePayload.transport_attempts,
        tabs_count: tabsCount,
        active_tab: scanPayload?.metadata?.active_tab,
        title: executePayload?.js_return?.title,
        href: executePayload?.js_return?.href,
        cookie_length: executePayload?.js_return?.cookie?.length ?? 0,
        require_cookie: cli.require_cookie,
        tmwd_mode: cli.tmwd_mode,
        tmwd_transport: cli.tmwd_transport,
        tmwd_ws_endpoint: cli.tmwd_ws_endpoint,
        tmwd_link_endpoint: cli.tmwd_link_endpoint,
        cdp_endpoint: cli.cdp_endpoint,
      })}\n`,
    );
  } finally {
    await rpc.close();
  }
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
