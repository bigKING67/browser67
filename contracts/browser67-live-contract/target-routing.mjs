import assert from "node:assert/strict";

function normalizeToken(raw) {
  return String(raw ?? "").trim();
}

function splitLiveTargetIdentity(rawTarget, rawBrowserInstanceId = "") {
  const target = normalizeToken(rawTarget);
  let browserInstanceId = normalizeToken(rawBrowserInstanceId);
  if (!target) {
    return { browser_instance_id: browserInstanceId, tab_id: "", key: "" };
  }

  let tabId = target;
  if (browserInstanceId && target.startsWith(`${browserInstanceId}:`)) {
    tabId = target.slice(browserInstanceId.length + 1);
  } else if (!browserInstanceId) {
    const separator = target.indexOf(":");
    if (separator > 0 && separator < target.length - 1) {
      browserInstanceId = target.slice(0, separator);
      tabId = target.slice(separator + 1);
    }
  }

  return {
    browser_instance_id: browserInstanceId,
    tab_id: tabId,
    key: browserInstanceId ? `${browserInstanceId}:${tabId}` : tabId,
  };
}

function scanLiveTargetIdentity(scanPayload = {}) {
  const metadata = scanPayload?.metadata ?? {};
  return splitLiveTargetIdentity(
    metadata.active_tab,
    metadata.active_browser_instance_id ?? metadata.selection?.browser_instance_id,
  );
}

function executeLiveTargetIdentity(executePayload = {}) {
  return splitLiveTargetIdentity(
    executePayload?.tab_id ?? executePayload?.session_id,
    executePayload?.active_browser_instance_id ?? executePayload?.selection?.browser_instance_id,
  );
}

function buildLiveTargetRoute(cli = {}) {
  const browserInstanceId = normalizeToken(cli.browser_instance_id);
  const route = browserInstanceId ? { browser_instance_id: browserInstanceId } : {};
  const targetTabId = String(cli.target_tab_id ?? "").trim();
  if (targetTabId) {
    return { ...route, switch_tab_id: targetTabId };
  }
  const targetUrlContains = String(cli.target_url_contains ?? "").trim();
  return targetUrlContains ? { ...route, target_url_contains: targetUrlContains } : route;
}

function assertLiveTargetIdentity({ cli = {}, scanPayload, executePayload }) {
  const expected = splitLiveTargetIdentity(cli.target_tab_id, cli.browser_instance_id);
  const expectedUrl = normalizeToken(cli.target_url_contains);
  const scan = scanLiveTargetIdentity(scanPayload);
  const execute = executeLiveTargetIdentity(executePayload);
  const actualUrl = normalizeToken(executePayload?.js_return?.href);

  if (expected.tab_id) {
    assert.equal(
      scan.tab_id,
      expected.tab_id,
      `live scan tab mismatch: expected=${expected.tab_id} actual=${scan.tab_id || "<none>"}`,
    );
    assert.equal(
      execute.tab_id,
      expected.tab_id,
      `live execute tab mismatch: expected=${expected.tab_id} actual=${execute.tab_id || "<none>"}`,
    );
  }
  if (expected.browser_instance_id) {
    assert.equal(
      scan.browser_instance_id,
      expected.browser_instance_id,
      `live scan browser instance mismatch: expected=${expected.browser_instance_id} actual=${scan.browser_instance_id || "<none>"}`,
    );
    assert.equal(
      execute.browser_instance_id,
      expected.browser_instance_id,
      `live execute browser instance mismatch: expected=${expected.browser_instance_id} actual=${execute.browser_instance_id || "<none>"}`,
    );
  }
  if (expectedUrl) {
    assert.equal(
      actualUrl.includes(expectedUrl),
      true,
      `live target URL mismatch: expected_contains=${expectedUrl} actual=${actualUrl || "<none>"}`,
    );
  }
  if (scan.key && execute.key) {
    assert.equal(
      execute.key,
      scan.key,
      `live scan/execute target drift: scan=${scan.key} execute=${execute.key}`,
    );
  }
}

export {
  assertLiveTargetIdentity,
  buildLiveTargetRoute,
  executeLiveTargetIdentity,
  scanLiveTargetIdentity,
  splitLiveTargetIdentity,
};
