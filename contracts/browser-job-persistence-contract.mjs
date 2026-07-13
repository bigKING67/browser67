#!/usr/bin/env node

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

const repoRoot = path.resolve(import.meta.dirname, "..");

function runRecoveryProbe(runRoot, jobId) {
  const source = [
    "import { handleBrowserJobOps } from './src/server/browser-core/job.mjs';",
    `const result = await handleBrowserJobOps({ action: 'result', job_id: ${JSON.stringify(jobId)} });`,
    "process.stdout.write(JSON.stringify(result));",
  ].join("\n");
  const result = spawnSync(process.execPath, ["--input-type=module", "--eval", source], {
    cwd: repoRoot,
    encoding: "utf8",
    env: {
      ...process.env,
      BROWSER_STRUCTURED_RUN_ROOT: runRoot,
    },
    timeout: 15_000,
  });
  assert.equal(result.status, 0, String(result.stderr || result.stdout));
  return JSON.parse(String(result.stdout || "").trim());
}

async function main() {
  const root = await mkdtemp(path.join(tmpdir(), "browser67-job-persistence-"));
  const workspaceKey = "recovery-contract";
  const runId = "run-recovery-contract";
  const jobId = "job_recovery_contract";
  const runDir = path.join(root, workspaceKey, runId);
  const statePath = path.join(runDir, "jobs", `${jobId}.json`);
  const startedAt = "2026-07-13T00:00:00.000Z";
  try {
    await mkdir(path.dirname(statePath), { recursive: true });
    await writeFile(path.join(runDir, "run.json"), `${JSON.stringify({
      schema_version: "tmwd.run.v1",
      run_id: runId,
      group: workspaceKey,
      workspace_key: workspaceKey,
      task_id: "",
      status: "running",
      run_dir: runDir,
    }, null, 2)}\n`, "utf8");
    await writeFile(statePath, `${JSON.stringify({
      schema_version: "tmwd.browser.job.v2",
      job_id: jobId,
      status: "running",
      durable: true,
      durability_reason: "run_backed_checkpoint",
      abort_supported: false,
      cancel_requested: false,
      cancel_outcome: "not_requested",
      workspace_key: workspaceKey,
      task_id: "",
      run_id: runId,
      run_dir: runDir,
      title: "recovery fixture",
      created_at: startedAt,
      started_at: startedAt,
      updated_at: startedAt,
      finished_at: null,
      checkpoint_at: startedAt,
      execution_deadline_at: null,
      recovery_status: "not_needed",
      interrupted_reason: null,
      result_available: false,
    }, null, 2)}\n`, "utf8");

    const result = runRecoveryProbe(root, jobId);
    assert.equal(result.ok, true);
    assert.equal(result.result_available, true);
    assert.equal(result.job.schema_version, "tmwd.browser.job.v2");
    assert.equal(result.job.status, "interrupted");
    assert.equal(result.job.durable, true);
    assert.equal(result.job.abort_supported, false);
    assert.equal(result.job.recovery_status, "interrupted_after_restart");
    assert.match(result.job.interrupted_reason, /MCP restarted/);
    assert.equal(result.job.result.status, "interrupted");

    const persisted = JSON.parse(await readFile(statePath, "utf8"));
    assert.equal(persisted.status, "interrupted");
    assert.equal(persisted.result_available, true);
    assert.equal(typeof persisted.checkpoint_at, "string");

    process.stdout.write(`${JSON.stringify({
      ok: true,
      check: "browser-job-persistence-contract",
      recovered_status: result.job.status,
      recovery_status: result.job.recovery_status,
      abort_supported: result.job.abort_supported,
    })}\n`);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

main().catch((error) => {
  process.stderr.write(`browser-job-persistence-contract failed: ${String(error?.message ?? error)}\n`);
  process.exitCode = 1;
});
