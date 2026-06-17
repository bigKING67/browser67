import {
  clearNativeInputCapabilitiesCache,
  nativeCapabilityCacheKey,
  normalizeCacheTtlMs,
  readNativeInputCapabilitiesCache,
  writeNativeInputCapabilitiesCache,
} from "./cache.mjs";
import { detectNativeInputCapabilitiesUncached } from "./platforms.mjs";

async function detectNativeInputCapabilities(options = {}) {
  const ttlMs = normalizeCacheTtlMs(options?.cache_ttl_ms);
  const cacheKey = nativeCapabilityCacheKey();
  const cached = readNativeInputCapabilitiesCache(cacheKey, ttlMs, options);
  if (cached) {
    return cached;
  }
  const payload = await detectNativeInputCapabilitiesUncached();
  writeNativeInputCapabilitiesCache(cacheKey, ttlMs, payload);
  return payload;
}

export {
  clearNativeInputCapabilitiesCache,
  detectNativeInputCapabilities,
};
