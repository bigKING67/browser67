const DEFAULT_NATIVE_CAPABILITIES_CACHE_TTL_MS = 5_000;

let nativeCapabilitiesCache = null;

function normalizeCacheTtlMs(raw) {
  const parsed = Number(raw ?? DEFAULT_NATIVE_CAPABILITIES_CACHE_TTL_MS);
  if (!Number.isFinite(parsed)) {
    return DEFAULT_NATIVE_CAPABILITIES_CACHE_TTL_MS;
  }
  return Math.max(0, Math.min(60_000, Math.round(parsed)));
}

function nativeCapabilityCacheKey() {
  return [
    process.platform,
    process.env.PATH ?? "",
    process.env.DISPLAY ?? "",
    process.env.WAYLAND_DISPLAY ?? "",
  ].join("\0");
}

function cloneCapabilities(payload) {
  return {
    ...payload,
    checks: { ...(payload.checks ?? {}) },
    supported_actions: Array.isArray(payload.supported_actions) ? [...payload.supported_actions] : [],
    unsupported_actions: Array.isArray(payload.unsupported_actions) ? [...payload.unsupported_actions] : [],
    requirements: Array.isArray(payload.requirements) ? [...payload.requirements] : [],
    permission_notes: Array.isArray(payload.permission_notes) ? [...payload.permission_notes] : [],
  };
}

function clearNativeInputCapabilitiesCache() {
  nativeCapabilitiesCache = null;
}

function readNativeInputCapabilitiesCache(cacheKey, ttlMs, options = {}) {
  if (
    options?.refresh !== true
    && ttlMs > 0
    && nativeCapabilitiesCache?.key === cacheKey
    && nativeCapabilitiesCache.expires_at > Date.now()
  ) {
    return cloneCapabilities(nativeCapabilitiesCache.payload);
  }
  return null;
}

function writeNativeInputCapabilitiesCache(cacheKey, ttlMs, payload) {
  if (ttlMs <= 0) {
    return;
  }
  nativeCapabilitiesCache = {
    key: cacheKey,
    expires_at: Date.now() + ttlMs,
    payload: cloneCapabilities(payload),
  };
}

export {
  clearNativeInputCapabilitiesCache,
  nativeCapabilityCacheKey,
  normalizeCacheTtlMs,
  readNativeInputCapabilitiesCache,
  writeNativeInputCapabilitiesCache,
};
