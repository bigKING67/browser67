import { randomId } from "../../runtime/identity.mjs";
import { createCdpNetworkObserver } from "../../cdp-runtime/index.mjs";
import { createToolError } from "../../runtime/tool-errors.mjs";
import { defaultNetworkObservationStore } from "../../runtime/network/observation-store.mjs";
import { resolvePreferredBrowserContext } from "../../tmwd-runtime/index.mjs";
import { executeTmwdCommandWithPreferred } from "../../browser-wrappers/shared.mjs";

function normalizeOptions(args = {}) {
  return {
    idle_ms: Math.max(50, Math.min(30_000, Number(args.idle_ms ?? args.stable_ms ?? 750))),
    max_inflight: Math.max(0, Math.min(100, Number(args.max_inflight ?? 0))),
    interval_ms: Math.max(25, Math.min(5_000, Number(args.interval_ms ?? 100))),
    timeout_ms: Math.max(100, Math.min(120_000, Number(args.timeout_ms ?? 10_000))),
    ignore_patterns: Array.isArray(args.ignore_patterns)
      ? args.ignore_patterns.map((item) => String(item)).filter(Boolean).slice(0, 100)
      : [],
    ignore_resource_types: Array.isArray(args.ignore_resource_types)
      ? args.ignore_resource_types.map((item) => String(item)).filter(Boolean).slice(0, 50)
      : ["WebSocket", "EventSource"],
  };
}

function observationStore(runtimeOptions = {}) {
  return runtimeOptions.runtime?.networkObservations ?? defaultNetworkObservationStore;
}

function getNetworkObservation(observationId, runtimeOptions = {}) {
  return observationStore(runtimeOptions).get(observationId);
}

async function beginTmwdNetworkObservation(args, preferred, options, runtimeOptions = {}) {
  const store = observationStore(runtimeOptions);
  const tabId = String(preferred.context?.target?.id ?? "");
  const observationId = randomId("network_observation");
  const observed = await executeTmwdCommandWithPreferred(args, preferred, {
    cmd: "network",
    method: "observe",
    tabId,
    observationId,
    ignorePatterns: options.ignore_patterns,
    ignoreResourceTypes: options.ignore_resource_types,
  }, runtimeOptions);
  if (observed.value?.observing !== true) {
    throw createToolError("NETWORK_OBSERVATION_UNAVAILABLE", "TMWD extension did not start network observation", {
      retryable: true,
      details: observed.value,
    }, runtimeOptions);
  }

  async function snapshot() {
    const status = await executeTmwdCommandWithPreferred(args, preferred, {
      cmd: "network",
      method: "status",
      tabId,
      observationId,
    }, runtimeOptions);
    return {
      schema: "browser67.network-observation.v1",
      network_observation_id: observationId,
      tab_id: tabId,
      transport: status.transport,
      coverage: "from_observation_start",
      ...status.value,
    };
  }

  async function waitForIdle(waitOptions = {}) {
    const normalized = { ...options, ...normalizeOptions(waitOptions) };
    const deadline = Date.now() + normalized.timeout_ms;
    while (Date.now() < deadline) {
      const current = await snapshot();
      if (
        Number(current.inflight_count ?? 0) <= normalized.max_inflight
        && Number(current.quiet_for_ms ?? 0) >= normalized.idle_ms
      ) {
        return {
          status: "passed",
          idle_ms: normalized.idle_ms,
          max_inflight: normalized.max_inflight,
          ...current,
        };
      }
      await new Promise((resolve) => setTimeout(resolve, normalized.interval_ms));
    }
    return {
      status: "timeout",
      idle_ms: normalized.idle_ms,
      max_inflight: normalized.max_inflight,
      ...await snapshot(),
    };
  }

  async function stop() {
    const stopped = await executeTmwdCommandWithPreferred(args, preferred, {
      cmd: "network",
      method: "unobserve",
      tabId,
      observationId,
    });
    return store.remember({
      schema: "browser67.network-observation.v1",
      network_observation_id: observationId,
      tab_id: tabId,
      transport: stopped.transport,
      coverage: "from_observation_start",
      ...stopped.value,
    });
  }

  return Object.freeze({ network_observation_id: observationId, snapshot, stop, waitForIdle });
}

async function beginNetworkObservation(args = {}, runtimeOptions = {}) {
  const options = normalizeOptions(args);
  const preferred = runtimeOptions.preferred ?? await resolvePreferredBrowserContext(args, runtimeOptions);
  if (preferred.transport === "cdp") {
    const store = observationStore(runtimeOptions);
    const observer = await createCdpNetworkObserver({
      ...args,
      switch_tab_id: preferred.context.target.id,
    }, { ...options, ...runtimeOptions });
    return Object.freeze({
      network_observation_id: observer.network_observation_id,
      snapshot: observer.snapshot,
      waitForIdle: observer.waitForIdle,
      async stop() {
        return store.remember(await observer.stop());
      },
    });
  }
  if (preferred.transport === "tmwd_ws" || preferred.transport === "tmwd_link") {
    return beginTmwdNetworkObservation(args, preferred, options, runtimeOptions);
  }
  throw createToolError("NETWORK_OBSERVATION_UNAVAILABLE", "selected transport cannot observe requests", {
    retryable: true,
  });
}

async function waitForNetworkIdle(args = {}, runtimeOptions = {}) {
  const observer = await beginNetworkObservation(args, runtimeOptions);
  try {
    return await observer.waitForIdle(args);
  } finally {
    await observer.stop();
  }
}

export {
  beginNetworkObservation,
  getNetworkObservation,
  normalizeOptions as normalizeNetworkObservationOptions,
  waitForNetworkIdle,
};
