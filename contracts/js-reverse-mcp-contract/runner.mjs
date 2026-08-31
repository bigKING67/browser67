import { tmpdir } from "node:os";
import { resolve } from "node:path";

import { createJsReverseRpcClient } from "../js-reverse-mcp-common/rpc-client.mjs";
import { runBrowserInstancePruneCases } from "./browser-instance-prune.mjs";
import { parseArgs } from "./cli.mjs";
import { runLifecycleCases } from "./lifecycle-cases.mjs";
import { runStateCases } from "./state-cases.mjs";
import {
  assertRequiredTools,
  initializeJsReverseContractSession,
} from "./session.mjs";
import { runToolCases } from "./tool-cases.mjs";

async function runJsReverseMcpContract(argv) {
  const cli = parseArgs(argv);
  const previousTabRegistryPath = process.env.BROWSER_STRUCTURED_TAB_REGISTRY_PATH;
  const tmpTabRegistryPath = resolve(
    tmpdir(),
    `tmwd-js-reverse-tab-registry-contract-${process.pid}-${Date.now()}.json`,
  );
  process.env.BROWSER_STRUCTURED_TAB_REGISTRY_PATH = tmpTabRegistryPath;
  const rpc = createJsReverseRpcClient({
    idPrefix: "js_reverse_contract",
    defaultTimeoutMs: cli.timeout_ms,
  });
  try {
    await runBrowserInstancePruneCases();
    await runStateCases();
    const tools = await initializeJsReverseContractSession(rpc, cli.timeout_ms);
    const names = assertRequiredTools(tools);
    await runLifecycleCases(rpc, cli);
    await runToolCases(rpc, cli);

    process.stdout.write(`${JSON.stringify({ ok: true, tools_count: names.length })}\n`);
  } finally {
    await rpc.close();
    if (previousTabRegistryPath === undefined) {
      delete process.env.BROWSER_STRUCTURED_TAB_REGISTRY_PATH;
    } else {
      process.env.BROWSER_STRUCTURED_TAB_REGISTRY_PATH = previousTabRegistryPath;
    }
  }
}

export {
  runJsReverseMcpContract,
};
