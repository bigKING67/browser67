import assert from "node:assert/strict";

import { commonArgs } from "./helpers.mjs";

async function runFinalizerCase(context, tabIds) {
  const { callTool, cli, workspaceKey } = context;
  const pageState = await callTool("browser_execute_js", {
    ...commonArgs(cli),
    tab_id: tabIds.managedTabId,
    script: "return { url: location.href, path: location.pathname, text: document.body.innerText };",
  });
  assert.equal(pageState?.js_return?.path, "/protected");
  assert.equal(String(pageState?.js_return?.text ?? "").includes("fixture secret page"), true);

  const finalize = await callTool("browser_tab_lifecycle", {
    ...commonArgs(cli),
    action: "finalize_task",
    workspace_key: workspaceKey,
    prune_stale: false,
  });
  assert.equal(finalize.status, "success", "auth live finalize_task did not succeed");
  assertClosed(finalize, tabIds.managedTabId, "managed");
  assertClosed(finalize, tabIds.captchaTabId, "captcha");
  assertClosed(finalize, tabIds.mfaTabId, "mfa");
  assertClosed(finalize, tabIds.ssoTabId, "sso");
  assertClosed(finalize, tabIds.oauthTabId, "oauth");
  return finalize;
}

function assertClosed(finalize, tabId, label) {
  assert.equal(
    finalize.close_unkept.closed.some((row) => String(row?.tab_id ?? "") === tabId && row.closed === true),
    true,
    `auth live finalize_task did not close the ${label} managed tab`,
  );
}

export {
  runFinalizerCase,
};
