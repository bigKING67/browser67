import { detectNativeInputCapabilities } from "../../src/native-capabilities/index.mjs";
import { buildNativePointerReadinessReport } from "../../src/native-capabilities/pointer-readiness.mjs";

async function nativePointerPreflight(options = {}) {
  const detectCapabilities = options.detectNativeInputCapabilities ?? detectNativeInputCapabilities;
  const capabilities = await detectCapabilities({
    refresh: true,
    cache_ttl_ms: 0,
  });
  return buildNativePointerReadinessReport(capabilities, {
    platform: options.platform ?? process.platform,
    include_readiness_command: true,
    missing_message: options.missing_message
      ?? "Run npm run check:native-pointer to confirm native click/drag readiness before the physical CAPTCHA gate.",
  });
}

export { nativePointerPreflight };
