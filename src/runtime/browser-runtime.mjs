import { randomId } from "./identity.mjs";
import { createTabScheduler } from "./tab-scheduler.mjs";

function createBrowserRuntime(options = {}) {
  const runtimeId = String(options.runtime_id || randomId("runtime"));
  const scheduler = options.scheduler ?? createTabScheduler();
  const disposables = [
    options.debuggerManager,
    options.networkObservations,
    options.ownershipStore,
    options.snapshotStore,
    options.sessionStore,
    options.transportRouter,
    options.jobStore,
    options.runStore,
  ].filter((item) => item && typeof item.dispose === "function");
  let disposed = false;

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
      disposable_count: disposables.length,
    };
  }

  async function dispose() {
    if (disposed) {
      return stats();
    }
    disposed = true;
    await scheduler.dispose();
    await Promise.allSettled(disposables.map((item) => item.dispose()));
    return stats();
  }

  return Object.freeze({
    runtime_id: runtimeId,
    assertActive,
    dispose,
    runForTab,
    scheduler,
    stats,
  });
}

export { createBrowserRuntime };
