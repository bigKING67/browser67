import { normalizeEndpoint } from "../common.mjs";
import { fetchCdpTargets } from "../cdp-runtime.mjs";
import {
  asShortTabs,
  syncSessionRegistry,
} from "../session-registry.mjs";

async function refreshSessionRegistry(args) {
  const targets = await fetchCdpTargets(normalizeEndpoint(args?.cdp_endpoint));
  syncSessionRegistry(targets);
  return asShortTabs(targets);
}

export { refreshSessionRegistry };
