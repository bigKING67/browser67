#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

import { buildChangeSetReport } from "./change-set-lib.mjs";
import { buildOptionalLiveProofAudit } from "./optional-live-proof-audit.mjs";

const repoRoot = resolve(import.meta.dirname, "..");

function parseArgs(argv) {
  const parsed = {
    json: false,
    require_clean: false,
    require_synced: false,
    strict_optional_proofs: false,
  };
  for (const token of argv) {
    if (token === "--json") {
      parsed.json = true;
      continue;
    }
    if (token === "--require-clean") {
      parsed.require_clean = true;
      continue;
    }
    if (token === "--require-synced") {
      parsed.require_synced = true;
      continue;
    }
    if (token === "--strict-optional-proofs") {
      parsed.strict_optional_proofs = true;
      continue;
    }
    if (!token) {
      continue;
    }
    throw new Error(`unknown argument: ${token}`);
  }
  return parsed;
}

function readText(relativePath) {
  return readFileSync(resolve(repoRoot, relativePath), "utf8");
}

function readJson(relativePath) {
  return JSON.parse(readText(relativePath));
}

function runGit(args) {
  const result = spawnSync("git", args, {
    cwd: repoRoot,
    encoding: "utf8",
  });
  return {
    ok: result.status === 0,
    stdout: String(result.stdout || "").trim(),
    stderr: String(result.stderr || "").trim(),
  };
}

function gitStatus() {
  const result = runGit(["status", "--porcelain=v1"]);
  if (!result.ok) {
    return { ok: false, changed_paths: [], error: result.stderr || result.stdout };
  }
  const changed_paths = result.stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  return { ok: true, changed_paths };
}

function gitAheadBehind() {
  const result = runGit(["rev-list", "--left-right", "--count", "origin/main...HEAD"]);
  if (!result.ok) {
    return { ok: false, ahead: null, behind: null, error: result.stderr || result.stdout };
  }
  const [behindRaw, aheadRaw] = result.stdout.split(/\s+/);
  return {
    ok: true,
    behind: Number(behindRaw),
    ahead: Number(aheadRaw),
  };
}

function check(id, ok, evidence, next = "") {
  return { id, ok: Boolean(ok), evidence, next };
}

function warning(id, evidence, next = "") {
  return { id, evidence, next };
}

function advisory(id, evidence, next = "") {
  return { id, evidence, next };
}

function semverLike(version) {
  return /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/.test(String(version || ""));
}

function textIncludesAll(text, needles) {
  return needles.every((needle) => text.includes(needle));
}

async function buildReadiness(args) {
  const pkg = readJson("package.json");
  const lock = readJson("package-lock.json");
  const readme = readText("README.md");
  const changelog = existsSync(resolve(repoRoot, "CHANGELOG.md")) ? readText("CHANGELOG.md") : "";
  const releaseDoc = existsSync(resolve(repoRoot, "docs/release-governance.md"))
    ? readText("docs/release-governance.md")
    : "";
  const verifySource = readText("scripts/verify.mjs");
  const status = gitStatus();
  const aheadBehind = gitAheadBehind();
  const changeSet = buildChangeSetReport();
  const optionalProofAudit = await buildOptionalLiveProofAudit({});

  const checks = [
    check("package_name", pkg.name === "browser67", `name=${pkg.name}`),
    check("package_version_semver", semverLike(pkg.version), `version=${pkg.version}`),
    check(
      "package_lock_version_matches",
      lock.version === pkg.version && lock.packages?.[""]?.version === pkg.version,
      `package=${pkg.version} lock=${lock.version} root=${lock.packages?.[""]?.version}`,
      "Update package-lock.json root versions whenever package.json version changes.",
    ),
    check(
      "release_scripts_registered",
      pkg.scripts?.["check:release-readiness"] === "node scripts/release-readiness.mjs"
        && typeof pkg.scripts?.["release:ready"] === "string"
        && typeof pkg.scripts?.["release:ready:strict"] === "string",
      "check:release-readiness, release:ready, release:ready:strict",
    ),
    check(
      "verify_includes_release_readiness",
      verifySource.includes("check:release-readiness"),
      "scripts/verify.mjs includes check:release-readiness",
    ),
    check(
      "changelog_current_version",
      changelog.includes(`## ${pkg.version} - `),
      `CHANGELOG.md heading for ${pkg.version}`,
      "Add a dated CHANGELOG.md entry before declaring a release-ready browser67 version.",
    ),
    check(
      "release_governance_doc",
      textIncludesAll(releaseDoc, [
        "npm run check:release-readiness",
        "npm run release:ready",
        "Pi package pin",
        "optional live proofs",
        "Do not publish or tag",
      ]),
      "docs/release-governance.md documents release gates, Pi pin, optional proof boundaries, and publish/tag confirmation.",
    ),
    check(
      "readme_documents_release_gate",
      textIncludesAll(readme, [
        "npm run check:release-readiness",
        "npm run release:ready",
        "docs/release-governance.md",
      ]),
      "README documents release-readiness gate and release governance doc.",
    ),
    check(
      "canonical_bins_exist",
      existsSync(resolve(repoRoot, pkg.bin?.browser67 || ""))
        && existsSync(resolve(repoRoot, pkg.bin?.["tmwd-browser-mcp"] || ""))
        && existsSync(resolve(repoRoot, pkg.bin?.["tmwd-browser"] || "")),
      "browser67, tmwd-browser-mcp, tmwd-browser bin entries exist.",
    ),
    check(
      "change_set_grouped",
      changeSet.ok,
      `changed=${changeSet.changed_paths_count} grouped=${changeSet.grouped_paths_count} ungrouped=${changeSet.ungrouped_paths_count}`,
      "Add intentional new files to scripts/change-set-lib.mjs groups before release.",
    ),
  ];

  if (args.require_clean) {
    checks.push(check(
      "git_clean",
      status.ok && status.changed_paths.length === 0,
      status.ok ? `changed_paths=${status.changed_paths.length}` : status.error,
      "Commit or revert intentional changes before running the strict release gate.",
    ));
  }

  if (args.require_synced) {
    checks.push(check(
      "git_synced_with_origin_main",
      aheadBehind.ok && aheadBehind.ahead === 0 && aheadBehind.behind === 0,
      aheadBehind.ok ? `behind=${aheadBehind.behind} ahead=${aheadBehind.ahead}` : aheadBehind.error,
      "Push or pull origin/main before declaring the checkout release-ready.",
    ));
  }

  if (args.strict_optional_proofs) {
    checks.push(check(
      "optional_live_proofs_complete",
      optionalProofAudit.complete,
      `satisfied=${optionalProofAudit.summary.satisfied_count}/${optionalProofAudit.summary.required_count} missing=${optionalProofAudit.summary.missing_count}`,
      "Collect sanitized Linux/Windows native and approved external IdP proofs, then rerun release:ready:strict.",
    ));
  }

  const warnings = [];
  if (!args.require_clean && status.ok && status.changed_paths.length > 0) {
    warnings.push(warning(
      "git_dirty_non_strict",
      `changed_paths=${status.changed_paths.length}`,
      "Use npm run release:ready for the strict clean-worktree release gate.",
    ));
  }
  if (!args.require_synced && aheadBehind.ok && (aheadBehind.ahead !== 0 || aheadBehind.behind !== 0)) {
    warnings.push(warning(
      "git_not_synced_non_strict",
      `behind=${aheadBehind.behind} ahead=${aheadBehind.ahead}`,
      "Use npm run release:ready after syncing origin/main.",
    ));
  }

  const advisories = [];
  if (!args.strict_optional_proofs && !optionalProofAudit.complete) {
    advisories.push(advisory(
      "optional_live_proofs_incomplete_non_strict",
      `satisfied=${optionalProofAudit.summary.satisfied_count}/${optionalProofAudit.summary.required_count} missing=${optionalProofAudit.summary.missing_count}`,
      "Optional live proofs require cross-OS hosts or approved external IdP tenants; use npm run release:ready:strict only when they are release acceptance criteria.",
    ));
  }

  const failed = checks.filter((item) => !item.ok);
  const release_ready = failed.length === 0;
  return {
    ok: release_ready,
    status: release_ready
      ? (warnings.length > 0 ? "ready_with_warnings" : "ready")
      : "not_ready",
    check: "browser67-release-readiness",
    version: pkg.version,
    strict: {
      require_clean: args.require_clean,
      require_synced: args.require_synced,
      strict_optional_proofs: args.strict_optional_proofs,
    },
    checks,
    warnings,
    advisories,
    summary: {
      failed_count: failed.length,
      warning_count: warnings.length,
      advisory_count: advisories.length,
      changed_paths_count: status.ok ? status.changed_paths.length : null,
      ahead: aheadBehind.ok ? aheadBehind.ahead : null,
      behind: aheadBehind.ok ? aheadBehind.behind : null,
      optional_proofs_satisfied: optionalProofAudit.summary.satisfied_count,
      optional_proofs_required: optionalProofAudit.summary.required_count,
    },
  };
}

function outputText(report) {
  process.stdout.write(
    `release_readiness=${report.status} version=${report.version} failed=${report.summary.failed_count} warnings=${report.summary.warning_count} advisories=${report.summary.advisory_count}\n`,
  );
  for (const item of report.checks) {
    process.stdout.write(`  - ${item.id}: ${item.ok ? "ok" : "fail"} (${item.evidence})\n`);
    if (!item.ok && item.next) {
      process.stdout.write(`    next=${item.next}\n`);
    }
  }
  if (report.warnings.length > 0) {
    process.stdout.write("\nwarnings:\n");
    for (const item of report.warnings) {
      process.stdout.write(`  - ${item.id}: ${item.evidence}\n`);
      if (item.next) {
        process.stdout.write(`    next=${item.next}\n`);
      }
    }
  }
  if (report.advisories.length > 0) {
    process.stdout.write("\nadvisories:\n");
    for (const item of report.advisories) {
      process.stdout.write(`  - ${item.id}: ${item.evidence}\n`);
      if (item.next) {
        process.stdout.write(`    next=${item.next}\n`);
      }
    }
  }
}

async function run() {
  const args = parseArgs(process.argv.slice(2));
  const report = await buildReadiness(args);
  if (args.json) {
    process.stdout.write(`${JSON.stringify(report)}\n`);
  } else {
    outputText(report);
  }
  process.exitCode = report.ok ? 0 : 1;
}

try {
  await run();
} catch (error) {
  process.stderr.write(`release-readiness failed: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
}
