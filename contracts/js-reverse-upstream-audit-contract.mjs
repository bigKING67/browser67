#!/usr/bin/env node

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const repoRoot = path.resolve(import.meta.dirname, "..");

function run(command, args, cwd, options = {}) {
  const result = spawnSync(command, args, {
    cwd,
    encoding: "utf8",
    timeout: options.timeoutMs ?? 30_000,
  });
  if (result.status !== (options.expectedStatus ?? 0)) {
    throw new Error(`${command} ${args.join(" ")} failed status=${result.status}: ${String(result.stderr || result.stdout).trim()}`);
  }
  return String(result.stdout ?? "").trim();
}

function initReferenceRepo(parentDir, name) {
  const root = path.resolve(parentDir, name);
  mkdirSync(root, { recursive: true });
  run("git", ["init"], root);
  run("git", ["checkout", "-B", "main"], root);
  run("git", ["config", "user.email", "fixture@example.test"], root);
  run("git", ["config", "user.name", "Fixture"], root);
  writeFileSync(path.resolve(root, "README.md"), `# ${name}\n`);
  run("git", ["add", "README.md"], root);
  run("git", ["commit", "-m", "initial"], root);
  return {
    root,
    head: () => run("git", ["rev-parse", "HEAD"], root),
    addCommit: (label) => {
      writeFileSync(path.resolve(root, "README.md"), `${readFileSync(path.resolve(root, "README.md"), "utf8")}\n${label}\n`);
      run("git", ["add", "README.md"], root);
      run("git", ["commit", "-m", label], root);
    },
  };
}

function writeLedger(ledgerPath, repos, overrides = {}) {
  const names = [
    "zhaoxuya520/reverse-skill",
    "NoOne-hub/JSReverser-MCP",
    "zhizhuodemao/js-reverse-mcp",
  ];
  const ledger = {
    schema_version: 1,
    canonical: {
      implementation: "browser67",
      paths: [
        "src/mcp/js-reverse/server.mjs",
        "src/js-reverse-server/",
        "skills/js-reverse/",
        "docs/js-reverse/",
      ],
    },
    legacy_snapshot_policy: {
      description: "fixture",
      direct_import_allowed: false,
      may_override_canonical: false,
    },
    references: names.map((name, index) => ({
      name,
      remote: repos[index].root,
      reviewed_commit: repos[index].head(),
      role: index === 0 ? "reference_only_skill_router_pack" : "external_mcp_reference_candidate",
      direct_import_allowed: false,
    })),
    non_goals: [
      "replace_browser67_backed_js_reverse_skill",
      "import_reverse_skill_action_required_semantics",
      "auto_install_external_tools",
      "auto_write_mcp_config",
      "copy_reverse_skill_pack",
      "promote_jshookmcp_or_anything_analyzer_to_default_entry",
      "allow_legacy_local_snapshot_to_override_canonical",
    ],
  };
  Object.assign(ledger.references[0], overrides.firstReference ?? {});
  writeFileSync(ledgerPath, JSON.stringify(ledger, null, 2));
}

function runAudit(args, expectedStatus = 0) {
  const stdout = run(process.execPath, ["scripts/js-reverse-upstream-audit.mjs", ...args], repoRoot, {
    expectedStatus,
    timeoutMs: 60_000,
  });
  return JSON.parse(stdout);
}

function assertCurrentAudit(ledgerPath) {
  const json = runAudit(["--ledger", ledgerPath, "--json", "--require-current"]);
  assert.equal(json.ok, true);
  assert.equal(json.check, "js-reverse-upstream-audit");
  assert.equal(json.status, "current");
  assert.equal(json.summary.reference_count, 3);
  assert.equal(json.summary.stale_count, 0);
  assert.equal(json.summary.remote_error_count, 0);
  assert.equal(json.summary.policy_error_count, 0);
  assert.equal(json.references.every((row) => row.remote_status === "ok"), true);
  assert.equal(json.references.every((row) => row.stale === false), true);
}

function assertStaleAudit(ledgerPath, repo) {
  repo.addCommit("upstream moved");
  const json = runAudit(["--ledger", ledgerPath, "--json"]);
  assert.equal(json.ok, true);
  assert.equal(json.status, "review_needed");
  assert.equal(json.summary.stale_count, 1);
  assert.equal(json.references[0].stale, true);
  assert.equal(json.references[0].latest_commit, repo.head());
  assert.ok(json.recommended_actions.some((action) => action.includes("Review changed external references")));

  const strict = runAudit(["--ledger", ledgerPath, "--json", "--require-current"], 1);
  assert.equal(strict.ok, false);
  assert.equal(strict.status, "review_needed");
}

function assertNoRemoteAudit(ledgerPath) {
  const json = runAudit(["--ledger", ledgerPath, "--json", "--no-remote"]);
  assert.equal(json.ok, true);
  assert.equal(json.status, "not_checked");
  assert.equal(json.remote_checked, false);
  assert.equal(json.summary.remote_ok_count, 0);
  assert.equal(json.references.every((row) => row.remote_status === "skipped"), true);
}

function assertPolicyFailure(ledgerPath, repos) {
  writeLedger(ledgerPath, repos, {
    firstReference: {
      direct_import_allowed: true,
    },
  });
  const json = runAudit(["--ledger", ledgerPath, "--json", "--no-remote"], 1);
  assert.equal(json.ok, false);
  assert.equal(json.status, "policy_error");
  assert.equal(json.summary.policy_error_count, 1);
  assert.match(json.references[0].policy_errors[0], /direct_import_allowed/);
}

function main() {
  const tempDir = mkdtempSync(path.join(tmpdir(), "js-reverse-upstream-audit-"));
  try {
    const repos = [
      initReferenceRepo(tempDir, "reverse-skill"),
      initReferenceRepo(tempDir, "jsreverser-mcp"),
      initReferenceRepo(tempDir, "js-reverse-mcp"),
    ];
    const ledgerPath = path.resolve(tempDir, "references.json");
    writeLedger(ledgerPath, repos);

    assertCurrentAudit(ledgerPath);
    assertNoRemoteAudit(ledgerPath);
    assertStaleAudit(ledgerPath, repos[0]);
    assertPolicyFailure(ledgerPath, repos);

    process.stdout.write(`${JSON.stringify({
      ok: true,
      check: "js-reverse-upstream-audit-contract",
      scenarios: ["current", "no-remote", "stale", "policy-failure"],
    })}\n`);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
}

try {
  main();
} catch (error) {
  process.stderr.write(`js-reverse-upstream-audit-contract failed: ${String(error?.message ?? error)}\n`);
  process.exitCode = 1;
}
