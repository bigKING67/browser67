const DEFAULT_DOWNLOAD_SESSION_TTL_MS = 60 * 60_000;
const MAX_DOWNLOAD_SESSIONS = 64;

function createDownloadSessionStore(options = {}) {
  const ttlMs = Math.max(1_000, Number(options.ttl_ms ?? DEFAULT_DOWNLOAD_SESSION_TTL_MS));
  const maxSessions = Math.max(1, Number(options.max_sessions ?? MAX_DOWNLOAD_SESSIONS));
  const sessions = new Map();

  function prune(reservedSlots = 0) {
    const now = Date.now();
    for (const [token, session] of sessions) {
      if (Number(session.expires_at_ms ?? 0) <= now) sessions.delete(token);
    }
    while (sessions.size > Math.max(0, maxSessions - reservedSlots)) {
      sessions.delete(sessions.keys().next().value);
    }
  }

  function put(session) {
    prune(1);
    const token = String(session?.token ?? "").trim();
    if (!token) throw new Error("download session requires token");
    const value = Object.freeze({
      ...session,
      expires_at_ms: Date.now() + ttlMs,
    });
    sessions.set(token, value);
    return value;
  }

  function get(token) {
    prune();
    return sessions.get(String(token ?? "").trim()) ?? null;
  }

  function stats() {
    prune();
    return { session_count: sessions.size, max_sessions: maxSessions, ttl_ms: ttlMs };
  }

  function reset() {
    sessions.clear();
  }

  async function dispose() {
    reset();
  }

  return Object.freeze({ dispose, get, put, reset, stats });
}

const defaultDownloadSessionStore = createDownloadSessionStore();

export {
  DEFAULT_DOWNLOAD_SESSION_TTL_MS,
  MAX_DOWNLOAD_SESSIONS,
  createDownloadSessionStore,
  defaultDownloadSessionStore,
};
