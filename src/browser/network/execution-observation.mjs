import { beginNetworkObservation } from "./observation.mjs";

async function beginExecutionNetworkObservation(args = {}, preferred, runtimeOptions = {}) {
  const options = args?.network_observation?.enabled === true
    ? args.network_observation
    : null;
  if (!options) {
    return null;
  }
  const tabId = preferred.context.target.id;
  const observer = await beginNetworkObservation({
    ...args,
    ...options,
    tab_id: tabId,
    switch_tab_id: tabId,
    session_id: tabId,
    timeout_ms: options.ttl_ms ?? args.timeout_ms,
  }, { ...runtimeOptions, preferred });
  return Object.freeze({
    observer,
    options,
    timeout_ms: options.ttl_ms ?? args.timeout_ms,
  });
}

async function finishExecutionNetworkObservation(executionObservation) {
  if (!executionObservation) {
    return undefined;
  }
  const { observer, options, timeout_ms: timeoutMs } = executionObservation;
  let idleResult;
  let finalResult;
  let error = "";
  try {
    idleResult = await observer.waitForIdle({
      ...options,
      timeout_ms: timeoutMs,
    });
  } catch (observationFailure) {
    error = String(observationFailure?.message ?? observationFailure);
  }
  try {
    finalResult = await observer.stop();
  } catch (stopFailure) {
    error = error || String(stopFailure?.message ?? stopFailure);
  }
  return {
    network_observation_id: observer.network_observation_id,
    summary: {
      ...finalResult,
      idle_status: idleResult?.status,
      idle_ms: idleResult?.idle_ms,
      max_inflight: idleResult?.max_inflight,
      error: error || undefined,
    },
  };
}

export {
  beginExecutionNetworkObservation,
  finishExecutionNetworkObservation,
};
