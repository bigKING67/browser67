import path from "node:path";

import { createJobStore } from "./store.mjs";

function createJobRuntimeState() {
  const jobs = new Map();
  const stores = new Map();
  const state = {
    jobs,
    recoveryPromise: null,
    recoveryRunRoot: "",
    disposed: false,
    getStore(runRoot) {
      if (state.disposed) throw new Error("job runtime state is disposed");
      const resolved = path.resolve(runRoot);
      if (!stores.has(resolved)) stores.set(resolved, createJobStore({ run_root: resolved }));
      return stores.get(resolved);
    },
    stats() {
      return {
        job_count: jobs.size,
        store_count: stores.size,
        recovery_pending: Boolean(state.recoveryPromise),
        running_promise_count: Array.from(jobs.values())
          .filter((job) => job?.promise && typeof job.promise.then === "function")
          .length,
        disposed: state.disposed,
      };
    },
    reset() {
      jobs.clear();
      stores.clear();
      state.recoveryPromise = null;
      state.recoveryRunRoot = "";
    },
    async dispose() {
      if (state.disposed) return state.stats();
      const running = Array.from(jobs.values())
        .map((job) => job?.promise)
        .filter((promise) => promise && typeof promise.then === "function");
      await Promise.allSettled(running);
      await Promise.allSettled(Array.from(stores.values()).map((store) => store.dispose?.()));
      state.disposed = true;
      jobs.clear();
      stores.clear();
      state.recoveryPromise = null;
      state.recoveryRunRoot = "";
      return state.stats();
    },
  };
  return state;
}

const defaultJobRuntimeState = createJobRuntimeState();

export { createJobRuntimeState, defaultJobRuntimeState };
