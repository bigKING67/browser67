import { createToolError } from "../tool-errors.mjs";

const MAX_NETWORK_OBSERVATIONS = 64;
const NETWORK_OBSERVATION_TTL_MS = 5 * 60_000;

function createNetworkObservationStore(options = {}) {
  const maxObservations = Math.max(1, Number(options.max_observations ?? MAX_NETWORK_OBSERVATIONS));
  const ttlMs = Math.max(1_000, Number(options.ttl_ms ?? NETWORK_OBSERVATION_TTL_MS));
  const observations = new Map();

  function prune(reservedSlots = 0) {
    const now = Date.now();
    for (const [id, entry] of observations) {
      if (entry.expires_at_ms <= now) observations.delete(id);
    }
    while (observations.size > Math.max(0, maxObservations - reservedSlots)) {
      observations.delete(observations.keys().next().value);
    }
  }

  function remember(observation) {
    prune(1);
    observations.set(observation.network_observation_id, {
      value: Object.freeze(observation),
      expires_at_ms: Date.now() + ttlMs,
    });
    return observation;
  }

  function get(observationId) {
    prune();
    const normalized = String(observationId ?? "");
    const entry = observations.get(normalized);
    if (!entry) {
      throw createToolError("NETWORK_OBSERVATION_NOT_FOUND", "network observation is missing or expired", {
        retryable: false,
      });
    }
    return entry.value;
  }

  function stats() {
    prune();
    return { observation_count: observations.size, max_observations: maxObservations, ttl_ms: ttlMs };
  }

  function reset() {
    observations.clear();
  }

  async function dispose() {
    reset();
  }

  return Object.freeze({ dispose, get, remember, reset, stats });
}

const defaultNetworkObservationStore = createNetworkObservationStore();

export {
  MAX_NETWORK_OBSERVATIONS,
  NETWORK_OBSERVATION_TTL_MS,
  createNetworkObservationStore,
  defaultNetworkObservationStore,
};
