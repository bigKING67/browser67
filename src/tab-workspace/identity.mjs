const LEGACY_BROWSER_INSTANCE_KEY = "__browser67_legacy_unresolved__";

function normalizeBrowserInstanceId(raw) {
  const value = String(raw ?? "").trim();
  return value.length > 0
    && value.length <= 128
    && /^[A-Za-z0-9._-]+$/u.test(value)
    ? value
    : "";
}

function normalizeBrowserTabId(raw) {
  return String(raw ?? "").trim();
}

function browserInstanceIdFrom(value = {}) {
  return normalizeBrowserInstanceId(value.browser_instance_id ?? value.browserInstanceId);
}

function browserTabIdFrom(value = {}) {
  return normalizeBrowserTabId(value.tab_id ?? value.tabId ?? value.id ?? value.sessionId);
}

function browserTabKey(value, browserInstanceId = "") {
  const input = value && typeof value === "object" ? value : { tab_id: value, browser_instance_id: browserInstanceId };
  const tabId = browserTabIdFrom(input);
  if (!tabId) return "";
  const instanceId = browserInstanceIdFrom(input);
  return `${instanceId || LEGACY_BROWSER_INSTANCE_KEY}:${tabId}`;
}

function sameBrowserTab(left, right) {
  const leftKey = browserTabKey(left);
  return Boolean(leftKey && leftKey === browserTabKey(right));
}

export {
  LEGACY_BROWSER_INSTANCE_KEY,
  browserInstanceIdFrom,
  browserTabIdFrom,
  browserTabKey,
  normalizeBrowserInstanceId,
  normalizeBrowserTabId,
  sameBrowserTab,
};
