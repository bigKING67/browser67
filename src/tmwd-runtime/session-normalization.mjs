import { normalizeIdToken } from "../runtime/sessions/registry.mjs";

function normalizeTmwdSessions(raw) {
  if (!Array.isArray(raw)) {
    return [];
  }
  return raw
    .map((item) => {
      if (typeof item !== "object" || item === null) {
        return null;
      }
      const id = normalizeIdToken(item.id ?? item.sessionId);
      if (!id) {
        return null;
      }
      const browserInstanceId = normalizeIdToken(item.browser_instance_id ?? item.browserInstanceId);
      const tabId = normalizeIdToken(item.tab_id ?? item.tabId ?? id);
      const sessionKey = normalizeIdToken(item.session_key ?? item.sessionKey)
        || (browserInstanceId ? `${browserInstanceId}:${tabId}` : id);
      return {
        id: sessionKey,
        tab_id: tabId,
        browser_instance_id: browserInstanceId,
        browser_instance_default: item.browser_instance_default === true,
        title: String(item.title ?? ""),
        url: String(item.url ?? ""),
        active: true,
        type: String(item.type ?? "ext_ws"),
      };
    })
    .filter((item) => item !== null);
}

function normalizeTmwdTabsPayload(raw) {
  if (Array.isArray(raw)) {
    return normalizeTmwdSessions(raw);
  }
  if (raw && typeof raw === "object" && Array.isArray(raw.data)) {
    return normalizeTmwdSessions(raw.data);
  }
  return [];
}

export {
  normalizeTmwdSessions,
  normalizeTmwdTabsPayload,
};
