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
    for (let index = 0; index < 100; index += 1) {
      await handleBrowserRunOps({
        action: "record_event",
        workspace_key: "performance-smoke",
        run_id: runId,
        event: "tick",
        data: { index },
      });
    }
    await handleBrowserRunOps({
      action: "finish",
      workspace_key: "performance-smoke",
      run_id: runId,
      status: "success",
    });
    const runMs = performance.now() - runStarted;

    assertBudget("evidence normalization", evidenceMs, 250);
    assertBudget("run lifecycle io", runMs, 2_500);
    process.stdout.write(`${JSON.stringify({
      ok: true,
      evidence_records: 5_000,
      run_events: 100,
      evidence_ms: Number(evidenceMs.toFixed(2)),
      run_ms: Number(runMs.toFixed(2)),
      budgets_ms: {
        evidence: 250,
        run_lifecycle: 2_500,
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
