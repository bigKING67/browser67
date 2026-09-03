#!/usr/bin/env node

import assert from "node:assert/strict";
import { chmod, mkdir, mkdtemp, readFile, readdir, rm, stat, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { appendGateEvent } from "./browser67-live-gate/event-log.mjs";
import {
  assertSafeBrowserHome,
  auditRuntimePermissions,
} from "../scripts/audit-runtime-permissions.mjs";
import { pruneEmptyRunGroups } from "../scripts/prune-empty-run-groups.mjs";
import {
  assertSafeRunRoot,
  terminalizeStaleRuns,
} from "../scripts/terminalize-stale-runs.mjs";
import { createRunStore } from "../src/runtime/runs/store.mjs";
import { writeState } from "../src/tmwd-hub-control/state.mjs";

const posixModeSupported = process.platform !== "win32";
const fixtureRoot = await mkdtemp(path.join(tmpdir(), "browser67-runtime-maintenance-"));

try {
  const browserHome = path.join(fixtureRoot, "fixture-browser67");
  const runRoot = path.join(browserHome, "runtime", "runs");
  const publicDirectory = path.join(browserHome, "runtime", "legacy-group");
  const publicFile = path.join(publicDirectory, "legacy.json");
  const registryDirectory = path.join(browserHome, "tab-workspace");
  const registryFile = path.join(registryDirectory, "managed-tabs.json");
  await mkdir(publicDirectory, { recursive: true });
  await writeFile(publicFile, "{}\n", "utf8");
  await mkdir(registryDirectory, { recursive: true });
  await writeFile(registryFile, "{\"version\":3,\"managed_tabs\":[]}\n", "utf8");
  if (posixModeSupported) {
    await symlink(publicFile, path.join(publicDirectory, "legacy-link.json"));
  }

  const oldClock = new Date("2026-01-01T00:00:00.000Z");
  const staleStore = createRunStore({ root: runRoot, clock: () => oldClock });
  await staleStore.prepare({
    workspace_key: "runtime-maintenance",
    run_id: "stale-running",
  });
  await staleStore.dispose();

  if (posixModeSupported) {
    await chmod(browserHome, 0o755);
    await chmod(path.join(browserHome, "runtime"), 0o755);
    await chmod(publicDirectory, 0o755);
    await chmod(publicFile, 0o644);
    await chmod(registryDirectory, 0o755);
    await chmod(registryFile, 0o644);
  }

  assert.equal(assertSafeBrowserHome(browserHome), browserHome);
  assert.throws(() => assertSafeBrowserHome(path.parse(browserHome).root), /refusing unsafe browser67 home/);
  assert.equal(assertSafeRunRoot(runRoot), runRoot);
  assert.throws(() => assertSafeRunRoot(browserHome), /dedicated runs directory/);

  const permissionDryRun = await auditRuntimePermissions({
    home: browserHome,
    write: false,
    max_items: 100,
  });
  assert.equal(permissionDryRun.ok, true);
  assert.equal(permissionDryRun.platform_supported, posixModeSupported);
  assert.equal(permissionDryRun.changed_count, 0);
  assert.equal(permissionDryRun.skipped_count, 1);
  if (posixModeSupported) {
    assert.ok(permissionDryRun.mismatch_count >= 6);
    assert.equal((await stat(publicFile)).mode & 0o777, 0o644);
    assert.equal((await stat(registryDirectory)).mode & 0o777, 0o755);
    assert.equal((await stat(registryFile)).mode & 0o777, 0o644);
  } else {
    assert.equal(permissionDryRun.skipped, true);
    assert.equal(permissionDryRun.skip_reason, "posix_modes_unsupported");
    assert.equal(permissionDryRun.mismatch_count, 0);
  }

  const simulatedWindowsAudit = await auditRuntimePermissions({
    home: browserHome,
    write: true,
    platform: "win32",
  });
  assert.equal(simulatedWindowsAudit.ok, true);
  assert.equal(simulatedWindowsAudit.platform_supported, false);
  assert.equal(simulatedWindowsAudit.skipped, true);
  assert.equal(simulatedWindowsAudit.skip_reason, "posix_modes_unsupported");
  assert.equal(simulatedWindowsAudit.mismatch_count, 0);
  assert.equal(simulatedWindowsAudit.changed_count, 0);
  if (posixModeSupported) {
    assert.equal((await stat(publicFile)).mode & 0o777, 0o644);
  }

  const permissionWrite = await auditRuntimePermissions({
    home: browserHome,
    write: true,
    max_items: 100,
  });
  assert.equal(permissionWrite.ok, true);
  assert.equal(permissionWrite.platform_supported, posixModeSupported);
  if (posixModeSupported) {
    assert.equal(permissionWrite.changed_count, permissionDryRun.mismatch_count);
    assert.equal((await stat(browserHome)).mode & 0o777, 0o700);
    assert.equal((await stat(publicDirectory)).mode & 0o777, 0o700);
    assert.equal((await stat(publicFile)).mode & 0o777, 0o600);
    assert.equal((await stat(registryDirectory)).mode & 0o777, 0o700);
    assert.equal((await stat(registryFile)).mode & 0o777, 0o600);
  }
  const privateEventPath = path.join(browserHome, "runtime", "private-events", "events.ndjson");
  const eventResult = appendGateEvent({
    event_log_enabled: true,
    event_log_path: privateEventPath,
    tmwd_mode: "tmwd",
    tmwd_transport: "ws",
  }, { ok: true, check: "private-event-writer" });
  assert.equal(eventResult.ok, true);
  const privateStatePath = path.join(browserHome, "runtime", "private-state", "hub-state.json");
  await writeState(privateStatePath, { pid: 67 });
  if (posixModeSupported) {
    assert.equal((await stat(path.dirname(privateEventPath))).mode & 0o777, 0o700);
    assert.equal((await stat(privateEventPath)).mode & 0o777, 0o600);
    assert.equal((await stat(path.dirname(privateStatePath))).mode & 0o777, 0o700);
    assert.equal((await stat(privateStatePath)).mode & 0o777, 0o600);
  }
  const permissionAfter = await auditRuntimePermissions({ home: browserHome, write: false });
  assert.equal(permissionAfter.mismatch_count, 0);
  assert.equal(permissionAfter.skipped_count, 1);
  const launchdSource = await readFile(new URL("../scripts/install-launchd.mjs", import.meta.url), "utf8");
  assert.match(launchdSource, /<key>Umask<\/key>\s*<integer>63<\/integer>/);

  const staleDryRun = await terminalizeStaleRuns({
    run_root: runRoot,
    stale_running_after_minutes: 60,
    write: false,
    max_items: 10,
  });
  assert.equal(staleDryRun.dry_run, true);
  assert.equal(staleDryRun.candidate_count, 1);
  assert.equal(staleDryRun.would_terminalize_count, 1);
  assert.equal(staleDryRun.before.stale_running_count, 1);
  assert.equal(staleDryRun.after.stale_running_count, 1);
  const runJsonPath = path.join(runRoot, "runtime-maintenance", "stale-running", "run.json");
  assert.equal(JSON.parse(await readFile(runJsonPath, "utf8")).status, "running");

  const staleWrite = await terminalizeStaleRuns({
    run_root: runRoot,
    stale_running_after_minutes: 60,
    write: true,
    max_items: 10,
  });
  assert.equal(staleWrite.ok, true);
  assert.equal(staleWrite.terminalized_count, 1);
  assert.equal(staleWrite.after.stale_running_count, 0);
  assert.equal(JSON.parse(await readFile(runJsonPath, "utf8")).status, "interrupted");

  const emptyGroupPath = path.join(runRoot, "empty-index-group");
  await mkdir(emptyGroupPath, { recursive: true });
  await writeFile(path.join(emptyGroupPath, "index.ndjson"), "", "utf8");
  await writeFile(path.join(emptyGroupPath, "index.meta.json"), `${JSON.stringify({
    unique_count: 0,
    entry_count: 0,
  })}\n`, "utf8");
  const protectedGroupPath = path.join(runRoot, "protected-group");
  await mkdir(path.join(protectedGroupPath, "run-directory"), { recursive: true });
  const emptyGroupDryRun = await pruneEmptyRunGroups({
    run_root: runRoot,
    write: false,
    max_items: 10,
  });
  assert.equal(emptyGroupDryRun.dry_run, true);
  assert.equal(emptyGroupDryRun.candidate_count, 1);
  assert.equal(emptyGroupDryRun.candidates[0].group, "empty-index-group");
  assert.equal((await readdir(runRoot)).includes("empty-index-group"), true);
  const emptyGroupWrite = await pruneEmptyRunGroups({
    run_root: runRoot,
    write: true,
    max_items: 10,
  });
  assert.equal(emptyGroupWrite.removed_count, 1);
  assert.equal((await readdir(runRoot)).includes("empty-index-group"), false);
  assert.equal((await readdir(runRoot)).includes("protected-group"), true);

  process.stdout.write(`${JSON.stringify({
    ok: true,
    check: "runtime-maintenance-contract",
    permission_dry_run: true,
    permission_apply: true,
    windows_posix_mode_skip: true,
    private_runtime_writers: true,
    launchd_private_umask: true,
    symlink_not_followed: true,
    stale_terminalization_dry_run: true,
    stale_terminalization_apply: true,
    empty_group_prune_dry_run: true,
    empty_group_prune_apply: true,
    destructive_delete: false,
    posix_mode_verified: posixModeSupported,
  })}\n`);
} finally {
  await rm(fixtureRoot, { recursive: true, force: true });
}
