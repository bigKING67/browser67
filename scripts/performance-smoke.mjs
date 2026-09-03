#!/usr/bin/env node
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import {
  appendFile,
  mkdir,
  mkdtemp,
  rm,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { performance } from "node:perf_hooks";

import { normalizeEvidenceRecord } from "../src/runtime/evidence/schema.mjs";
import { handleBrowserRunOps } from "../src/runtime/runs/lifecycle.mjs";
import { semanticDiffSnapshots } from "../src/browser/content/semantic-diff.mjs";
import { createSnapshotStore } from "../src/browser/content/snapshot-store.mjs";
import { createAdoptionRuntime } from "../src/runtime/adoption/state.mjs";
import { createDownloadSessionStore } from "../src/runtime/downloads/store.mjs";
import { createNetworkObservationStore } from "../src/runtime/network/observation-store.mjs";
import { createRunStore } from "../src/runtime/runs/store.mjs";
import { createSessionRegistry } from "../src/runtime/sessions/registry.mjs";
import { compactToolData } from "../src/runtime/output-mode.mjs";
import { createTabScheduler } from "../src/runtime/tab-scheduler.mjs";
import { completedOutcome } from "../src/runtime/tool-outcome.mjs";
import { atomicWriteJson } from "../src/runtime/storage/atomic-file.mjs";
import { scanNdjsonBackwards } from "../src/runtime/storage/ndjson.mjs";
import { createTmwdTransportHealthStore } from "../src/tmwd-runtime/health.mjs";

const RUN_EVENT_COUNT = 2_000;
const INDEXED_RUN_WRITE_ROUNDS = 3;
const INDEXED_RUNS_PER_ROUND = 40;
const INDEXED_RUN_WRITE_ABSOLUTE_ROUND_BUDGET_MS = 15_000;
const INDEXED_RUN_WRITE_TOTAL_BUDGET_MS = 45_000;
const INDEXED_RUN_WRITE_RELATIVE_RATIO_BUDGET = 4;
const INDEXED_RUN_WRITE_RELATIVE_FLOOR_MS = 2_000;
const RUN_LIFECYCLE_BUDGET_MS = process.platform === "win32" ? 4_000 : 2_500;
const RUN_LIFECYCLE_SAMPLE_COUNT = 3;
const SEMANTIC_DIFF_BUDGET_MS = process.env.CI === "true" ? 1_000 : 500;

function assertBudget(label, elapsedMs, budgetMs) {
  if (elapsedMs > budgetMs) {
    throw new Error(`${label} exceeded budget: ${elapsedMs.toFixed(2)}ms > ${budgetMs}ms`);
  }
}

function percentile(values, ratio) {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * ratio) - 1));
  return sorted[index];
}

function median(values) {
  return percentile(values, 0.5);
}

async function measureRunLifecycle(round) {
  const startedAt = performance.now();
  const prepared = await handleBrowserRunOps({
    action: "prepare",
    workspace_key: "performance-smoke",
    title: `performance smoke ${String(round + 1)}`,
  });
  const eventLatencies = [];
  for (let index = 0; index < RUN_EVENT_COUNT; index += 1) {
    const eventStarted = performance.now();
    await handleBrowserRunOps({
      action: "record_event",
      workspace_key: "performance-smoke",
      run_id: prepared.run.run_id,
      event: "tick",
      data: { index, payload: "x".repeat(128) },
    });
    eventLatencies.push(performance.now() - eventStarted);
  }
  await handleBrowserRunOps({
    action: "finish",
    workspace_key: "performance-smoke",
    run_id: prepared.run.run_id,
    status: "success",
  });
  return {
    prepared,
    elapsed_ms: performance.now() - startedAt,
    event_latencies_ms: eventLatencies,
  };
}

async function measureFilesystemControl(root, round, count) {
  const group = `filesystem-control-${String(round)}`;
  const groupDir = join(root, group);
  const indexPath = join(groupDir, "index.ndjson");
  const metaPath = join(groupDir, "index.meta.json");
  const startedAt = performance.now();
  for (let index = 0; index < count; index += 1) {
    const runId = `control-${String(round)}-${String(index).padStart(4, "0")}`;
    const runDir = join(groupDir, runId);
    const running = { run_id: runId, group, status: "running", index };
    const finished = { ...running, status: "success" };
    await Promise.all([
      mkdir(join(runDir, "artifacts"), { recursive: true }),
      mkdir(join(runDir, "logs"), { recursive: true }),
    ]);
    await atomicWriteJson(join(runDir, "run.json"), running);
    await appendFile(join(runDir, "events.ndjson"), `${JSON.stringify({ event: "prepare", index })}\n`, "utf8");
    await appendFile(indexPath, `${JSON.stringify(running)}\n`, "utf8");
    await atomicWriteJson(metaPath, { group, revision: index * 2 + 1 });
    await appendFile(join(runDir, "events.ndjson"), `${JSON.stringify({ event: "finish", index })}\n`, "utf8");
    await atomicWriteJson(join(runDir, "run.json"), finished);
    await appendFile(indexPath, `${JSON.stringify(finished)}\n`, "utf8");
    await atomicWriteJson(metaPath, { group, revision: index * 2 + 2 });
  }
  return performance.now() - startedAt;
}

function assertIndexedRunWriteBudget(productSamples, controlSamples) {
  assert.equal(productSamples.length, INDEXED_RUN_WRITE_ROUNDS);
  assert.equal(controlSamples.length, INDEXED_RUN_WRITE_ROUNDS);
  const productMedianMs = median(productSamples);
  const controlMedianMs = median(controlSamples);
  const relativeBudgetMs = Math.max(
    INDEXED_RUN_WRITE_RELATIVE_FLOOR_MS,
    controlMedianMs * INDEXED_RUN_WRITE_RELATIVE_RATIO_BUDGET,
  );
  const totalMs = productSamples.reduce((total, sample) => total + sample, 0);
  for (const [index, sample] of productSamples.entries()) {
    assertBudget(
      `indexed run writes round ${String(index + 1)}`,
      sample,
      INDEXED_RUN_WRITE_ABSOLUTE_ROUND_BUDGET_MS,
    );
  }
  assertBudget("indexed run writes total", totalMs, INDEXED_RUN_WRITE_TOTAL_BUDGET_MS);
  assertBudget("indexed run writes median relative to filesystem control", productMedianMs, relativeBudgetMs);
  return {
    product_median_ms: productMedianMs,
    control_median_ms: controlMedianMs,
    relative_budget_ms: relativeBudgetMs,
    relative_ratio: productMedianMs / Math.max(controlMedianMs, 1),
    total_ms: totalMs,
  };
}

async function measureMcpColdStart(timeoutMs = 5_000) {
  const startedAt = performance.now();
  const child = spawn(process.execPath, ["src/mcp/browser/server.mjs"], {
    cwd: process.cwd(),
    env: process.env,
    stdio: ["pipe", "pipe", "pipe"],
  });
  let stdout = "";
  let stderr = "";
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  child.stderr.on("data", (chunk) => {
    stderr += chunk;
  });
  try {
    const response = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`MCP cold start timeout: ${stderr}`)), timeoutMs);
      child.stdout.on("data", (chunk) => {
        stdout += chunk;
        const newline = stdout.indexOf("\n");
        if (newline < 0) return;
        clearTimeout(timer);
        try {
          resolve(JSON.parse(stdout.slice(0, newline)));
        } catch (error) {
          reject(error);
        }
      });
      child.once("error", (error) => {
        clearTimeout(timer);
        reject(error);
      });
      child.stdin.write(`${JSON.stringify({
        jsonrpc: "2.0",
        id: "performance-cold-start",
        method: "initialize",
        params: {
          protocolVersion: "2024-11-05",
          capabilities: {},
          clientInfo: { name: "performance-smoke", version: "1" },
        },
      })}\n`);
    });
    if (response?.result?.serverInfo?.name !== "browser67-tmwd-browser") {
      throw new Error(`unexpected MCP cold start response: ${JSON.stringify(response)}`);
    }
    return performance.now() - startedAt;
  } finally {
    child.stdin.end();
    setTimeout(() => child.kill("SIGTERM"), 250).unref();
  }
}

function snapshotNode(index, changed = false) {
  return {
    node_id: `node-${index}`,
    tag: "button",
    role: "button",
    accessible_name: `Button ${index}`,
    text: changed ? `Changed ${index}` : `Button ${index}`,
    value: "",
    visible: true,
    enabled: true,
    rect: { x: index % 100, y: index, width: 80, height: 24 },
  };
}

async function main() {
  const previousRunRoot = process.env.BROWSER_STRUCTURED_RUN_ROOT;
  const runRoot = await mkdtemp(join(tmpdir(), "tmwd-performance-smoke-"));
  process.env.BROWSER_STRUCTURED_RUN_ROOT = runRoot;
  try {
    const evidenceStarted = performance.now();
    for (let index = 0; index < 5_000; index += 1) {
      normalizeEvidenceRecord({
        source: index % 2 === 0 ? "network" : "dom",
        confidence: index % 3 === 0 ? "exact" : "partial",
        data: { index },
      });
    }
    const evidenceMs = performance.now() - evidenceStarted;

    const runLifecycleMeasurements = [];
    for (let round = 0; round < RUN_LIFECYCLE_SAMPLE_COUNT; round += 1) {
      runLifecycleMeasurements.push(await measureRunLifecycle(round));
    }
    const prepared = runLifecycleMeasurements[0].prepared;
    const runLifecycleSamplesMs = runLifecycleMeasurements.map((sample) => sample.elapsed_ms);
    const runMs = median(runLifecycleSamplesMs);
    const eventLatencies = runLifecycleMeasurements.flatMap((sample) => sample.event_latencies_ms);
    const runEventP95Ms = percentile(eventLatencies, 0.95);
    const runEventP99Ms = percentile(eventLatencies, 0.99);

    const runStore = createRunStore({
      root: runRoot,
      checkpoint_interval_ms: 60_000,
      max_cached_runs: 32,
    });
    const indexedRunWriteSamplesMs = [];
    const filesystemControlSamplesMs = [];
    const runListReadSamplesMs = [];
    for (let round = 0; round < INDEXED_RUN_WRITE_ROUNDS; round += 1) {
      filesystemControlSamplesMs.push(await measureFilesystemControl(
        runRoot,
        round,
        INDEXED_RUNS_PER_ROUND,
      ));
      const scaleGroup = `performance-scale-${String(round)}`;
      const runListStarted = performance.now();
      for (let index = 0; index < INDEXED_RUNS_PER_ROUND; index += 1) {
        const runId = `scale-${String(round)}-${String(index).padStart(4, "0")}`;
        await runStore.prepare({ workspace_key: scaleGroup, run_id: runId, title: `Run ${index}` });
        await runStore.finish({ workspace_key: scaleGroup, run_id: runId, status: "success" });
      }
      indexedRunWriteSamplesMs.push(performance.now() - runListStarted);
      const listStarted = performance.now();
      const listed = await runStore.list({ workspace_key: scaleGroup, max_items: 50 });
      runListReadSamplesMs.push(performance.now() - listStarted);
      if (listed.total !== INDEXED_RUNS_PER_ROUND || listed.runs.length !== INDEXED_RUNS_PER_ROUND) {
        throw new Error(`unexpected indexed run list: total=${listed.total} returned=${listed.runs.length}`);
      }
    }
    const indexedRunWriteStats = assertIndexedRunWriteBudget(
      indexedRunWriteSamplesMs,
      filesystemControlSamplesMs,
    );
    const runListWriteMs = indexedRunWriteStats.total_ms;
    const runListReadMs = runListReadSamplesMs.reduce((total, sample) => total + sample, 0);

    const eventFile = join(prepared.run.run_dir, "events.ndjson");
    const tailStarted = performance.now();
    const tailScan = await scanNdjsonBackwards(eventFile, {
      on_record: (_record, count) => count < 20,
    });
    const eventTailMs = performance.now() - tailStarted;

    const beforeNodes = Array.from({ length: 2_500 }, (_value, index) => snapshotNode(index));
    const afterNodes = beforeNodes.map((node, index) => index % 25 === 0
      ? snapshotNode(index, true)
      : node);
    const diffStarted = performance.now();
    const semanticDiff = semanticDiffSnapshots(
      { snapshot_id: "before", document_id: "document", nodes: beforeNodes, transients: [] },
      { snapshot_id: "after", document_id: "document", nodes: afterNodes, transients: [] },
    );
    const semanticDiffMs = performance.now() - diffStarted;
    if (semanticDiff.summary.changed_count !== 100) {
      throw new Error(`unexpected semantic diff count: ${semanticDiff.summary.changed_count}`);
    }

    const mcpColdStartMs = await measureMcpColdStart();

    const diagnosticSessions = Array.from({ length: 1_000 }, (_value, index) => ({
      id: `tab-${index}`,
      title: `Performance tab ${index}`,
      url: `https://example.test/report/${index}?token=secret-${index}`,
      active: index === 0,
      is_default: index === 0,
      is_latest: index === 0,
      connected_at: new Date().toISOString(),
    }));
    const diagnosticPayload = {
      status: "success",
      transport: "tmwd_ws",
      sessions: diagnosticSessions,
      transport_attempts: Array.from({ length: 10 }, (_value, index) => ({
        transport: index % 2 === 0 ? "ws" : "link",
        phase: "execute",
        status: "ok",
        reason: "performance_fixture",
        health: {
          endpoint: `ws://127.0.0.1:${18_765 + index}`,
          consecutive_failures: 0,
          backed_off: false,
          last_success_at: new Date().toISOString(),
          last_success_at_ms: Date.now(),
        },
      })),
      js_return: { type: "object", preview: "ok", truncated: false },
    };
    const diagnosticPage = {
      tab_id: "tab-0",
      title: "Performance tab 0",
      url: "https://example.test/report/0",
      source: "selected_target",
      resolution: "confirmed",
      management: { managed: true, ownership_origin: "agent_created", policy_status: "applied", suspended: false },
    };
    const fullSerializeStarted = performance.now();
    const fullResponse = JSON.stringify(completedOutcome(diagnosticPayload, { page: diagnosticPage }));
    const fullSerializeMs = performance.now() - fullSerializeStarted;
    const compactSerializeStarted = performance.now();
    const compactResponse = JSON.stringify(completedOutcome(
      compactToolData("browser_execute_js", diagnosticPayload, diagnosticPage, { mode: "compact" }),
      { page: diagnosticPage },
    ));
    const compactSerializeMs = performance.now() - compactSerializeStarted;
    const compactReductionRatio = 1 - (Buffer.byteLength(compactResponse) / Buffer.byteLength(fullResponse));
    if (compactReductionRatio < 0.3) {
      throw new Error(`compact response reduction below 30%: ${(compactReductionRatio * 100).toFixed(2)}%`);
    }

    const sessionStore = createSessionRegistry({ max_records: 64, retain_ms: 60_000 });
    sessionStore.sync(Array.from({ length: 500 }, (_value, index) => ({
      id: `bounded-tab-${index}`,
      url: `https://example.test/${index}`,
      title: `Tab ${index}`,
      active: index === 0,
    })));
    const snapshotStore = createSnapshotStore({ max_global: 32, max_per_tab: 4 });
    for (let index = 0; index < 200; index += 1) {
      snapshotStore.put({ snapshot_id: `bounded-snapshot-${index}`, tab_id: `tab-${index % 20}`, nodes: [] });
    }
    const downloadStore = createDownloadSessionStore({ max_sessions: 32 });
    for (let index = 0; index < 200; index += 1) {
      downloadStore.put({ token: `bounded-download-${index}`, download_dir: "/tmp", since_ms: index });
    }
    const adoptionRuntime = createAdoptionRuntime({
      start_timer: false,
      max_adoption_tokens: 32,
      max_close_tokens: 16,
    });
    for (let index = 0; index < 200; index += 1) {
      adoptionRuntime.putAdoptionToken(`bounded-adoption-${index}`, { expires_at_ms: Date.now() + 60_000 });
      adoptionRuntime.putCloseToken(`bounded-close-${index}`, { expires_at_ms: Date.now() + 60_000 });
    }
    const observationStore = createNetworkObservationStore({ max_observations: 32 });
    for (let index = 0; index < 200; index += 1) {
      observationStore.remember({ network_observation_id: `bounded-network-${index}`, stopped: true });
    }
    const healthStore = createTmwdTransportHealthStore({ max_records: 16 });
    for (let index = 0; index < 200; index += 1) {
      healthStore.record({ tmwd_ws_endpoint: `ws://127.0.0.1:${20_000 + index}` }, "ws", false, {
        error: "bounded fixture",
      });
    }
    const scheduler = createTabScheduler({ max_keys: 4, max_queue_per_key: 4 });
    let releaseScheduler;
    const schedulerBlock = new Promise((resolve) => { releaseScheduler = resolve; });
    const scheduled = Array.from({ length: 4 }, () => scheduler.run("bounded-tab", () => schedulerBlock));
    await assert.rejects(
      () => scheduler.run("bounded-tab", async () => undefined),
      /queue limit reached/,
    );
    releaseScheduler();
    await Promise.all(scheduled);
    const boundedStoreStats = {
      sessions: sessionStore.stats(),
      snapshots: snapshotStore.stats(),
      adoption: adoptionRuntime.stats(),
      downloads: downloadStore.stats(),
      observations: observationStore.stats(),
      runs: runStore.stats(),
      transport_health: healthStore.stats(),
      scheduler: scheduler.stats(),
    };
    if (
      boundedStoreStats.sessions.session_count > 64
      || boundedStoreStats.snapshots.snapshot_count > 32
      || boundedStoreStats.adoption.adoption_token_count > 32
      || boundedStoreStats.adoption.close_token_count > 16
      || boundedStoreStats.downloads.session_count > 32
      || boundedStoreStats.observations.observation_count > 32
      || boundedStoreStats.runs.cached_run_count > 32
      || boundedStoreStats.transport_health.endpoint_count > 16
    ) {
      throw new Error(`bounded runtime store exceeded limit: ${JSON.stringify(boundedStoreStats)}`);
    }
    await scheduler.dispose();
    await adoptionRuntime.dispose();
    await runStore.dispose();

    assertBudget("evidence normalization", evidenceMs, 250);
    assertBudget("run lifecycle io median", runMs, RUN_LIFECYCLE_BUDGET_MS);
    assertBudget("run event p95", runEventP95Ms, 200);
    assertBudget("run event p99", runEventP99Ms, 500);
    assertBudget("indexed run list", runListReadMs, 500);
    assertBudget("event tail read", eventTailMs, 250);
    assertBudget("semantic diff", semanticDiffMs, SEMANTIC_DIFF_BUDGET_MS);
    assertBudget("MCP cold start", mcpColdStartMs, 3_000);
    assertBudget("full outcome serialization", fullSerializeMs, 50);
    assertBudget("compact outcome serialization", compactSerializeMs, 50);
    process.stdout.write(`${JSON.stringify({
      ok: true,
      evidence_records: 5_000,
      run_events: RUN_EVENT_COUNT,
      run_event_observations: eventLatencies.length,
      run_lifecycle_sample_count: runLifecycleSamplesMs.length,
      run_lifecycle_samples_ms: runLifecycleSamplesMs.map((value) => Number(value.toFixed(2))),
      evidence_ms: Number(evidenceMs.toFixed(2)),
      run_ms: Number(runMs.toFixed(2)),
      run_event_p95_ms: Number(runEventP95Ms.toFixed(2)),
      run_event_p99_ms: Number(runEventP99Ms.toFixed(2)),
      indexed_runs: INDEXED_RUN_WRITE_ROUNDS * INDEXED_RUNS_PER_ROUND,
      run_list_write_ms: Number(runListWriteMs.toFixed(2)),
      run_list_write_samples_ms: indexedRunWriteSamplesMs.map((value) => Number(value.toFixed(2))),
      run_list_write_median_ms: Number(indexedRunWriteStats.product_median_ms.toFixed(2)),
      filesystem_control_samples_ms: filesystemControlSamplesMs.map((value) => Number(value.toFixed(2))),
      filesystem_control_median_ms: Number(indexedRunWriteStats.control_median_ms.toFixed(2)),
      run_list_write_relative_ratio: Number(indexedRunWriteStats.relative_ratio.toFixed(3)),
      run_list_write_relative_budget_ms: Number(indexedRunWriteStats.relative_budget_ms.toFixed(2)),
      run_list_read_ms: Number(runListReadMs.toFixed(2)),
      run_list_read_samples_ms: runListReadSamplesMs.map((value) => Number(value.toFixed(2))),
      event_tail_ms: Number(eventTailMs.toFixed(2)),
      event_tail_bytes_scanned: tailScan.bytes_scanned,
      event_file_bytes: tailScan.file_bytes,
      semantic_diff_nodes: 2_500,
      semantic_diff_changed: semanticDiff.summary.changed_count,
      semantic_diff_ms: Number(semanticDiffMs.toFixed(2)),
      mcp_cold_start_ms: Number(mcpColdStartMs.toFixed(2)),
      output_fixture_sessions: diagnosticSessions.length,
      full_response_bytes: Buffer.byteLength(fullResponse),
      compact_response_bytes: Buffer.byteLength(compactResponse),
      compact_reduction_pct: Number((compactReductionRatio * 100).toFixed(2)),
      full_serialize_ms: Number(fullSerializeMs.toFixed(2)),
      compact_serialize_ms: Number(compactSerializeMs.toFixed(2)),
      bounded_runtime_stores: boundedStoreStats,
      budgets_ms: {
        evidence: 250,
        run_lifecycle: RUN_LIFECYCLE_BUDGET_MS,
        run_lifecycle_sample_count: RUN_LIFECYCLE_SAMPLE_COUNT,
        run_event_p95: 200,
        run_event_p99: 500,
        indexed_run_writes: INDEXED_RUN_WRITE_ABSOLUTE_ROUND_BUDGET_MS,
        indexed_run_writes_total: INDEXED_RUN_WRITE_TOTAL_BUDGET_MS,
        indexed_run_writes_relative_floor: INDEXED_RUN_WRITE_RELATIVE_FLOOR_MS,
        indexed_run_writes_relative_ratio: INDEXED_RUN_WRITE_RELATIVE_RATIO_BUDGET,
        indexed_run_list: 500,
        event_tail: 250,
        semantic_diff: SEMANTIC_DIFF_BUDGET_MS,
        mcp_cold_start: 3_000,
        outcome_serialize: 50,
      },
    })}\n`);
    return 0;
  } finally {
    if (previousRunRoot === undefined) {
      delete process.env.BROWSER_STRUCTURED_RUN_ROOT;
    } else {
      process.env.BROWSER_STRUCTURED_RUN_ROOT = previousRunRoot;
    }
    await rm(runRoot, { recursive: true, force: true });
  }
}

try {
  process.exitCode = await main();
} catch (error) {
  process.stderr.write(`performance-smoke failed: ${String(error?.message ?? error)}\n`);
  process.exitCode = 1;
}
