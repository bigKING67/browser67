const DEFAULT_TIMEOUT_MS = 20_000;
const DEFAULT_SCAN_MAX_CHARS = 35_000;

function normalizeTimeoutMs(raw) {
  const parsed = Number(raw ?? DEFAULT_TIMEOUT_MS);
  if (!Number.isFinite(parsed)) return DEFAULT_TIMEOUT_MS;
  return Math.max(100, Math.min(120_000, Math.floor(parsed)));
}

function normalizeMaxChars(raw) {
  const parsed = Number(raw ?? DEFAULT_SCAN_MAX_CHARS);
  if (!Number.isFinite(parsed)) return DEFAULT_SCAN_MAX_CHARS;
  return Math.max(1_000, Math.min(300_000, Math.floor(parsed)));
}

export {
  DEFAULT_SCAN_MAX_CHARS,
  DEFAULT_TIMEOUT_MS,
  normalizeMaxChars,
  normalizeTimeoutMs,
};
