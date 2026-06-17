function extractTabId(raw) {
  const candidates = [
    raw?.id,
    raw?.tabId,
    raw?.tab_id,
    raw?.data?.id,
    raw?.data?.tabId,
    raw?.data?.tab_id,
  ];
  for (const candidate of candidates) {
    const value = String(candidate ?? "").trim();
    if (value) {
      return value;
    }
  }
  return "";
}

function normalizeTabs(raw) {
  const rows = Array.isArray(raw)
    ? raw
    : (Array.isArray(raw?.data) ? raw.data : []);
  return rows.map((row) => ({
    id: String(row?.id ?? row?.tabId ?? row?.tab_id ?? ""),
    url: String(row?.url ?? ""),
    title: String(row?.title ?? ""),
    active: row?.active === true,
    scriptable: row?.scriptable === true || /^https?:/.test(String(row?.url ?? "")),
  })).filter((row) => row.id.length > 0);
}

async function waitFor(condition, timeoutMs, pollMs = 100) {
  const startedAt = Date.now();
  let latest;
  const poll = async () => {
    if (Date.now() - startedAt > timeoutMs) {
      return latest ?? { ok: false, reason: "timeout" };
    }
    latest = await condition();
    if (latest?.ok === true) {
      return latest;
    }
    await new Promise((resolvePromise) => setTimeout(resolvePromise, pollMs));
    return await poll();
  };
  return await poll();
}

export {
  extractTabId,
  normalizeTabs,
  waitFor,
};
