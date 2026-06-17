import { normalizeIdToken } from "../session-registry.mjs";

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
      return {
        id,
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
