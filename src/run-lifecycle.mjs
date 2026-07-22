import {
  DEFAULT_RUN_ROOT,
  RUN_SCHEMA_VERSION,
  configuredRunRoot,
  getDefaultRunStore,
} from "./runtime/runs/store.mjs";

function runRoot() {
  return configuredRunRoot();
}

function runDirFor(args = {}) {
  return getDefaultRunStore().runDir(args);
}

async function prepareRun(args = {}) {
  return getDefaultRunStore().prepare(args);
}

async function handleBrowserRunOps(args = {}) {
  const action = String(args.action ?? "status");
  const store = getDefaultRunStore();
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
};
