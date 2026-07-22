import { normalizeEndpoint } from "../common.mjs";
import {
  listSessionsSnapshot,
  markSessionSelected,
  selectTargetFromCandidates,
  sessionPointers,
  syncSessionRegistry,
} from "../session-registry.mjs";

async function fetchCdpTargets(endpoint) {
  const response = await fetch(`${endpoint}/json/list`);
  if (!response.ok) {
    throw new Error(`cdp /json/list failed status=${String(response.status)}`);
  }
  const data = await response.json();
  if (!Array.isArray(data)) {
    throw new Error("cdp /json/list returned invalid payload");
  }
  return data
    .filter((item) => item?.type === "page" && typeof item?.webSocketDebuggerUrl === "string")
    .map((item) => ({
      id: String(item.id ?? ""),
      title: String(item.title ?? ""),
      url: String(item.url ?? ""),
      webSocketDebuggerUrl: String(item.webSocketDebuggerUrl),
      active: item.active === true,
    }))
    .filter((item) => item.id.length > 0 && item.webSocketDebuggerUrl.length > 0);
}

async function resolveTarget(args) {
  const endpoint = normalizeEndpoint(args?.cdp_endpoint);
  const targets = await fetchCdpTargets(endpoint);
  if (targets.length === 0) {
    throw new Error("no CDP page targets found");
  }
  syncSessionRegistry(targets);
  const picked = selectTargetFromCandidates(targets, args);
  const selected = picked.target;
  markSessionSelected(selected.id, { make_default: false });
  return {
    endpoint,
    targets,
    target: selected,
    selection: picked.selection,
    sessions: listSessionsSnapshot(),
    pointers: sessionPointers(),
  };
}

export { fetchCdpTargets, resolveTarget };
