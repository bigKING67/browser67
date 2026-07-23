import { normalizeEndpoint } from "../runtime/config/endpoints.mjs";
import { fetchCdpTargets } from "../cdp-runtime/index.mjs";
import { defaultSessionRegistry } from "../runtime/sessions/registry.mjs";

async function refreshSessionRegistry(args, options = {}) {
  const sessionStore = options.runtime?.sessionStore ?? defaultSessionRegistry;
  const targets = await fetchCdpTargets(normalizeEndpoint(args?.cdp_endpoint));
  sessionStore.sync(targets);
  return sessionStore.asShortTabs(targets);
}

export { refreshSessionRegistry };
