import assert from "node:assert/strict";

import { firstJsonContent } from "../browser67-browser-mcp-contract/rpc-content.mjs";
import { buildLivePrereqHint, toToolErrorSummary } from "./errors.mjs";
import { buildLiveTargetRoute } from "./target-routing.mjs";

async function runScanCase({ rpc, cli, commonArgs }) {
  const scanCall = await rpc.call(
    "tools/call",
    {
      name: "browser_scan",
      arguments: {
        ...commonArgs,
        tabs_only: true,
        ...buildLiveTargetRoute(cli),
      },
    },
    cli.timeout_ms,
  );
  if (scanCall?.result?.isError === true) {
    const errorPayload = firstJsonContent(scanCall.result);
    throw new Error(`live browser_scan failed: ${toToolErrorSummary(errorPayload)} ${buildLivePrereqHint(cli)}`);
  }
  const scanPayload = firstJsonContent(scanCall.result);
  assert.equal(scanPayload?.status, "success");
  const tabsCount = Number(scanPayload?.metadata?.tabs_count ?? 0);
  if (!cli.allow_empty_tabs) {
    assert.equal(Number.isFinite(tabsCount) && tabsCount > 0, true);
  }
  return scanPayload;
}

async function runExecuteCase({ rpc, cli, commonArgs, targetTabId }) {
  const executeCall = await rpc.call(
    "tools/call",
    {
      name: "browser_execute_js",
      arguments: {
        ...commonArgs,
        no_monitor: true,
        native_auto_fallback: true,
        native_auto_fallback_policy: "balanced",
        script: "let cookie = ''; try { cookie = document.cookie; } catch {} return ({ title: document.title, href: location.href, cookie });",
        ...buildLiveTargetRoute({
          ...cli,
          target_tab_id: targetTabId || cli.target_tab_id,
        }),
      },
    },
    cli.timeout_ms,
  );
  if (executeCall?.result?.isError === true) {
    const errorPayload = firstJsonContent(executeCall.result);
    throw new Error(`live browser_execute_js failed: ${toToolErrorSummary(errorPayload)} ${buildLivePrereqHint(cli)}`);
  }
  const executePayload = firstJsonContent(executeCall.result);
  if (executePayload?.status !== "success") {
    throw new Error(`live browser_execute_js returned non-success: ${toToolErrorSummary(executePayload)} ${buildLivePrereqHint(cli)}`);
  }
  assert.equal(typeof executePayload?.js_return?.title, "string");
  assert.equal(typeof executePayload?.js_return?.href, "string");
  assert.equal(typeof executePayload?.js_return?.cookie, "object");
  assert.equal(executePayload?.js_return?.cookie?.redacted, true);
  assert.equal(typeof executePayload?.js_return?.cookie?.length, "number");
  if (cli.require_cookie) {
    assert.equal(executePayload.js_return.cookie.present, true);
  }
  return executePayload;
}

export {
  runExecuteCase,
  runScanCase,
};
