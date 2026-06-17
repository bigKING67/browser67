import { parseArgs } from "./cli.mjs";
import { runLiveCases } from "./live-cases.mjs";
import { createRpcClient } from "./rpc-client.mjs";
import { initializeJsReverseSession } from "./session.mjs";

async function runJsReverseLiveGate(argv) {
  const cli = parseArgs(argv);
  const rpc = createRpcClient();
  try {
    await initializeJsReverseSession(rpc, cli.timeout_ms);
    const result = await runLiveCases(rpc, cli);

    process.stdout.write(`${JSON.stringify({
      ok: true,
      stage: "js_reverse_live_passed",
      transport: result.health.transport,
      readiness_reason: result.health.readiness?.reason,
      pages_count: result.pages_count,
      scripts_count: result.scripts_count,
      requests_count: result.requests_count,
      tmwd_transport: cli.tmwd_transport,
      tmwd_ws_endpoint: cli.tmwd_ws_endpoint,
      tmwd_link_endpoint: cli.tmwd_link_endpoint,
    })}\n`);
  } finally {
    await rpc.close();
  }
}

export {
  runJsReverseLiveGate,
};
