#!/usr/bin/env node

import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { writeScreenshotArtifact } from "../src/browser-screenshot/artifact.mjs";
import {
  RUN_INDEX_SCHEMA_VERSION,
  RUN_SCHEMA_VERSION,
  createRunStore,
} from "../src/runtime/runs/store.mjs";
import { scanNdjsonBackwards } from "../src/runtime/storage/ndjson.mjs";

async function main() {
  const root = await mkdtemp(path.join(tmpdir(), "browser67-run-store-"));
  try {
    const store = createRunStore({ root, checkpoint_interval_ms: 60_000 });
    const prepared = await store.prepare({
      workspace_key: "run-store-contract",
      run_id: "long-run",
      title: "long run",
    });
    assert.equal(prepared.ok, true);
    assert.equal(prepared.run.schema_version, RUN_SCHEMA_VERSION);

    let checkpointWrites = 0;
    for (let index = 0; index < 2_000; index += 1) {
      const recorded = await store.recordEvent({
        workspace_key: "run-store-contract",
        run_id: "long-run",
        event: "tick",
        data: { index, payload: "x".repeat(128) },
      });
      if (recorded.checkpoint_written) checkpointWrites += 1;
    }
    assert.equal(checkpointWrites, 0);

    const status = await store.status({
      workspace_key: "run-store-contract",
      run_id: "long-run",
      max_items: 5,
    });
    assert.equal(status.ok, true);
    assert.equal(status.recent_events.length, 5);
    assert.deepEqual(status.recent_events.map((event) => event.data.index), [1995, 1996, 1997, 1998, 1999]);
    assert.equal(status.run.event_count, 2_001);

    const runDir = prepared.run.run_dir;
    const persistedBeforeFinish = JSON.parse(await readFile(path.join(runDir, "run.json"), "utf8"));
    assert.equal(persistedBeforeFinish.event_count, 1);

    const eventScan = await scanNdjsonBackwards(path.join(runDir, "events.ndjson"), {
      on_record: (_record, count) => count < 5,
    });
    assert.equal(eventScan.records.length, 5);
    assert.equal(eventScan.stopped, true);
    assert.ok(eventScan.bytes_scanned < eventScan.file_bytes);

    const finished = await store.finish({
      workspace_key: "run-store-contract",
      run_id: "long-run",
      status: "success",
    });
    assert.equal(finished.checkpoint_written, true);
    assert.equal(finished.run.event_count, 2_002);

    const listed = await store.list({ workspace_key: "run-store-contract" });
    assert.equal(listed.total, 1);
    assert.equal(listed.runs.length, 1);
    assert.equal(listed.runs[0].status, "success");
    const listedSummary = await store.list({
      workspace_key: "run-store-contract",
      summary_only: true,
    });
    assert.equal(listedSummary.total, 1);
    assert.equal(listedSummary.returned_count, 0);
    assert.deepEqual(listedSummary.runs, []);
    const indexRows = (await readFile(path.join(root, "run-store-contract", "index.ndjson"), "utf8"))
      .trim()
      .split("\n")
      .filter(Boolean)
      .map((line) => JSON.parse(line));
    assert.ok(indexRows.length <= 3);
    assert.ok(indexRows.every((row) => row.schema_version === RUN_INDEX_SCHEMA_VERSION));

    const legacyDir = path.join(root, "legacy", "legacy-run");
    await mkdir(legacyDir, { recursive: true });
    await writeFile(path.join(legacyDir, "run.json"), `${JSON.stringify({
      schema_version: "tmwd.run.v1",
      run_id: "legacy-run",
      group: "legacy",
      run_dir: legacyDir,
      status: "success",
      created_at: "2026-01-01T00:00:00.000Z",
      updated_at: "2026-01-01T00:00:01.000Z",
    })}\n`, "utf8");
    const untrackedRunDir = path.join(root, "untracked", "artifact-only-run", "artifacts");
    await mkdir(untrackedRunDir, { recursive: true });
    await writeFile(path.join(untrackedRunDir, "evidence.bin"), Buffer.alloc(32, "u"));
    const inspection = await store.inspect();
    assert.equal(inspection.legacy_run_count, 1);
    assert.equal(inspection.run_count, 2);
    assert.equal(inspection.status_counts.success, 2);
    assert.equal(inspection.terminal_run_count, 2);
    assert.equal(inspection.running_run_count, 0);
    assert.equal(inspection.group_count, 3);
    assert.equal(inspection.runtime_directory_count, 3);
    assert.equal(inspection.untracked_run_directory_count, 1);
    const inspectionSummary = await store.inspect({
      summary_only: true,
      include_storage: true,
    });
    assert.deepEqual(inspectionSummary.groups, []);
    assert.equal(inspectionSummary.summary_only, true);
    assert.equal(inspectionSummary.storage.included, true);
    assert.equal(inspectionSummary.storage.bytes > 0, true);
    assert.equal(inspectionSummary.storage.untracked_run_bytes > 0, true);
    await store.migrate();
    const migrated = JSON.parse(await readFile(path.join(legacyDir, "run.json"), "utf8"));
    assert.equal(migrated.schema_version, RUN_SCHEMA_VERSION);

    const screenshotStore = createRunStore({
      root: path.join(root, "screenshot-runs"),
      checkpoint_interval_ms: 0,
    });
    const png = Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
      "base64",
    );
    const implicitScreenshot = await writeScreenshotArtifact({
      args: { workspace_key: "implicit-screenshot" },
      bytes: png,
      run_options: { runStore: screenshotStore },
    });
    assert.equal(implicitScreenshot.run_prepared, true);
    assert.equal(implicitScreenshot.run_mode, "implicit");
    assert.equal(implicitScreenshot.run_terminalized, true);
    assert.equal(implicitScreenshot.run_requires_finish, false);
    assert.equal(implicitScreenshot.run.status, "success");
    assert.equal(typeof implicitScreenshot.run.finished_at, "string");
    assert.equal(implicitScreenshot.run.summary.artifact_count, 1);

    await screenshotStore.prepare({
      workspace_key: "explicit-screenshot",
      run_id: "caller-owned-run",
    });
    const explicitScreenshot = await writeScreenshotArtifact({
      args: {
        workspace_key: "explicit-screenshot",
        run_id: "caller-owned-run",
      },
      bytes: png,
      run_options: { runStore: screenshotStore },
    });
    assert.equal(explicitScreenshot.run_prepared, false);
    assert.equal(explicitScreenshot.run_mode, "explicit");
    assert.equal(explicitScreenshot.run_terminalized, false);
    assert.equal(explicitScreenshot.run_requires_finish, true);
    assert.equal(explicitScreenshot.run.status, "running");
    await screenshotStore.finish({
      workspace_key: "explicit-screenshot",
      run_id: "caller-owned-run",
      status: "success",
    });

    let auditClock = new Date("2026-08-27T00:00:00.000Z");
    const staleAuditStore = createRunStore({
      root: path.join(root, "stale-audit-runs"),
      clock: () => auditClock,
    });
    await staleAuditStore.prepare({
      workspace_key: "stale-audit",
      run_id: "stale-running-run",
    });
    auditClock = new Date("2026-08-27T03:00:00.000Z");
    const staleAudit = await staleAuditStore.inspect({
      summary_only: true,
      stale_running_after_minutes: 120,
    });
    assert.equal(staleAudit.running_run_count, 1);
    assert.equal(staleAudit.stale_running_count, 1);
    assert.equal(staleAudit.current_running_run_count, 1);
    assert.equal(staleAudit.legacy_running_run_count, 0);
    assert.equal(staleAudit.current_stale_running_count, 1);
    assert.equal(staleAudit.legacy_stale_running_count, 0);
    assert.equal(staleAudit.status_counts.running, 1);

    const tempFiles = (await readdir(runDir)).filter((name) => name.endsWith(".tmp"));
    assert.deepEqual(tempFiles, []);

    const boundedStore = createRunStore({
      root: path.join(root, "bounded-cache"),
      max_cached_runs: 4,
    });
    for (let index = 0; index < 12; index += 1) {
      await boundedStore.prepare({
        workspace_key: "bounded",
        run_id: `run-${index}`,
      });
    }
    assert.equal(boundedStore.stats().cached_run_count, 4);
    assert.equal(boundedStore.stats().checkpoint_state_count, 4);
    await boundedStore.dispose();
    assert.equal(boundedStore.stats().cached_run_count, 0);

    process.stdout.write(`${JSON.stringify({
      ok: true,
      check: "run-store-contract",
      event_count: finished.run.event_count,
      checkpoint_writes_during_events: checkpointWrites,
      tail_bytes_scanned: eventScan.bytes_scanned,
      event_file_bytes: eventScan.file_bytes,
      index_entries: indexRows.length,
      bounded_cache: true,
      migration: true,
      implicit_screenshot_terminal: true,
      explicit_screenshot_caller_owned: true,
      aggregate_run_inspection: true,
    })}\n`);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

main().catch((error) => {
  process.stderr.write(`run-store-contract failed: ${String(error?.stack ?? error)}\n`);
  process.exitCode = 1;
});
