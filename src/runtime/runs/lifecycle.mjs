import {
  DEFAULT_RUN_ROOT,
  RUN_SCHEMA_VERSION,
  configuredRunRoot,
  getDefaultRunStore,
} from "./store.mjs";

function runRoot(options = {}) {
  return options.runtime?.runStore?.root ?? options.runStore?.root ?? configuredRunRoot();
}

function runStoreFor(options = {}) {
  return options.runtime?.runStore ?? options.runStore ?? getDefaultRunStore();
}

function runDirFor(args = {}, options = {}) {
  return runStoreFor(options).runDir(args);
}

async function prepareRun(args = {}, options = {}) {
  return runStoreFor(options).prepare(args);
}

async function handleBrowserRunOps(args = {}, options = {}) {
  const action = String(args.action ?? "status");
  const store = runStoreFor(options);
  if (action === "prepare") return store.prepare(args);
  if (action === "status") return store.status(args);
  if (action === "record_event") return store.recordEvent(args);
  if (action === "finish") return store.finish(args);
  if (action === "list") return store.list(args);
  return { ok: false, action, error: `unknown browser_run_ops action: ${action}` };
}

export {
  DEFAULT_RUN_ROOT,
  RUN_SCHEMA_VERSION,
  handleBrowserRunOps,
  prepareRun,
  runDirFor,
  runRoot,
  runStoreFor,
};
