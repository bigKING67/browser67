#!/usr/bin/env node

import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

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
    const inspection = await store.inspect();
    assert.equal(inspection.legacy_run_count, 1);
    await store.migrate();
    const migrated = JSON.parse(await readFile(path.join(legacyDir, "run.json"), "utf8"));
    assert.equal(migrated.schema_version, RUN_SCHEMA_VERSION);

    const tempFiles = (await readdir(runDir)).filter((name) => name.endsWith(".tmp"));
    assert.deepEqual(tempFiles, []);

    process.stdout.write(`${JSON.stringify({
      ok: true,
      check: "run-store-contract",
      event_count: finished.run.event_count,
      checkpoint_writes_during_events: checkpointWrites,
      tail_bytes_scanned: eventScan.bytes_scanned,
      event_file_bytes: eventScan.file_bytes,
      index_entries: indexRows.length,
      migration: true,
    })}\n`);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

main().catch((error) => {
  process.stderr.write(`run-store-contract failed: ${String(error?.stack ?? error)}\n`);
  process.exitCode = 1;
});
