import assert from "node:assert/strict";
import {
  clearNativeInputCapabilitiesCache,
  detectNativeInputCapabilities,
} from "../../src/native-capabilities.mjs";
import { detectPhysicalInputCapabilities } from "../../src/physical-input/index.mjs";

async function assertNativeCapabilitySurface() {
  clearNativeInputCapabilitiesCache();
  const uncachedNativeCapabilities = await detectNativeInputCapabilities({
    cache_ttl_ms: 60_000,
    refresh: true,
  });
  const cachedNativeCapabilities = await detectNativeInputCapabilities({
    cache_ttl_ms: 60_000,
  });
  const physicalInputCapabilities = await detectPhysicalInputCapabilities({
    action: "drag",
    preferred_provider: "auto",
  });

  assert.equal(Array.isArray(physicalInputCapabilities.providers), true);
  assert.equal(
    physicalInputCapabilities.providers.some((provider) => provider.provider_id === "native-os"),
    true,
  );
  assert.equal(
    physicalInputCapabilities.providers.some((provider) => provider.provider_id === "ljq-ctrl"),
    true,
  );
  assert.equal(
    typeof physicalInputCapabilities.providers.find((provider) => provider.provider_id === "ljq-ctrl")?.cache?.status,
    "string",
  );
  assert.equal(typeof physicalInputCapabilities.provider_selection?.reason, "string");
  assert.equal(
    physicalInputCapabilities.capture_provider_selection?.action,
    "capture_window_region",
  );
  assert.equal(typeof physicalInputCapabilities.capture_provider_selection?.reason, "string");
  assert.deepEqual(
    cachedNativeCapabilities.supported_actions,
    uncachedNativeCapabilities.supported_actions,
  );
  assert.deepEqual(
    cachedNativeCapabilities.unsupported_actions,
    uncachedNativeCapabilities.unsupported_actions,
  );
}

export { assertNativeCapabilitySurface };
