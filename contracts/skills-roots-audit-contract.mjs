#!/usr/bin/env node

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";

const repoRoot = path.resolve(import.meta.dirname, "..");
const auditScript = path.resolve(repoRoot, "scripts/skills-roots-audit.mjs");
const managedSkills = ["browser67", "tmwd-browser-mcp", "js-reverse"];

function copySkill(skill, targetRoot) {
  mkdirSync(targetRoot, { recursive: true });
  cpSync(path.resolve(repoRoot, "skills", skill), path.resolve(targetRoot, skill), { recursive: true });
}

function run(args) {
  const result = spawnSync(process.execPath, [auditScript, ...args], {
    cwd: repoRoot,
    encoding: "utf8",
    timeout: 30_000,
  });
  if (result.status !== 0) {
    throw new Error(`skills roots audit failed status=${result.status}: ${String(result.stderr || result.stdout).trim()}`);
  }
  return JSON.parse(String(result.stdout ?? "").trim());
}

function maybeCreateBrokenSymlink(linkPath) {
  try {
    symlinkSync("missing-browser67-source", linkPath, "dir");
    return true;
  } catch {
    return false;
  }
}

function main() {
  const tempRoot = mkdtempSync(path.join(os.tmpdir(), "browser67-skills-roots-"));
  try {
    const sharedRoot = path.resolve(tempRoot, "agents", "skills");
    const staleRoot = path.resolve(tempRoot, "codex", "skills");
    const piRoot = path.resolve(tempRoot, "pi", "agent", "skills");
    const missingRoot = path.resolve(tempRoot, "missing", "skills");

    for (const skill of managedSkills) copySkill(skill, sharedRoot);

    copySkill("js-reverse", staleRoot);
    writeFileSync(path.resolve(staleRoot, "js-reverse", "SKILL.md"), "\nfixture stale js-reverse\n", { flag: "a" });

    mkdirSync(piRoot, { recursive: true });
    const symlinkSupported = maybeCreateBrokenSymlink(path.resolve(piRoot, "browser67"));

    const report = run([
      "--roots",
      [sharedRoot, staleRoot, piRoot, missingRoot].join(","),
      "--shared-root",
      sharedRoot,
      "--json",
    ]);

    assert.equal(report.ok, true);
    assert.equal(report.check, "skills-roots-audit");
    assert.equal(report.shared_root, sharedRoot);
    assert.deepEqual(report.managed_skills, managedSkills);
    assert.equal(report.roots.length, 4);

    const shared = report.roots.find((root) => root.path === sharedRoot);
    assert.equal(shared.role, "shared_active_root");
    assert.equal(shared.sync_policy, "sync_allowed_when_intentional");
    assert.equal(shared.actionability, "active_root_actionable");
    assert.equal(shared.summary.current_count, 3);
    assert.equal(shared.summary.drift_count, 0);

    const stale = report.roots.find((root) => root.path === staleRoot);
    assert.equal(stale.sync_policy, "audit_only_do_not_blind_sync");
    assert.equal(stale.actionability, "audit_only_not_actionable");
    assert.equal(stale.actionable, false);
    const staleJsReverse = stale.managed_skills.find((skill) => skill.skill === "js-reverse");
    assert.equal(staleJsReverse.status, "drift");
    assert.deepEqual(staleJsReverse.changed, ["SKILL.md"]);
    assert.equal(stale.summary.missing_count, 2);

    const pi = report.roots.find((root) => root.path === piRoot);
    const piBrowser67 = pi.managed_skills.find((skill) => skill.skill === "browser67");
    if (symlinkSupported) {
      assert.equal(piBrowser67.status, "broken_symlink");
      assert.equal(pi.summary.broken_symlink_count, 1);
    }

    const missing = report.roots.find((root) => root.path === missingRoot);
    assert.equal(missing.root_status, "missing");
    assert.equal(missing.summary.missing_count, 3);
    assert.equal(report.summary.actionable_drift_root_count, 0);
    assert.equal(report.summary.audit_only_not_actionable_root_count >= 1, true);

    const duplicateJsReverse = report.duplicate_managed_skills.find((row) => row.skill === "js-reverse");
    assert.equal(duplicateJsReverse.location_count, 2);
    assert.equal(report.recommendations.some((item) => item.includes("Do not blindly sync")), true);
    assert.equal(report.recommendations.some((item) => item.includes("selected active root")), true);
    assert.equal(report.recommendations.some((item) => item.includes("not actionable until")), true);

    process.stdout.write(`${JSON.stringify({
      ok: true,
      check: "skills-roots-audit-contract",
      scenarios: [
        "shared-current",
        "audit-root-stale",
        "missing-root",
        symlinkSupported ? "broken-symlink" : "broken-symlink-skipped",
      ],
    })}\n`);
  } finally {
    if (existsSync(tempRoot)) rmSync(tempRoot, { recursive: true, force: true });
  }
}

try {
  main();
} catch (error) {
  process.stderr.write(`skills-roots-audit-contract failed: ${String(error?.message ?? error)}\n`);
  process.exitCode = 1;
}
