#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

const repoRoot = path.resolve(import.meta.dirname, "..");
const defaultLedgerPath = path.resolve(repoRoot, "docs", "upstream", "js-reverse", "references.json");

function parseArgs(argv) {
  const parsed = {
    ledgerPath: defaultLedgerPath,
    json: false,
    noRemote: false,
    requireCurrent: false,
    timeoutMs: 15_000,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const token = String(argv[index] ?? "");
    if (token === "--ledger") {
      const value = String(argv[index + 1] ?? "").trim();
      if (!value || value.startsWith("--")) {
        throw new Error("missing --ledger value");
      }
      parsed.ledgerPath = path.resolve(value);
      index += 1;
      continue;
    }
    if (token === "--json") {
      parsed.json = true;
      continue;
    }
    if (token === "--no-remote") {
      parsed.noRemote = true;
      continue;
    }
    if (token === "--require-current") {
      parsed.requireCurrent = true;
      continue;
    }
    if (token === "--timeout-ms") {
      const value = Number.parseInt(String(argv[index + 1] ?? ""), 10);
      if (!Number.isFinite(value) || value <= 0) {
        throw new Error("missing or invalid --timeout-ms value");
      }
      parsed.timeoutMs = value;
      index += 1;
      continue;
    }
    if (token === "--help" || token === "-h") {
      parsed.help = true;
      continue;
    }
    throw new Error(`unknown argument: ${token}`);
  }
  return parsed;
}

function usage() {
  return [
    "Usage: node scripts/js-reverse-upstream-audit.mjs [--json] [--require-current]",
    "       node scripts/js-reverse-upstream-audit.mjs --ledger <references.json> [--json]",
    "",
    "Audits browser67 js-reverse external reference commits against their remote HEAD/main.",
    "--no-remote reads and validates the ledger without git ls-remote.",
    "--require-current exits non-zero when any remote has moved or cannot be checked.",
  ].join("\n");
}

function compact(value, maxLength = 260) {
  return String(value ?? "").replace(/\s+/g, " ").trim().slice(0, maxLength);
}

function readLedger(ledgerPath) {
  if (!existsSync(ledgerPath)) {
    throw new Error(`missing ledger: ${ledgerPath}`);
  }
  return JSON.parse(readFileSync(ledgerPath, "utf8"));
}

function gitLsRemote(remote, timeoutMs) {
  const result = spawnSync("git", ["ls-remote", remote, "HEAD", "refs/heads/main"], {
    cwd: repoRoot,
    encoding: "utf8",
    timeout: timeoutMs,
  });
  if (result.status !== 0) {
    throw new Error(compact(result.stderr || result.stdout || "git ls-remote failed"));
  }
  const refs = new Map();
  for (const line of String(result.stdout ?? "").trim().split(/\r?\n/)) {
    if (!line.trim()) continue;
    const [hash, ref] = line.trim().split(/\s+/);
    if (hash && ref) refs.set(ref, hash);
  }
  const latestRef = refs.has("refs/heads/main") ? "refs/heads/main" : "HEAD";
  const latestCommit = refs.get(latestRef);
  if (!latestCommit) {
    throw new Error("git ls-remote did not return HEAD or refs/heads/main");
  }
  return {
    latest_ref: latestRef,
    latest_commit: latestCommit,
  };
}

function auditReference(reference, options) {
  const row = {
    name: reference.name,
    remote: reference.remote,
    role: reference.role,
    reviewed_commit: reference.reviewed_commit,
    direct_import_allowed: reference.direct_import_allowed,
    remote_status: options.noRemote ? "skipped" : "unknown",
    latest_ref: null,
    latest_commit: null,
    stale: null,
    policy_errors: [],
    error: null,
  };

  if (reference.direct_import_allowed !== false) {
    row.policy_errors.push("direct_import_allowed must remain false");
  }
  if (!/^[0-9a-f]{40}$/i.test(String(reference.reviewed_commit ?? ""))) {
    row.policy_errors.push("reviewed_commit must be a 40 character hex commit");
  }
  if (!reference.remote) {
    row.policy_errors.push("remote must be non-empty");
  }

  if (options.noRemote || row.policy_errors.length > 0) {
    return row;
  }

  try {
    const latest = gitLsRemote(reference.remote, options.timeoutMs);
    row.remote_status = "ok";
    row.latest_ref = latest.latest_ref;
    row.latest_commit = latest.latest_commit;
    row.stale = latest.latest_commit.toLowerCase() !== String(reference.reviewed_commit).toLowerCase();
  } catch (error) {
    row.remote_status = "error";
    row.error = compact(error?.message ?? error);
  }
  return row;
}

function buildRecommendedActions(rows, options) {
  const actions = [];
  const policyFailures = rows.filter((row) => row.policy_errors.length > 0);
  const remoteErrors = rows.filter((row) => row.remote_status === "error");
  const stale = rows.filter((row) => row.stale === true);

  if (policyFailures.length > 0) {
    actions.push("Fix docs/upstream/js-reverse/references.json so every external reference remains reference-only with direct_import_allowed=false.");
  }
  if (options.noRemote) {
    actions.push("Run npm run js-reverse:upstream-audit -- --json before deciding whether any external JS reverse reference needs review.");
  } else if (remoteErrors.length > 0) {
    actions.push("Rerun the audit when network/git access is available; do not refresh reviewed_commit from partial data.");
  } else if (stale.length > 0) {
    actions.push("Review changed external references manually, update absorbable/rejected notes, then refresh reviewed_commit only after review.");
  } else {
    actions.push("All js-reverse external reference commits match their reviewed remote HEAD/main.");
  }
  return actions;
}

function buildAudit(options) {
  const ledger = readLedger(options.ledgerPath);
  const references = Array.isArray(ledger.references) ? ledger.references : [];
  const rows = references.map((reference) => auditReference(reference, options));
  const staleCount = rows.filter((row) => row.stale === true).length;
  const remoteErrorCount = rows.filter((row) => row.remote_status === "error").length;
  const policyErrorCount = rows.reduce((count, row) => count + row.policy_errors.length, 0);
  const remoteOkCount = rows.filter((row) => row.remote_status === "ok").length;

  let status = "current";
  if (policyErrorCount > 0) {
    status = "policy_error";
  } else if (options.noRemote) {
    status = "not_checked";
  } else if (remoteErrorCount > 0) {
    status = "remote_error";
  } else if (staleCount > 0) {
    status = "review_needed";
  }

  const requireCurrentFailure = options.requireCurrent && status !== "current";
  return {
    ok: policyErrorCount === 0 && remoteErrorCount === 0 && !requireCurrentFailure,
    check: "js-reverse-upstream-audit",
    ledger_path: options.ledgerPath,
    remote_checked: !options.noRemote,
    require_current: options.requireCurrent,
    status,
    canonical: ledger.canonical?.implementation ?? null,
    summary: {
      reference_count: rows.length,
      remote_ok_count: remoteOkCount,
      remote_error_count: remoteErrorCount,
      stale_count: staleCount,
      policy_error_count: policyErrorCount,
    },
    references: rows,
    recommended_actions: buildRecommendedActions(rows, options),
  };
}

function formatText(audit) {
  const lines = [
    `js_reverse_upstream_audit=${audit.status} references=${audit.summary.reference_count} stale=${audit.summary.stale_count} remote_errors=${audit.summary.remote_error_count} policy_errors=${audit.summary.policy_error_count}`,
  ];
  for (const row of audit.references) {
    const latest = row.latest_commit ? row.latest_commit : row.remote_status;
    lines.push(`  - ${row.name}: reviewed=${row.reviewed_commit} latest=${latest} stale=${String(row.stale)} direct_import_allowed=${String(row.direct_import_allowed)}`);
    if (row.error) {
      lines.push(`    error=${row.error}`);
    }
    for (const policyError of row.policy_errors) {
      lines.push(`    policy_error=${policyError}`);
    }
  }
  lines.push("recommended_actions:");
  for (const action of audit.recommended_actions) {
    lines.push(`  - ${action}`);
  }
  return `${lines.join("\n")}\n`;
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    process.stdout.write(`${usage()}\n`);
    return;
  }
  const audit = buildAudit(options);
  process.stdout.write(options.json ? `${JSON.stringify(audit)}\n` : formatText(audit));
  if (!audit.ok) {
    process.exitCode = 1;
  }
}

try {
  main();
} catch (error) {
  process.stderr.write(`js-reverse-upstream-audit failed: ${String(error?.message ?? error)}\n`);
  process.exitCode = 1;
}
