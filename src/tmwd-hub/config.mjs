const DEFAULT_HOST = "127.0.0.1";
const DEFAULT_WS_PORT = 18765;
const DEFAULT_LINK_PORT = 18766;
const DEFAULT_REQUEST_TIMEOUT_MS = 20_000;
const DEFAULT_SESSION_TTL_MS = 10 * 60 * 1000;

function normalizePort(raw, fallback) {
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }
  const value = Math.floor(parsed);
  if (value < 1 || value > 65535) {
    return fallback;
  }
  return value;
}

function normalizePositiveInt(raw, fallback) {
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }
  const value = Math.floor(parsed);
  if (value <= 0) {
    return fallback;
  }
  return value;
}

function readHubConfig(env = process.env) {
  return {
    host: String(env.TMWD_HUB_HOST ?? DEFAULT_HOST).trim() || DEFAULT_HOST,
    wsPort: normalizePort(env.TMWD_HUB_WS_PORT, DEFAULT_WS_PORT),
    linkPort: normalizePort(env.TMWD_HUB_LINK_PORT, DEFAULT_LINK_PORT),
    requestTimeoutMs: normalizePositiveInt(env.TMWD_HUB_REQUEST_TIMEOUT_MS, DEFAULT_REQUEST_TIMEOUT_MS),
    sessionTtlMs: normalizePositiveInt(env.TMWD_HUB_SESSION_TTL_MS, DEFAULT_SESSION_TTL_MS),
  };
}

export {
  DEFAULT_HOST,
  DEFAULT_LINK_PORT,
  DEFAULT_REQUEST_TIMEOUT_MS,
  DEFAULT_SESSION_TTL_MS,
  DEFAULT_WS_PORT,
  normalizePort,
  normalizePositiveInt,
  readHubConfig,
};
