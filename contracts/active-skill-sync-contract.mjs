#!/usr/bin/env node

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  cpSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const repoRoot = path.resolve(import.meta.dirname, "..");

function run(args, expectedStatus = 0) {
  const result = spawnSync(process.execPath, ["scripts/active-skill-sync.mjs", ...args], {
    cwd: repoRoot,
    encoding: "utf8",
    timeout: 30_000,
  });
  if (result.status !== expectedStatus) {
    throw new Error(`active-skill-sync ${args.join(" ")} failed status=${result.status}: ${String(result.stderr || result.stdout).trim()}`);
  }
  return JSON.parse(String(result.stdout ?? "").trim());
}

function copyFixtureSkill(tempRoot, skill) {
  const source = path.resolve(repoRoot, "skills", skill);
  const target = path.resolve(tempRoot, skill);
  cpSync(source, target, { recursive: true });
  return target;
}

function assertDiffAndCheck(tempRoot) {
  const target = copyFixtureSkill(tempRoot, "js-reverse");
  const skillPath = path.resolve(target, "SKILL.md");
  writeFileSync(skillPath, `${readFileSync(skillPath, "utf8")}\nfixture drift\n`);

  const diff = run(["--target", tempRoot, "--skills", "js-reverse", "--json"]);
  assert.equal(diff.ok, false);
  assert.equal(diff.mode, "diff");
  assert.equal(diff.summary.drift_count, 1);
  assert.deepEqual(diff.after[0].changed, ["SKILL.md"]);

  const check = run(["--target", tempRoot, "--skills", "js-reverse", "--json", "--check"], 1);
  assert.equal(check.ok, false);
}

function assertWriteAndBackup(tempRoot) {
  const write = run(["--target", tempRoot, "--skills", "js-reverse", "--json", "--write"]);
  assert.equal(write.ok, true);
  assert.equal(write.mode, "write");
  assert.equal(write.summary.drift_count, 0);
  assert.equal(write.writes.length, 1);
  assert.equal(existsSync(write.writes[0].backup_dir), true);

  const check = run(["--target", tempRoot, "--skills", "js-reverse", "--json", "--check"]);
  assert.equal(check.ok, true);
  assert.equal(check.after[0].status, "current");

  return write.backup_root;
}

function assertBackupListAndRestore(tempRoot, backupDir) {
  const backupId = path.basename(backupDir);
  const list = run(["--target", tempRoot, "--skills", "js-reverse", "--json", "--list-backups"]);
  assert.equal(list.ok, true);
  assert.equal(list.mode, "backups");
  assert.equal(list.backups.some((backup) => backup.id === backupId), true);

  const missingConfirm = spawnSync(process.execPath, [
    "scripts/active-skill-sync.mjs",
    "--target",
    tempRoot,
    "--skills",
    "js-reverse",
    "--json",
    "--restore",
    backupId,
  ], {
    cwd: repoRoot,
    encoding: "utf8",
    timeout: 30_000,
  });
  assert.notEqual(missingConfirm.status, 0);
  assert.match(String(missingConfirm.stderr), /--restore requires --confirm-restore/);

  const restore = run(["--target", tempRoot, "--skills", "js-reverse", "--json", "--restore", backupId, "--confirm-restore"]);
  assert.equal(restore.ok, true);
  assert.equal(restore.mode, "restore");
  assert.equal(restore.summary.restored_count, 1);
  assert.equal(existsSync(restore.current_backup_root), true);
  assert.equal(readFileSync(path.resolve(tempRoot, "js-reverse", "SKILL.md"), "utf8").includes("fixture drift"), true);

  const check = run(["--target", tempRoot, "--skills", "js-reverse", "--json", "--check"], 1);
  assert.equal(check.summary.drift_count, 1);

  const customBackupRoot = path.resolve(tempRoot, "custom-backups");
  const customWrite = run(["--target", tempRoot, "--skills", "js-reverse", "--json", "--write", "--backup-dir", customBackupRoot]);
  assert.equal(path.dirname(customWrite.backup_root), customBackupRoot);
  const customBackupId = path.basename(customWrite.backup_root);
  const customList = run(["--target", tempRoot, "--skills", "js-reverse", "--json", "--list-backups", "--backup-dir", customBackupRoot]);
  assert.equal(customList.backups.some((backup) => backup.id === customBackupId), true);

  const customRestore = run(["--target", tempRoot, "--skills", "js-reverse", "--json", "--restore", customBackupId, "--backup-dir", customBackupRoot, "--confirm-restore"]);
  assert.equal(customRestore.summary.restored_count, 1);
  assert.equal(path.dirname(customRestore.current_backup_root), customBackupRoot);
  assert.match(path.basename(customRestore.current_backup_root), /^pre-restore-/);
  assert.equal(readFileSync(path.resolve(tempRoot, "js-reverse", "SKILL.md"), "utf8").includes("fixture drift"), true);
}

function assertPruneRequiresConfirmation(tempRoot) {
  const result = spawnSync(process.execPath, [
    "scripts/active-skill-sync.mjs",
    "--target",
    tempRoot,
    "--skills",
    "js-reverse",
    "--write",
    "--prune",
    "--json",
  ], {
    cwd: repoRoot,
    encoding: "utf8",
    timeout: 30_000,
  });
  assert.notEqual(result.status, 0);
  assert.match(String(result.stderr), /--prune requires --confirm-prune/);
}

function assertPrune(tempRoot) {
  const extraPath = path.resolve(tempRoot, "js-reverse", "extra.txt");
  writeFileSync(extraPath, "stale extra\n");
  const before = run(["--target", tempRoot, "--skills", "js-reverse", "--json"]);
  assert.equal(before.after[0].extra.includes("extra.txt"), true);

  const write = run(["--target", tempRoot, "--skills", "js-reverse", "--json", "--write", "--prune", "--confirm-prune"]);
  assert.equal(write.ok, true);
  assert.deepEqual(write.writes[0].pruned, ["extra.txt"]);
  assert.equal(existsSync(extraPath), false);
}

function main() {
  const tempRoot = mkdtempSync(path.join(tmpdir(), "browser67-active-skills-"));
  try {
    assertDiffAndCheck(tempRoot);
    const backupDir = assertWriteAndBackup(tempRoot);
    assertBackupListAndRestore(tempRoot, backupDir);
    assertPruneRequiresConfirmation(tempRoot);
    assertPrune(tempRoot);
    process.stdout.write(`${JSON.stringify({
      ok: true,
      check: "active-skill-sync-contract",
      scenarios: ["diff", "check-fails-on-drift", "write-with-backup", "backup-list", "restore-with-current-backup", "prune-confirmation"],
    })}\n`);
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
  }
}

try {
  main();
} catch (error) {
  process.stderr.write(`active-skill-sync-contract failed: ${String(error?.message ?? error)}\n`);
  process.exitCode = 1;
}
