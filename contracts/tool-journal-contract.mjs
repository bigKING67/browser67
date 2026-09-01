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
  await journal.dispose();
  const raw = await readFile(journalPath, "utf8");
  assert.equal((await stat(journalPath)).mode & 0o777, 0o600);
  const event = JSON.parse(raw.trim());
  assert.equal(event.schema_version, TOOL_JOURNAL_SCHEMA_VERSION);
  assert.equal(event.tool, "browser_execute_js");
  assert.equal(event.tab_id, "tab-a");
  assert.equal(event.result.transport, "tmwd_ws");
  assert.equal(event.result.returned_count, 3);
  assert.equal(event.duration_ms, 12.35);
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
  assert.equal((await stat(`${rotatingPath}.1`)).mode & 0o777, 0o600);
  assert.match(await readFile(`${rotatingPath}.1`, "utf8"), /"tool":"first"/);
  assert.match(await readFile(rotatingPath, "utf8"), /"tool":"second"/);
  process.stdout.write(`${JSON.stringify({
    ok: true,
    check: "tool-journal-contract",
    schema_version: event.schema_version,
    privacy_fields_excluded: true,
    bounded_rotation: true,
  })}\n`);
} finally {
  await rm(root, { recursive: true, force: true });
}
