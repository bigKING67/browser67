#!/usr/bin/env node
import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { performance } from "node:perf_hooks";

import { normalizeEvidenceRecord } from "../src/evidence-schema.mjs";
import { handleBrowserRunOps } from "../src/run-lifecycle.mjs";
import { semanticDiffSnapshots } from "../src/browser/content/semantic-diff.mjs";
import { createRunStore } from "../src/runtime/runs/store.mjs";
import { scanNdjsonBackwards } from "../src/runtime/storage/ndjson.mjs";

const RUN_EVENT_COUNT = 2_000;
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

    const runStarted = performance.now();
    const prepared = await handleBrowserRunOps({
      action: "prepare",
      workspace_key: "performance-smoke",
      title: "performance smoke",
    });
    const runId = prepared.run.run_id;
    const eventLatencies = [];
    for (let index = 0; index < RUN_EVENT_COUNT; index += 1) {
      const eventStarted = performance.now();
      await handleBrowserRunOps({
        action: "record_event",
        workspace_key: "performance-smoke",
        run_id: runId,
        event: "tick",
        data: { index, payload: "x".repeat(128) },
      });
      eventLatencies.push(performance.now() - eventStarted);
    }
    await handleBrowserRunOps({
      action: "finish",
      workspace_key: "performance-smoke",
      run_id: runId,
      status: "success",
    });
    const runMs = performance.now() - runStarted;
    const runEventP95Ms = percentile(eventLatencies, 0.95);
    const runEventP99Ms = percentile(eventLatencies, 0.99);

    const runStore = createRunStore({ root: runRoot, checkpoint_interval_ms: 60_000 });
    const scaleGroup = "performance-scale";
    const runListStarted = performance.now();
    for (let index = 0; index < 120; index += 1) {
      const runId = `scale-${String(index).padStart(4, "0")}`;
      await runStore.prepare({ workspace_key: scaleGroup, run_id: runId, title: `Run ${index}` });
      await runStore.finish({ workspace_key: scaleGroup, run_id: runId, status: "success" });
    }
    const runListWriteMs = performance.now() - runListStarted;
    const listStarted = performance.now();
    const listed = await runStore.list({ workspace_key: scaleGroup, max_items: 50 });
    const runListReadMs = performance.now() - listStarted;
    if (listed.total !== 120 || listed.runs.length !== 50) {
      throw new Error(`unexpected indexed run list: total=${listed.total} returned=${listed.runs.length}`);
    }

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

    assertBudget("evidence normalization", evidenceMs, 250);
    assertBudget("run lifecycle io", runMs, 2_500);
    assertBudget("run event p95", runEventP95Ms, 200);
    assertBudget("run event p99", runEventP99Ms, 500);
    assertBudget("indexed run writes", runListWriteMs, 8_000);
    assertBudget("indexed run list", runListReadMs, 500);
    assertBudget("event tail read", eventTailMs, 250);
    assertBudget("semantic diff", semanticDiffMs, SEMANTIC_DIFF_BUDGET_MS);
    assertBudget("MCP cold start", mcpColdStartMs, 3_000);
    process.stdout.write(`${JSON.stringify({
      ok: true,
      evidence_records: 5_000,
      run_events: RUN_EVENT_COUNT,
      evidence_ms: Number(evidenceMs.toFixed(2)),
      run_ms: Number(runMs.toFixed(2)),
      run_event_p95_ms: Number(runEventP95Ms.toFixed(2)),
      run_event_p99_ms: Number(runEventP99Ms.toFixed(2)),
      indexed_runs: 120,
      run_list_write_ms: Number(runListWriteMs.toFixed(2)),
      run_list_read_ms: Number(runListReadMs.toFixed(2)),
      event_tail_ms: Number(eventTailMs.toFixed(2)),
      event_tail_bytes_scanned: tailScan.bytes_scanned,
      event_file_bytes: tailScan.file_bytes,
      semantic_diff_nodes: 2_500,
      semantic_diff_changed: semanticDiff.summary.changed_count,
      semantic_diff_ms: Number(semanticDiffMs.toFixed(2)),
      mcp_cold_start_ms: Number(mcpColdStartMs.toFixed(2)),
      budgets_ms: {
        evidence: 250,
        run_lifecycle: 2_500,
        run_event_p95: 200,
        run_event_p99: 500,
        indexed_run_writes: 8_000,
        indexed_run_list: 500,
        event_tail: 250,
        semantic_diff: SEMANTIC_DIFF_BUDGET_MS,
        mcp_cold_start: 3_000,
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
