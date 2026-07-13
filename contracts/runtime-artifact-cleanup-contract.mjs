#!/usr/bin/env node
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";

function isoDaysAgo(days) {
  return new Date(Date.now() - days * 86_400_000).toISOString();
}

async function writeRun(root, group, runId, options = {}) {
  const runDir = path.join(root, group, runId);
  const artifactsDir = path.join(runDir, "artifacts");
  const logsDir = path.join(runDir, "logs");
  await fs.mkdir(artifactsDir, { recursive: true });
  await fs.mkdir(logsDir, { recursive: true });
  const updatedAt = options.updated_at ?? isoDaysAgo(1);
  const payload = {
    schema_version: "tmwd.run.v1",
    run_id: runId,
    group,
    workspace_key: group,
    task_id: "",
    title: runId,
    status: options.status ?? "success",
    created_at: options.created_at ?? updatedAt,
    updated_at: updatedAt,
    finished_at: options.finished_at ?? updatedAt,
    root,
    run_dir: runDir,
    artifacts_dir: artifactsDir,
    logs_dir: logsDir,
  };
  await fs.writeFile(path.join(runDir, "run.json"), `${JSON.stringify(payload, null, 2)}\n`);
  await fs.writeFile(
    path.join(artifactsDir, `${runId}.bin`),
    Buffer.alloc(options.bytes ?? 16, runId.slice(0, 1) || "x"),
  );
  return runDir;
}

function runCleanup(args = []) {
  const result = spawnSync("node", ["scripts/cleanup-runtime-artifacts.mjs", "--json", ...args], {
    cwd: process.cwd(),
    encoding: "utf8",
  });
  const text = String(result.stdout || result.stderr || "").trim();
  let payload = null;
  if (text.startsWith("{")) {
    payload = JSON.parse(text);
  }
  return {
    status: result.status,
    stdout: result.stdout,
    stderr: result.stderr,
    payload,
  };
}

async function exists(filePath) {
  return fs.access(filePath).then(() => true, () => false);
}

async function assertAgeDryRunAndWrite(root) {
  const oldRun = await writeRun(root, "visual", "old-run", {
    updated_at: isoDaysAgo(40),
    bytes: 64,
  });
  const recentRun = await writeRun(root, "visual", "recent-run", {
    updated_at: isoDaysAgo(1),
    bytes: 64,
  });
  const activeRun = await writeRun(root, "visual", "active-run", {
    status: "running",
    updated_at: new Date().toISOString(),
    bytes: 64,
  });

  const dryRun = runCleanup([
    "--run-root", root,
    "--max-age-days", "30",
    "--max-total-mb", "0",
    "--keep-latest", "1",
  ]);
  assert.equal(dryRun.status, 0, dryRun.stderr || dryRun.stdout);
  assert.equal(dryRun.payload?.dry_run, true);
  assert.equal(dryRun.payload?.planned_delete_count, 1);
  assert.equal(dryRun.payload?.planned?.[0]?.run_id, "old-run");
  assert.equal(await exists(oldRun), true, "dry-run must not delete old run");
  assert.equal(await exists(recentRun), true, "dry-run must not delete recent run");
  assert.equal(await exists(activeRun), true, "dry-run must not delete active run");

  const write = runCleanup([
    "--run-root", root,
    "--max-age-days", "30",
    "--max-total-mb", "0",
    "--keep-latest", "1",
    "--write",
  ]);
  assert.equal(write.status, 0, write.stderr || write.stdout);
  assert.equal(write.payload?.dry_run, false);
  assert.equal(write.payload?.deleted_count, 1);
  assert.equal(await exists(oldRun), false, "write mode should delete old run");
  assert.equal(await exists(recentRun), true, "write mode should keep recent run");
  assert.equal(await exists(activeRun), true, "write mode should keep active run");
}

async function assertSizeBudget(root) {
  await writeRun(root, "budget", "budget-oldest", {
    updated_at: isoDaysAgo(10),
    bytes: 2000,
  });
  await writeRun(root, "budget", "budget-older", {
    updated_at: isoDaysAgo(9),
    bytes: 2000,
  });
  await writeRun(root, "budget", "budget-newer", {
    updated_at: isoDaysAgo(8),
    bytes: 2000,
  });
  await writeRun(root, "budget", "budget-newest", {
    updated_at: isoDaysAgo(1),
    bytes: 2000,
  });

  const budget = runCleanup([
    "--run-root", root,
    "--max-age-days", "0",
    "--max-total-mb", "0.004",
    "--keep-latest", "1",
  ]);
  assert.equal(budget.status, 0, budget.stderr || budget.stdout);
  assert.equal(budget.payload?.budget_satisfied_after_plan, true);
  assert.equal(budget.payload?.planned_delete_count, 3);
  assert.deepEqual(
    budget.payload?.planned?.map((run) => run.run_id).sort(),
    ["budget-newer", "budget-older", "budget-oldest"],
  );
}

async function assertCountBudget(root) {
  for (let index = 0; index < 4; index += 1) {
    await writeRun(root, "count", `count-${index}`, {
      updated_at: isoDaysAgo(4 - index),
      bytes: 32,
    });
  }
  const countBudget = runCleanup([
    "--run-root", root,
    "--max-age-days", "0",
    "--max-total-mb", "0",
    "--max-run-count", "2",
    "--keep-latest", "1",
  ]);
  assert.equal(countBudget.status, 0, countBudget.stderr || countBudget.stdout);
  assert.equal(countBudget.payload?.planned_delete_count, 2);
  assert.equal(countBudget.payload?.remaining_count_after_plan, 2);
  assert.equal(countBudget.payload?.count_satisfied_after_plan, true);
  assert.deepEqual(
    countBudget.payload?.planned?.map((run) => run.run_id).sort(),
    ["count-0", "count-1"],
  );
}

async function assertUnsafeRootRefusal() {
  const refused = runCleanup([
    "--run-root", os.homedir(),
    "--max-age-days", "1",
  ]);
  assert.notEqual(refused.status, 0);
  assert.equal(refused.payload?.ok, false);
  assert.match(refused.payload?.error ?? "", /refusing/);
}

async function main() {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "tmwd-runtime-cleanup-contract-"));
  try {
    await assertAgeDryRunAndWrite(path.join(tmpDir, "runs"));
    await assertSizeBudget(path.join(tmpDir, "budget-runs"));
    await assertCountBudget(path.join(tmpDir, "count-runs"));
    await assertUnsafeRootRefusal();
    process.stdout.write(`${JSON.stringify({
      ok: true,
      check: "runtime-artifact-cleanup-contract",
    })}\n`);
    return 0;
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
}

try {
  process.exitCode = await main();
} catch (error) {
  process.stderr.write(`runtime artifact cleanup contract failed: ${String(error?.message ?? error)}\n`);
  process.exitCode = 1;
}
