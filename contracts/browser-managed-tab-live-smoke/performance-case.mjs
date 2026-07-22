import assert from "node:assert/strict";
import { performance } from "node:perf_hooks";

function positiveIntegerEnv(name, fallback, { min = 1, max = 10_000 } = {}) {
  const raw = process.env[name];
  if (raw == null || raw === "") return fallback;
  const value = Number(raw);
  if (!Number.isFinite(value) || value < min || value > max) {
    throw new Error(`${name} must be between ${String(min)} and ${String(max)}`);
  }
  return Math.floor(value);
}

function performanceConfig() {
  return {
    nodes: positiveIntegerEnv("BROWSER67_TMWD_PERF_NODES", 120, { max: 500 }),
    transport_samples: positiveIntegerEnv("BROWSER67_TMWD_PERF_TRANSPORT_SAMPLES", 20, { max: 100 }),
    execute_samples: positiveIntegerEnv("BROWSER67_TMWD_PERF_EXECUTE_SAMPLES", 15, { max: 100 }),
    extract_samples: positiveIntegerEnv("BROWSER67_TMWD_PERF_EXTRACT_SAMPLES", 5, { max: 25 }),
    wait_samples: positiveIntegerEnv("BROWSER67_TMWD_PERF_WAIT_SAMPLES", 10, { max: 50 }),
    warmup_samples: positiveIntegerEnv("BROWSER67_TMWD_PERF_WARMUP_SAMPLES", 2, { max: 10 }),
    budgets_ms: {
      create: positiveIntegerEnv("BROWSER67_TMWD_PERF_CREATE_BUDGET_MS", 3_000),
      transport_p95: positiveIntegerEnv("BROWSER67_TMWD_PERF_TRANSPORT_P95_BUDGET_MS", 100),
      execute_p95: positiveIntegerEnv("BROWSER67_TMWD_PERF_EXECUTE_P95_BUDGET_MS", 100),
      extract_p95: positiveIntegerEnv("BROWSER67_TMWD_PERF_EXTRACT_P95_BUDGET_MS", 150),
      wait_p95: positiveIntegerEnv("BROWSER67_TMWD_PERF_WAIT_P95_BUDGET_MS", 100),
      total: positiveIntegerEnv("BROWSER67_TMWD_PERF_TOTAL_BUDGET_MS", 5_000),
    },
  };
}

function roundMs(value) {
  return Number(value.toFixed(2));
}

function percentile(sorted, percentileValue) {
  if (sorted.length === 0) return 0;
  const index = Math.max(0, Math.ceil((percentileValue / 100) * sorted.length) - 1);
  return sorted[Math.min(index, sorted.length - 1)];
}

function summarize(samples) {
  const sorted = [...samples].sort((left, right) => left - right);
  const total = sorted.reduce((sum, value) => sum + value, 0);
  return {
    samples: sorted.length,
    min_ms: roundMs(sorted[0] ?? 0),
    mean_ms: roundMs(sorted.length > 0 ? total / sorted.length : 0),
    p50_ms: roundMs(percentile(sorted, 50)),
    p95_ms: roundMs(percentile(sorted, 95)),
    p99_ms: roundMs(percentile(sorted, 99)),
    max_ms: roundMs(sorted.at(-1) ?? 0),
  };
}

async function timed(operation) {
  const startedAt = performance.now();
  const value = await operation();
  return { elapsed_ms: performance.now() - startedAt, value };
}

async function warmup(count, operation) {
  for (let index = 0; index < count; index += 1) {
    await operation();
  }
}

async function measure(count, operation) {
  const samples = [];
  for (let index = 0; index < count; index += 1) {
    samples.push((await timed(operation)).elapsed_ms);
  }
  return summarize(samples);
}

function tabArgs(context, tabId) {
  return {
    ...context.baseArgs,
    tab_id: tabId,
    switch_tab_id: tabId,
    session_id: tabId,
  };
}

function selectionArgs(context, tabId) {
  return {
    tmwd_mode: context.baseArgs.tmwd_mode,
    tmwd_transport: context.baseArgs.tmwd_transport,
    tmwd_ws_endpoint: context.baseArgs.tmwd_ws_endpoint,
    tmwd_link_endpoint: context.baseArgs.tmwd_link_endpoint,
    cdp_endpoint: context.baseArgs.cdp_endpoint,
    switch_tab_id: tabId,
    session_id: tabId,
  };
}

function scopedArgs(context, tabId) {
  return {
    ...tabArgs(context, tabId),
    workspace_key: context.workspaceKey,
    task_id: "tmwd-performance-live",
  };
}

function assertBudget(metric, budget, label) {
  assert.equal(
    metric.p95_ms <= budget,
    true,
    `${label} p95 ${String(metric.p95_ms)}ms exceeded ${String(budget)}ms budget`,
  );
}

async function runTmwdPerformanceCase(context) {
  const config = performanceConfig();
  const totalStartedAt = performance.now();
  const performanceUrl = `${context.fixture.origin}/tmwd-performance-live?nodes=${String(config.nodes)}`;
  const createResult = await timed(() => context.callTool("browser_tab_lifecycle", {
    ...context.baseArgs,
    action: "select_or_create",
    url: performanceUrl,
    workspace_key: context.workspaceKey,
    task_id: "tmwd-performance-live",
    active: false,
    wait_until: "listed",
    wait_timeout_ms: 5_000,
    wait_poll_ms: 100,
  }));
  const tabId = String(createResult.value?.managed_tab?.tab_id ?? "");
  assert.ok(tabId, "TMWD performance fixture did not return a managed tab id");
  context.openedTabIds.add(tabId);
  assert.equal(createResult.value?.ready, true, "TMWD performance fixture was not runtime-routable after creation");
  assert.equal(createResult.value?.ready_source, "runtime_session");
  assert.equal(createResult.value?.policy_application?.applied, true, "TMWD performance fixture policy was not applied");
  assert.equal(
    createResult.elapsed_ms <= config.budgets_ms.create,
    true,
    `managed tab creation ${String(roundMs(createResult.elapsed_ms))}ms exceeded ${String(config.budgets_ms.create)}ms budget`,
  );

  const selectedTabArgs = tabArgs(context, tabId);
  const operationArgs = scopedArgs(context, tabId);
  const ready = await context.callTool("browser_wait", {
    ...selectedTabArgs,
    type: "selector",
    selector: "#performance-node-0",
    timeout_ms: 5_000,
    interval_ms: 25,
  });
  assert.equal(ready.status, "passed", `TMWD performance fixture was not ready: ${JSON.stringify(ready)}`);

  const transportOperation = async () => {
    const result = await context.bridgeCommand({ cmd: "tabs", method: "get", tabId });
    assert.equal(String(result?.id ?? result?.tabId ?? result?.tab_id ?? ""), tabId);
    return result;
  };
  const executeOperation = async () => {
    const result = await context.callTool("browser_execute_js", {
      ...operationArgs,
      script: "return document.querySelectorAll('[data-performance-node]').length;",
      no_monitor: true,
      output_mode: "compact",
      max_return_chars: 1_000,
    });
    assert.equal(result.status, "success");
    const returnedNodeCount = result.js_return && typeof result.js_return === "object"
      ? Number(result.js_return.preview)
      : Number(result.js_return);
    assert.equal(returnedNodeCount, config.nodes);
    return result;
  };
  const extractOperation = async () => {
    const result = await context.callTool("browser_extract", {
      ...selectionArgs(context, tabId),
      selector_limit: config.nodes + 20,
    });
    assert.equal(result.schema, "browser67.actionable-snapshot.v2");
    assert.equal(result.nodes.length >= config.nodes, true);
    return result;
  };
  const waitOperation = async () => {
    const result = await context.callTool("browser_wait", {
      ...selectedTabArgs,
      type: "selector",
      selector: `#performance-node-${String(config.nodes - 1)}`,
      timeout_ms: 1_000,
      interval_ms: 25,
    });
    assert.equal(result.status, "passed");
    return result;
  };

  const cold = {
    transport_ms: roundMs((await timed(transportOperation)).elapsed_ms),
    execute_ms: roundMs((await timed(executeOperation)).elapsed_ms),
    extract_ms: roundMs((await timed(extractOperation)).elapsed_ms),
    wait_ms: roundMs((await timed(waitOperation)).elapsed_ms),
  };

  await warmup(config.warmup_samples, transportOperation);
  await warmup(config.warmup_samples, executeOperation);
  await warmup(config.warmup_samples, extractOperation);
  await warmup(config.warmup_samples, waitOperation);

  const metrics = {
    tabs_get: await measure(config.transport_samples, transportOperation),
    execute_js: await measure(config.execute_samples, executeOperation),
    actionable_snapshot: await measure(config.extract_samples, extractOperation),
    selector_wait: await measure(config.wait_samples, waitOperation),
  };
  assertBudget(metrics.tabs_get, config.budgets_ms.transport_p95, "tabs.get");
  assertBudget(metrics.execute_js, config.budgets_ms.execute_p95, "browser_execute_js");
  assertBudget(metrics.actionable_snapshot, config.budgets_ms.extract_p95, "browser_extract");
  assertBudget(metrics.selector_wait, config.budgets_ms.wait_p95, "browser_wait selector");

  const finalized = await context.callTool("browser_tab_lifecycle", {
    ...context.baseArgs,
    action: "finalize_task",
    workspace_key: context.workspaceKey,
    prune_stale: false,
  });
  assert.equal(
    finalized.close_unkept?.closed?.some((entry) => String(entry?.tab_id ?? "") === tabId && entry.closed === true),
    true,
    "TMWD performance fixture was not closed by finalize_task",
  );
  context.openedTabIds.delete(tabId);

  const totalMs = performance.now() - totalStartedAt;
  assert.equal(
    totalMs <= config.budgets_ms.total,
    true,
    `TMWD performance live smoke ${String(roundMs(totalMs))}ms exceeded ${String(config.budgets_ms.total)}ms budget`,
  );
  return {
    schema: "browser67.tmwd-performance-live.v1",
    status: "passed",
    transport: "tmwd",
    tab_id: tabId,
    node_count: config.nodes,
    create_ms: roundMs(createResult.elapsed_ms),
    total_ms: roundMs(totalMs),
    cold,
    metrics,
    budgets_ms: config.budgets_ms,
  };
}

export { runTmwdPerformanceCase };
