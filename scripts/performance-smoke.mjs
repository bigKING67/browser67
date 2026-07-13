#!/usr/bin/env node
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { performance } from "node:perf_hooks";

import { normalizeEvidenceRecord } from "../src/evidence-schema.mjs";
import { handleBrowserRunOps } from "../src/run-lifecycle.mjs";

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
    for (let index = 0; index < 100; index += 1) {
      const eventStarted = performance.now();
      await handleBrowserRunOps({
        action: "record_event",
        workspace_key: "performance-smoke",
        run_id: runId,
        event: "tick",
        data: { index },
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

    assertBudget("evidence normalization", evidenceMs, 250);
    assertBudget("run lifecycle io", runMs, 2_500);
    assertBudget("run event p95", runEventP95Ms, 200);
    assertBudget("run event p99", runEventP99Ms, 500);
    process.stdout.write(`${JSON.stringify({
      ok: true,
      evidence_records: 5_000,
      run_events: 100,
      evidence_ms: Number(evidenceMs.toFixed(2)),
      run_ms: Number(runMs.toFixed(2)),
      run_event_p95_ms: Number(runEventP95Ms.toFixed(2)),
      run_event_p99_ms: Number(runEventP99Ms.toFixed(2)),
      budgets_ms: {
        evidence: 250,
        run_lifecycle: 2_500,
        run_event_p95: 200,
        run_event_p99: 500,
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
