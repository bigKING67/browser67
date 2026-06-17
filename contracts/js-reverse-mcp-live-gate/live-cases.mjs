import assert from "node:assert/strict";

import { callTool } from "./tool-call.mjs";

function buildCommonArgs(cli) {
  return {
    tmwd_mode: "tmwd",
    tmwd_transport: cli.tmwd_transport,
    tmwd_ws_endpoint: cli.tmwd_ws_endpoint,
    tmwd_link_endpoint: cli.tmwd_link_endpoint,
    timeout_ms: cli.timeout_ms,
  };
}

async function runLiveCases(rpc, cli) {
  const commonArgs = buildCommonArgs(cli);
  const health = await callTool(rpc, "check_browser_health", commonArgs, cli.timeout_ms);
  assert.equal(health?.ok, true);
  if (!cli.allow_empty_tabs) {
    assert.equal(health?.readiness?.ready, true);
  }

  const pagesPayload = await callTool(rpc, "list_pages", commonArgs, cli.timeout_ms);
  const pages = Array.isArray(pagesPayload?.pages) ? pagesPayload.pages : [];
  if (!cli.allow_empty_tabs) {
    assert.equal(pages.length > 0, true);
  }

  const scriptsPayload = pages.length > 0
    ? await callTool(rpc, "list_scripts", commonArgs, cli.timeout_ms)
    : { scripts: [] };
  const scripts = Array.isArray(scriptsPayload?.scripts) ? scriptsPayload.scripts : [];

  const networkPayload = pages.length > 0
    ? await callTool(rpc, "list_network_requests", commonArgs, cli.timeout_ms)
    : { requests: [] };
  const requests = Array.isArray(networkPayload?.requests) ? networkPayload.requests : [];

  return {
    health,
    pages_count: pages.length,
    scripts_count: scripts.length,
    requests_count: requests.length,
  };
}

export {
  runLiveCases,
};
