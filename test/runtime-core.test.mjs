import assert from "node:assert/strict";
import test from "node:test";
import vm from "node:vm";

import {
  batchReferenceError,
  extensionBatchReferenceSource,
  resolveBatchPath,
  resolveBatchReferences,
} from "../src/browser/execution/batch-references.mjs";
import {
  buildCdpScript,
  buildPageScript,
  extensionPageExecutionSource,
} from "../src/browser/execution/page-script.mjs";
import { createSnapshotStore } from "../src/browser/content/snapshot-store.mjs";
import { createAdoptionRuntime } from "../src/runtime/adoption/state.mjs";
import { createDownloadSessionStore } from "../src/runtime/downloads/store.mjs";
import { createNetworkObservationStore } from "../src/runtime/network/observation-store.mjs";
import {
  compactToolData,
  compactTransportAttempts,
  resolveOutputMode,
} from "../src/runtime/output-mode.mjs";
import { resolvePageContext, resolvePageId } from "../src/runtime/page-context.mjs";
import {
  asShortTabs,
  createSessionRegistry,
  defaultSessionRegistry,
  getActiveTargetId,
  listSessionsSnapshot,
  markSessionSelected,
  resolveSessionByPattern,
  selectTargetFromCandidates,
  sessionPointers,
  syncSessionRegistry,
} from "../src/runtime/sessions/registry.mjs";
import { createTabScheduler } from "../src/runtime/tab-scheduler.mjs";
import { createTmwdTransportHealthStore } from "../src/tmwd-runtime/health.mjs";
import {
  capabilityPayload,
  summarizeCapabilities,
} from "../src/native-deps-setup/capabilities.mjs";

function hasErrorCode(error, code) {
  if (!error || typeof error !== "object") return false;
  const candidate = /** @type {Record<string, any>} */ (error);
  return candidate.code === code || candidate.errorCode === code;
}

test("batch references resolve recursively without mutating input", () => {
  const command = {
    params: {
      id: "$0.data.nodes.0.id",
      object: "$0.data.nodes.0",
      literal: "prefix-$0.data.nodes.0.id",
    },
  };
  const results = [{ data: { nodes: [{ id: "node-1" }] } }];
  assert.deepEqual(resolveBatchReferences(command, results), {
    params: {
      id: "node-1",
      object: { id: "node-1" },
      literal: "prefix-$0.data.nodes.0.id",
    },
  });
  assert.equal(command.params.id, "$0.data.nodes.0.id");
  assert.equal(resolveBatchPath(results[0], "data.nodes.0.id", "$0.data.nodes.0.id"), "node-1");
  assert.deepEqual(resolveBatchReferences("$0", results), results[0]);
  const nullPrototype = Object.assign(Object.create(null), { value: "$0.data.nodes.0.id" });
  assert.deepEqual(resolveBatchReferences(nullPrototype, results), { value: "node-1" });
  assert.match(extensionBatchReferenceSource(), /browser67ResolveBatchReferences/);
  assert.equal(batchReferenceError("CODE", "message").code, "CODE");
});

test("batch references reject unavailable, cyclic, and unsupported values", () => {
  assert.throws(
    () => resolveBatchReferences("$1.data", [{}], { command_index: 1 }),
    (error) => hasErrorCode(error, "BATCH_REFERENCE_INDEX_UNAVAILABLE"),
  );
  assert.throws(
    () => resolveBatchReferences("$0.missing", [{}]),
    (error) => hasErrorCode(error, "BATCH_REFERENCE_PATH_UNRESOLVED"),
  );
  assert.throws(
    () => resolveBatchPath({ value: null }, "value.missing", "$0.value.missing"),
    (error) => hasErrorCode(error, "BATCH_REFERENCE_PATH_UNRESOLVED"),
  );
  assert.throws(
    () => resolveBatchPath({ values: [] }, "values.1", "$0.values.1"),
    (error) => hasErrorCode(error, "BATCH_REFERENCE_PATH_UNRESOLVED"),
  );
  const cyclic = {};
  cyclic.self = cyclic;
  assert.throws(
    () => resolveBatchReferences(cyclic, []),
    (error) => hasErrorCode(error, "BATCH_REFERENCE_CYCLE"),
  );
  assert.throws(
    () => resolveBatchReferences({ value: 1n }, []),
    (error) => hasErrorCode(error, "BATCH_REFERENCE_UNSUPPORTED_VALUE"),
  );
  assert.throws(
    () => resolveBatchReferences(new Date(), []),
    (error) => hasErrorCode(error, "BATCH_REFERENCE_UNSUPPORTED_VALUE"),
  );
});

test("page script serializes DOM-like and error results", async () => {
  const context = vm.createContext({
    document: {},
    HTMLCollection: class HTMLCollection {},
    jQuery: class jQuery {},
    NodeList: class NodeList {},
    Promise,
    window: null,
  });
  context.window = context;
  const arrayLike = await vm.runInContext(
    buildCdpScript("({0:{nodeType:1,outerHTML:'<button>A</button>'},length:1})"),
    context,
  );
  assert.deepEqual(JSON.parse(JSON.stringify(arrayLike)), {
    ok: true,
    data: ["<button>A</button>"],
  });
  const failure = await vm.runInContext(buildCdpScript("throw new Error('fixture')"), context);
  assert.equal(failure.ok, false);
  assert.equal(failure.error.message, "fixture");
  assert.deepEqual(JSON.parse(JSON.stringify(await vm.runInContext(
    buildCdpScript("({nodeType:1,outerHTML:'<main>Main</main>'})"),
    context,
  ))), { ok: true, data: "<main>Main</main>" });
  assert.deepEqual(JSON.parse(JSON.stringify(await vm.runInContext(
    buildCdpScript("Object.assign(new NodeList(), {0:{nodeType:1,outerHTML:'<p>P</p>'},length:1})"),
    context,
  ))), { ok: true, data: ["<p>P</p>"] });
  assert.deepEqual(JSON.parse(JSON.stringify(await vm.runInContext(
    buildCdpScript("Object.assign(new jQuery(), {0:{nodeType:1,outerHTML:'<a>A</a>'},length:1})"),
    context,
  ))), { ok: true, data: ["<a>A</a>"] });
  assert.equal((await vm.runInContext(buildCdpScript("window"), context)).data.startsWith("[Window:"), true);
  assert.equal((await vm.runInContext(buildCdpScript("document"), context)).data, "[Object]");
  assert.equal((await vm.runInContext(buildCdpScript("Promise.resolve(7)"), context)).data, 7);
  assert.equal((await vm.runInContext(buildCdpScript("return 9"), context)).data, 9);
  assert.equal((await vm.runInContext(
    buildCdpScript("const value = await Promise.resolve(11);\nvalue"),
    context,
  )).data, 11);
  const circular = await vm.runInContext(buildCdpScript("(() => { const value = {}; value.self = value; return value; })()"), context);
  assert.match(circular.data, /^\[无法序列化:/);
  const csp = await vm.runInContext(
    buildPageScript("throw new Error('Refused to evaluate because unsafe-eval is disabled')"),
    context,
  );
  assert.equal(csp.csp, true);
  assert.match(extensionPageExecutionSource(), /browser67 generated page execution core/);
});

test("session registry selects targets, retains pointers, and enforces bounds", async () => {
  const store = createSessionRegistry({ max_records: 3, retain_ms: 0 });
  store.sync([
    { id: "a", url: "https://a.example/", title: "A", active: true },
    { id: "b", url: "https://b.example/", title: "B", active: false },
  ]);
  assert.equal(store.getActiveTargetId(), "a");
  assert.equal(store.selectTarget(store.list(), { tab_id: "b" }).target.id, "b");
  assert.throws(() => store.selectTarget(store.list(), { tab_id: "missing" }), /tab not found/);
  store.select("b", { make_default: true });
  assert.equal(store.sessionPointers().default_session_id, "b");
  assert.equal(store.resolveByPattern(store.list(), "b.example").length, 1);
  assert.equal(store.asShortTabs(store.list())[0].url.length > 0, true);
  store.sync(Array.from({ length: 10 }, (_value, index) => ({
    id: `tab-${index}`,
    url: `https://example.test/${index}`,
    title: `Tab ${index}`,
    active: index === 0,
  })));
  assert.equal(store.stats().session_count, 3);
  await store.dispose();
  assert.equal(store.stats().session_count, 0);
});

test("default session compatibility surface delegates to the canonical store", () => {
  defaultSessionRegistry.reset();
  syncSessionRegistry([{ id: "compat", url: "https://compat.example/", title: "Compat", active: true }]);
  assert.equal(getActiveTargetId(), "compat");
  assert.equal(listSessionsSnapshot().length, 1);
  assert.equal(resolveSessionByPattern(listSessionsSnapshot(), "compat.example").length, 1);
  assert.equal(selectTargetFromCandidates(listSessionsSnapshot(), {}).target.id, "compat");
  markSessionSelected("compat", { make_default: true });
  assert.equal(sessionPointers().default_session_id, "compat");
  assert.equal(asShortTabs(listSessionsSnapshot())[0].id, "compat");
  defaultSessionRegistry.reset();
});

test("snapshot store enforces scope, per-tab/global bounds, and invalidation", async () => {
  const store = createSnapshotStore({ max_global: 3, max_per_tab: 2 });
  assert.throws(() => store.put({ nodes: [] }), /snapshot requires tab_id/);
  assert.throws(
    () => store.get("missing"),
    (error) => hasErrorCode(error, "STALE_NODE_REF"),
  );
  const first = store.put({ snapshot_id: "one", tab_id: "tab-a", nodes: [] }, {
    workspace_key: "workspace",
    task_id: "task",
  });
  assert.equal(store.get(first.snapshot_id, { workspace_key: "workspace", task_id: "task" }).tab_id, "tab-a");
  assert.throws(
    () => store.get(first.snapshot_id, { workspace_key: "other", task_id: "task" }),
    (error) => hasErrorCode(error, "SNAPSHOT_SCOPE_MISMATCH"),
  );
  assert.throws(
    () => store.get(first.snapshot_id, {}, { require_scope: true }),
    (error) => hasErrorCode(error, "SNAPSHOT_SCOPE_MISMATCH"),
  );
  store.put({ snapshot_id: "two", tab_id: "tab-a", nodes: [] });
  store.put({ snapshot_id: "three", tab_id: "tab-a", nodes: [] });
  store.put({ snapshot_id: "four", tab_id: "tab-b", nodes: [] });
  assert.equal(store.stats().snapshot_count <= 3, true);
  store.invalidateTab("tab-a");
  assert.equal(store.stats().snapshot_count, 1);
  await store.dispose();
  assert.equal(store.stats().snapshot_count, 0);
});

test("download and network stores are bounded and disposable", async () => {
  const downloads = createDownloadSessionStore({ max_sessions: 2 });
  assert.throws(() => downloads.put({}), /requires token/);
  downloads.put({ token: "one" });
  downloads.put({ token: "two" });
  downloads.put({ token: "three" });
  assert.equal(downloads.stats().session_count, 2);
  assert.equal(downloads.get("one"), null);
  assert.equal(downloads.get("three").token, "three");
  downloads.reset();
  assert.equal(downloads.get(), null);
  downloads.put({ token: "three" });

  const observations = createNetworkObservationStore({ max_observations: 2 });
  observations.remember({ network_observation_id: "one" });
  observations.remember({ network_observation_id: "two" });
  observations.remember({ network_observation_id: "three" });
  assert.equal(observations.stats().observation_count, 2);
  assert.equal(observations.get("three").network_observation_id, "three");
  assert.throws(
    () => observations.get("missing"),
    (error) => hasErrorCode(error, "NETWORK_OBSERVATION_NOT_FOUND"),
  );
  await downloads.dispose();
  await observations.dispose();
  assert.equal(downloads.stats().session_count, 0);
  assert.equal(observations.stats().observation_count, 0);
});

test("adoption runtime owns capability tokens and disposal callbacks", async () => {
  let disposeCalls = 0;
  const runtime = createAdoptionRuntime({
    runtime_id: "adoption-test",
    start_timer: false,
    now: () => 100,
    max_adoption_tokens: 1,
    max_close_tokens: 1,
  });
  runtime.configure({
    renew: async () => [],
    dispose: async () => {
      disposeCalls += 1;
      return [{ released: true }];
    },
  });
  runtime.putAdoptionToken("old-adopt", { expires_at_ms: 200 });
  runtime.putAdoptionToken("adopt", { expires_at_ms: 200 });
  runtime.putCloseToken("old-close", { expires_at_ms: 200 });
  runtime.putCloseToken("close", { expires_at_ms: 200 });
  assert.equal(runtime.adoptionTokens.has("old-adopt"), false);
  assert.equal(runtime.closeTokens.has("old-close"), false);
  assert.deepEqual(runtime.stats(), {
    runtime_id: "adoption-test",
    disposed: false,
    adoption_token_count: 1,
    close_token_count: 1,
    max_adoption_tokens: 1,
    max_close_tokens: 1,
    renewal_active: false,
  });
  assert.deepEqual(await runtime.dispose(), [{ released: true }]);
  assert.equal(disposeCalls, 1);
  assert.equal(runtime.stats().adoption_token_count, 0);
  assert.equal(runtime.stats().close_token_count, 0);
  assert.deepEqual(await runtime.dispose(), []);
  assert.throws(() => runtime.configure({}), /disposed/);

  const timed = createAdoptionRuntime({ renew_ms: 60_000 });
  timed.configure({ renew: async () => [] });
  assert.equal(timed.stats().renewal_active, true);
  assert.deepEqual(await timed.dispose(), []);
});

test("transport health prefers last known good and remains bounded", async () => {
  const store = createTmwdTransportHealthStore({ max_records: 2 });
  const args = {
    tmwd_ws_endpoint: "ws://127.0.0.1:18765",
    tmwd_link_endpoint: "http://127.0.0.1:12306/tmwd",
  };
  assert.equal(store.preferredOrder(args)[0].transport, "ws");
  store.record(args, "ws", false, { error: "fixture" });
  assert.equal(store.snapshot(args, "ws").backed_off, true);
  store.record(args, "link", true);
  assert.equal(store.preferredOrder(args)[0].transport, "link");
  store.record({ tmwd_ws_endpoint: "ws://127.0.0.1:18766" }, "ws", true);
  assert.equal(store.stats().endpoint_count, 2);
  store.reset();
  assert.equal(store.stats().endpoint_count, 0);
  await store.dispose();
});

test("tab scheduler serializes per key, permits cross-key concurrency, and rejects overflow", async () => {
  const scheduler = createTabScheduler({ max_keys: 2, max_queue_per_key: 2 });
  /** @type {(value?: any) => void} */
  let release = () => {};
  const blocked = new Promise((resolve) => { release = resolve; });
  const first = scheduler.run("tab-a", () => blocked);
  const second = scheduler.run("tab-a", () => blocked);
  await assert.rejects(
    () => scheduler.run("tab-a", async () => undefined),
    /queue limit reached/,
  );
  const other = scheduler.run("tab-b", async () => "other");
  await assert.rejects(
    () => scheduler.run("tab-c", async () => undefined),
    /key limit reached/,
  );
  assert.equal(await other, "other");
  release();
  await Promise.all([first, second]);
  assert.equal(scheduler.stats().queued_request_count, 0);
  await scheduler.dispose();
  await assert.rejects(() => scheduler.run("tab-a", async () => undefined), /disposed/);
});

test("output compaction preserves primary payloads and trims diagnostics", () => {
  assert.equal(resolveOutputMode({ output_mode: "compact" }), "compact");
  assert.equal(resolveOutputMode({ output_mode: "invalid" }, "invalid"), "full");
  const attempts = compactTransportAttempts([{
    transport: "ws",
    status: "ok",
    reason: "fixture",
    health: { endpoint: "secret", consecutive_failures: 0, backed_off: false },
  }]);
  assert.equal(attempts[0].health.endpoint, undefined);
  const data = { sessions: [{ id: "a", active: true }], value: 1 };
  const compact = compactToolData("browser_execute_js", data, { tab_id: "a" }, { mode: "compact" });
  assert.equal(compact.sessions, undefined);
  assert.equal(compact.session_summary.count, 1);
  assert.equal(compactToolData("browser_tab_ops", data, null, { mode: "compact" }), data);
});

test("native dependency summaries unwrap tool-outcome v3", () => {
  const outcome = {
    schema: "browser67.tool-outcome.v3",
    ok: true,
    data: {
      supported_actions: ["move", "click", "double_click", "scroll", "press", "type", "paste", "activate_window"],
      unsupported_actions: [],
      requirements: [],
    },
  };
  assert.equal(capabilityPayload(outcome), outcome.data);
  assert.deepEqual(summarizeCapabilities(outcome), {
    pointer_ready: true,
    keyboard_ready: true,
    window_ready: true,
    fully_ready: true,
    supported_actions: outcome.data.supported_actions,
    unsupported_actions: [],
    requirements: [],
  });
  assert.throws(
    () => capabilityPayload({ schema: "browser67.tool-outcome.v3", ok: false, error: { code: "NO_NATIVE" } }),
    /NO_NATIVE/,
  );
});

test("page context resolves result, session, and managed ownership without browser I/O", async () => {
  assert.equal(resolvePageId({ tab_id: "arg" }, { tab_id: "result" }), "result");
  const sessionStore = createSessionRegistry();
  sessionStore.sync([{ id: "tab-1", title: "Session title", url: "https://example.test/", active: true }]);
  const page = await resolvePageContext("browser_execute_js", { tab_id: "tab-1" }, {
    tab_id: "tab-1",
  }, {
    runtime: { sessionStore },
    get_managed_tab: async () => ({
      owner: "tmwd",
      ownership_origin: "user_adopted",
      management_policy_applied: true,
      suspended: false,
    }),
  });
  assert.deepEqual(page, {
    tab_id: "tab-1",
    title: "Session title",
    url: "https://example.test/",
    source: "tool_result",
    resolution: "confirmed",
    management: {
      managed: true,
      ownership_origin: "user_adopted",
      policy_status: "applied",
      suspended: false,
    },
  });
  assert.equal(await resolvePageContext("browser_scan", {}, {}), null);
});
