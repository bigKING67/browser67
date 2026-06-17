import assert from "node:assert/strict";

import { extractTabId, waitFor } from "./helpers.mjs";

async function runDirectBridgeCase(context) {
  const directPath = `/tmwd-direct-close-smoke-${String(Date.now())}`;
  const directUrl = `${context.fixture.origin}${directPath}`;
  const directCreate = await context.bridgeCommand({
    cmd: "tabs",
    method: "create",
    url: directUrl,
    active: false,
  });
  const directTabId = extractTabId(directCreate);
  assert.ok(directTabId, "direct bridge create did not return tab id");
  context.openedTabIds.add(directTabId);

  const directAppeared = await waitFor(async () => {
    const tabs = await context.listTabs();
    return {
      ok: tabs.some((tab) => tab.id === directTabId && tab.url.includes(directPath)),
      tabs,
    };
  }, 5_000);
  assert.equal(directAppeared.ok, true, "direct bridge tab did not appear in tabs.list");

  const tabsGet = await probeTabsGet({ context, directTabId });
  const directClose = await context.bridgeCommand({
    cmd: "tabs",
    method: "close",
    tabId: directTabId,
  });
  assert.equal(directClose?.closed, true, "direct tabs.close did not confirm closed=true");
  context.openedTabIds.delete(directTabId);

  const directGone = await waitFor(async () => {
    const tabs = await context.listTabs();
    return {
      ok: !tabs.some((tab) => tab.id === directTabId),
      tabs,
    };
  }, 5_000);
  assert.equal(directGone.ok, true, "direct bridge tab remained after tabs.close");

  return {
    created_tab_id: directTabId,
    tabs_get: tabsGet,
    close: directClose,
    remaining_matches: directGone.tabs.filter((tab) => tab.id === directTabId).length,
  };
}

async function probeTabsGet({ context, directTabId }) {
  let tabsGet = {
    supported: false,
    id_matches: false,
    warning: "",
  };
  try {
    const directGet = await context.bridgeCommand({
      cmd: "tabs",
      method: "get",
      tabId: directTabId,
    });
    tabsGet = {
      supported: true,
      id_matches: extractTabId(directGet) === directTabId,
      tab: directGet,
    };
    assert.equal(tabsGet.id_matches, true, "tabs.get returned the wrong tab");
  } catch (error) {
    tabsGet.warning = String(error?.message ?? error);
    if (context.cli.require_tabs_get === true) {
      throw error;
    }
  }
  return tabsGet;
}

export {
  runDirectBridgeCase,
};
