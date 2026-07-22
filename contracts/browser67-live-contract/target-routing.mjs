import assert from "node:assert/strict";

function buildLiveTargetRoute(cli = {}) {
  const targetTabId = String(cli.target_tab_id ?? "").trim();
  if (targetTabId) {
    return { switch_tab_id: targetTabId };
  }
  const targetUrlContains = String(cli.target_url_contains ?? "").trim();
  return targetUrlContains ? { target_url_contains: targetUrlContains } : {};
}

function assertLiveTargetIdentity({ cli = {}, scanPayload, executePayload }) {
  const expectedTabId = String(cli.target_tab_id ?? "").trim();
  const expectedUrl = String(cli.target_url_contains ?? "").trim();
  const scanTabId = String(scanPayload?.metadata?.active_tab ?? "").trim();
  const executeTabId = String(executePayload?.tab_id ?? executePayload?.session_id ?? "").trim();
  const actualUrl = String(executePayload?.js_return?.href ?? "").trim();

  if (expectedTabId) {
    assert.equal(
      scanTabId,
      expectedTabId,
      `live scan target mismatch: expected=${expectedTabId} actual=${scanTabId || "<none>"}`,
    );
    assert.equal(
      executeTabId,
      expectedTabId,
      `live execute target mismatch: expected=${expectedTabId} actual=${executeTabId || "<none>"}`,
    );
  }
  if (expectedUrl) {
    assert.equal(
      actualUrl.includes(expectedUrl),
      true,
      `live target URL mismatch: expected_contains=${expectedUrl} actual=${actualUrl || "<none>"}`,
    );
  }
  if (scanTabId && executeTabId) {
    assert.equal(
      executeTabId,
      scanTabId,
      `live scan/execute target drift: scan=${scanTabId} execute=${executeTabId}`,
    );
  }
}

export {
  assertLiveTargetIdentity,
  buildLiveTargetRoute,
};
