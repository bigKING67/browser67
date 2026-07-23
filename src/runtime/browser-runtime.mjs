import { randomId } from "./identity.mjs";
import { createDownloadSessionStore } from "./downloads/store.mjs";
import { createAdoptionRuntime } from "./adoption/state.mjs";
import { createSessionRegistry } from "./sessions/registry.mjs";
import { createJobRuntimeState } from "./jobs/state.mjs";
import { createNetworkObservationStore } from "./network/observation-store.mjs";
import { createRunStore } from "./runs/store.mjs";
import { createTabScheduler } from "./tab-scheduler.mjs";
import { createSnapshotStore } from "../browser/content/snapshot-store.mjs";
import { createTmwdTransportHealthStore } from "../tmwd-runtime/health.mjs";
import { createTmwdWsRuntime } from "../tmwd-runtime/ws.mjs";

function createBrowserRuntime(options = {}) {
  const runtimeId = String(options.runtime_id || randomId("runtime"));
  const scheduler = options.scheduler ?? createTabScheduler();
  const sessionStore = options.sessionStore ?? createSessionRegistry(options.sessions);
  const snapshotStore = options.snapshotStore ?? createSnapshotStore(options.snapshots);
  const downloadStore = options.downloadStore ?? createDownloadSessionStore(options.downloads);
  const runStore = options.runStore ?? createRunStore(options.runs);
  const jobState = options.jobState ?? createJobRuntimeState();
  const networkObservations = options.networkObservations
    ?? createNetworkObservationStore(options.network_observations);
  const transportHealth = options.transportHealth ?? createTmwdTransportHealthStore(options.transport_health);
  const tmwdWsRuntime = options.tmwdWsRuntime ?? createTmwdWsRuntime({
    ...options.tmwd_ws,
    sessionStore,
  });
  let runtime;
  const adoptionRuntime = options.adoptionRuntime ?? createAdoptionRuntime({
    ...options.adoption,
    runtime_id: runtimeId,
    get_runtime: () => runtime,
  });
  const disposables = [
    jobState,
    adoptionRuntime,
    options.debuggerManager,
    networkObservations,
    options.ownershipStore,
    downloadStore,
    snapshotStore,
    sessionStore,
    transportHealth,
    tmwdWsRuntime,
    options.transportRouter,
    runStore,
  ].filter((item) => item && typeof item.dispose === "function");
  let disposed = false;
  const disposeErrors = [];

  function assertActive() {
    if (disposed) {
      throw new Error(`browser runtime ${runtimeId} is disposed`);
    }
  }

  async function runForTab(tabKey, callback) {
    assertActive();
    return scheduler.run(tabKey, callback);
  }

  function stats() {
    return {
      runtime_id: runtimeId,
      disposed,
      scheduler: scheduler.stats(),
      sessions: sessionStore.stats(),
      snapshots: snapshotStore.stats(),
      downloads: downloadStore.stats(),
      adoption: adoptionRuntime.stats(),
      jobs: jobState.stats(),
      network_observations: networkObservations.stats(),
      run_store: runStore.stats(),
      transport_health: transportHealth.stats(),
      tmwd_ws: tmwdWsRuntime.stats(),
      disposable_count: disposables.length,
      dispose_errors: [...disposeErrors],
    };
  }

  async function dispose() {
    if (disposed) {
      return stats();
    }
    disposed = true;
    await scheduler.dispose();
    for (const item of disposables) {
      try {
        await item.dispose();
      } catch (error) {
        disposeErrors.push(String(error?.message ?? error));
      }
    }
    return stats();
  }

  runtime = Object.freeze({
    runtime_id: runtimeId,
    assertActive,
    dispose,
    runForTab,
    adoptionRuntime,
    downloadStore,
    jobState,
    networkObservations,
    scheduler,
    sessionStore,
    snapshotStore,
    runStore,
    tmwdWsRuntime,
    transportHealth,
    stats,
  });
  return runtime;
}

export { createBrowserRuntime };
