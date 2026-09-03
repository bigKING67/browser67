#!/usr/bin/env node

import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import {
  TOOL_JOURNAL_SCHEMA_VERSION,
  createToolJournal,
} from "../src/runtime/tool-journal.mjs";

const root = await mkdtemp(path.join(tmpdir(), "browser67-tool-journal-"));
const posixModeSupported = process.platform !== "win32";
try {
  const journalPath = path.join(root, "events.ndjson");
  const journal = createToolJournal({
    path: journalPath,
    clock: () => new Date("2026-09-01T00:00:00.000Z"),
  });
  await journal.record({
    runtime_id: "runtime-contract",
    request_id: "request-contract",
    surface: "browser",
    tool: "browser_execute_js",
    status: "success",
    duration_ms: 12.345,
    args: {
      action: "execute",
      browser_instance_id: "browser-a",
      tab_id: "tab-a",
      workspace_key: "workspace-a",
      task_id: "task-a",
      url: "https://private.example/account",
      script: "return document.cookie",
      input: { password: "never-write-me" },
      focus_policy: "background_preferred",
    },
    result: {
      transport: "tmwd_ws",
      created: false,
      returned_count: 3,
      html: "private page body",
    },
  });
  await journal.record({
    runtime_id: "runtime-contract",
    request_id: "request-lifecycle",
    surface: "browser",
    tool: "browser_tab_lifecycle",
    status: "success",
    args: { action: "finalize_task", workspace_key: "workspace-a", task_id: "task-a" },
    result: {
      cleanup_summary: {
        closed_count: 2,
        released_count: 1,
        stale_pruned_count: 4,
        remaining_unkept_count: 0,
      },
    },
  });
  await journal.record({
    runtime_id: "runtime-contract",
    request_id: "request-screenshot",
    surface: "browser",
    tool: "browser_screenshot_ops",
    status: "error",
    error_code: "SCREENSHOT_VIEWPORT_OVERRIDE_MISMATCH",
    retryable: true,
    args: {
      action: "capture",
      target: "selector",
      viewport: { width: 390, height: 844, dpr: 2 },
    },
    error_details: {
      failed_phase: "viewport_capture",
      verification: {
        page: {
          actual: { width: 1512, height: 810, dpr: 2 },
        },
      },
    },
  });
  await journal.record({
    runtime_id: "runtime-contract",
    request_id: "request-screenshot-success",
    surface: "browser",
    tool: "browser_screenshot_ops",
    status: "success",
    args: {
      action: "capture",
      target: "viewport",
      viewport: { width: 390, height: 844, dpr: 2 },
    },
    result: {
      viewport_override: {
        verification: {
          page: { actual: { width: 390, height: 844, dpr: 2 } },
        },
      },
      artifact: { width: 780, height: 1688, bytes: 67_000 },
      run: { terminalized: true },
    },
  });
  await journal.dispose();
  const raw = await readFile(journalPath, "utf8");
  if (posixModeSupported) {
    assert.equal((await stat(root)).mode & 0o777, 0o700);
    assert.equal((await stat(journalPath)).mode & 0o777, 0o600);
  }
  const events = raw.trim().split("\n").map((line) => JSON.parse(line));
  const event = events.find((entry) => entry.request_id === "request-contract");
  assert.equal(event.schema_version, TOOL_JOURNAL_SCHEMA_VERSION);
  assert.equal(event.tool, "browser_execute_js");
  assert.equal(event.tab_id, "tab-a");
  assert.equal(event.result.transport, "tmwd_ws");
  assert.equal(event.result.returned_count, 3);
  assert.equal(event.duration_ms, 12.35);
  const lifecycleEvent = events.find((entry) => entry.request_id === "request-lifecycle");
  assert.equal(lifecycleEvent.result.closed_count, 2);
  assert.equal(lifecycleEvent.result.released_count, 1);
  assert.equal(lifecycleEvent.result.stale_pruned_count, 4);
  assert.equal(lifecycleEvent.result.remaining_unkept_count, 0);
  const failedScreenshotEvent = events.find((entry) => entry.request_id === "request-screenshot");
  assert.equal(failedScreenshotEvent.failed_phase, "viewport_capture");
  assert.equal(failedScreenshotEvent.result.screenshot.requested_width, 390);
  assert.equal(failedScreenshotEvent.result.screenshot.actual_width, 1512);
  assert.equal(failedScreenshotEvent.result.screenshot.artifact_written, false);
  const successfulScreenshotEvent = events.find((entry) => entry.request_id === "request-screenshot-success");
  assert.equal(successfulScreenshotEvent.result.screenshot.actual_width, 390);
  assert.equal(successfulScreenshotEvent.result.screenshot.artifact_width, 780);
  assert.equal(successfulScreenshotEvent.result.screenshot.artifact_height, 1688);
  assert.equal(successfulScreenshotEvent.result.screenshot.artifact_bytes, 67_000);
  assert.equal(successfulScreenshotEvent.result.run_terminalized, true);
  for (const forbidden of [
    "private.example",
    "document.cookie",
    "never-write-me",
    "private page body",
    "password",
  ]) {
    assert.equal(raw.includes(forbidden), false, `journal leaked forbidden value: ${forbidden}`);
  }
  const rotatingPath = path.join(root, "rotating.ndjson");
  const rotatingJournal = createToolJournal({ path: rotatingPath, max_bytes: 1 });
  await rotatingJournal.record({ tool: "first", status: "success" });
  await rotatingJournal.record({ tool: "second", status: "success" });
  const rotationStats = await rotatingJournal.dispose();
  assert.equal(rotationStats.rotation_count, 1);
  if (posixModeSupported) {
    assert.equal((await stat(`${rotatingPath}.1`)).mode & 0o777, 0o600);
  }
  assert.match(await readFile(`${rotatingPath}.1`, "utf8"), /"tool":"first"/);
  assert.match(await readFile(rotatingPath, "utf8"), /"tool":"second"/);
  process.stdout.write(`${JSON.stringify({
    ok: true,
    check: "tool-journal-contract",
    schema_version: event.schema_version,
    privacy_fields_excluded: true,
    bounded_rotation: true,
    nested_lifecycle_counts: true,
    screenshot_receipts: true,
    posix_mode_verified: posixModeSupported,
  })}\n`);
} finally {
  await rm(root, { recursive: true, force: true });
}
