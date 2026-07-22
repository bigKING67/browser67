#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

import { buildChangeSetReport } from "./change-set-lib.mjs";
import { buildOptionalLiveProofAudit } from "./optional-live-proof-audit.mjs";
import { resolveTier } from "./verification/manifest.mjs";

const repoRoot = resolve(import.meta.dirname, "..");

function parseArgs(argv) {
  const parsed = {
    json: false,
    require_clean: false,
    require_synced: false,
    require_current_upstreams: false,
    strict_optional_proofs: false,
    show_optional_proof_detail: false,
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
    if (token === "--require-current-upstreams") {
      parsed.require_current_upstreams = true;
      continue;
    }
    if (token === "--strict-optional-proofs") {
      parsed.strict_optional_proofs = true;
      continue;
    }
    if (token === "--show-optional-proof-detail") {
      parsed.show_optional_proof_detail = true;
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

function gitVersionAnchor(version) {
  const result = runGit([
    "log",
    "-1",
    "--format=%H",
    "-S",
    `\"version\": \"${version}\"`,
    "--",
    "package.json",
  ]);
  if (!result.ok || !result.stdout) {
    return { ok: false, commit: null, commits_after: null, error: result.stderr || "version anchor not found" };
  }
  const count = runGit(["rev-list", "--count", `${result.stdout}..HEAD`]);
  return {
    ok: count.ok,
    commit: result.stdout,
    commits_after: count.ok ? Number(count.stdout) : null,
    error: count.ok ? "" : count.stderr || count.stdout,
  };
}

function changelogSection(text, title) {
  const lines = String(text).split(/\r?\n/);
  const start = lines.findIndex((line) => line.trim() === `## ${title}`);
  if (start < 0) return "";
  const relativeEnd = lines.slice(start + 1).findIndex((line) => /^##\s+/.test(line));
  const end = relativeEnd < 0 ? lines.length : start + 1 + relativeEnd;
  return lines.slice(start + 1, end).join("\n");
}

function hasChangelogBullet(text) {
  return /^\s*-\s+\S/m.test(String(text));
}

function runNodeJson(script, args = []) {
  const result = spawnSync(process.execPath, [script, ...args], {
    cwd: repoRoot,
    encoding: "utf8",
    timeout: 120_000,
  });
  if (result.status !== 0) {
    return {
      ok: false,
      report: null,
      error: String(result.stderr || result.stdout || `${script} failed`).trim(),
    };
  }
  try {
    return { ok: true, report: JSON.parse(String(result.stdout || "").trim()), error: "" };
  } catch (error) {
    return { ok: false, report: null, error: `invalid JSON from ${script}: ${String(error?.message ?? error)}` };
  }
}

function check(id, ok, evidence, next = "") {
  return { id, ok: Boolean(ok), evidence, next };
}

function warning(id, evidence, next = "") {
  return { id, evidence, next };
}

function advisory(id, evidence, next = "", details = {}) {
  return { id, evidence, next, details };
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
  const verifyEntryIds = new Set(resolveTier("verify").map((entry) => entry.id));
  const releaseCommands = resolveTier("release").map((entry) => entry.command.join(" "));
  const strictReleaseCommands = resolveTier("release-strict").map((entry) => entry.command.join(" "));
  const status = gitStatus();
  const aheadBehind = gitAheadBehind();
  const versionAnchor = gitVersionAnchor(pkg.version);
  const changeSet = buildChangeSetReport();
  const optionalProofAudit = await buildOptionalLiveProofAudit({});
  const versionBumpPending = status.changed_paths.some((line) => /package(?:-lock)?\.json$/.test(line));

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
        && releaseCommands.some((command) => command.includes("--require-current-upstreams"))
        && strictReleaseCommands.some((command) => command.includes("--require-current-upstreams")),
      "check:release-readiness plus current-upstream strict release scripts",
    ),
    check(
      "verify_includes_release_readiness",
      verifyEntryIds.has("release-readiness-contract"),
      "verification manifest verify tier includes check:release-readiness",
    ),
    check(
      "changelog_current_version",
      changelog.includes(`## ${pkg.version} - `),
      `CHANGELOG.md heading for ${pkg.version}`,
      "Add a dated CHANGELOG.md entry before declaring a release-ready browser67 version.",
    ),
    check(
      "changelog_unreleased_covers_post_version_changes",
      (versionAnchor.ok
        && (versionAnchor.commits_after === 0 || hasChangelogBullet(changelogSection(changelog, "Unreleased"))))
        || (versionBumpPending && changelog.includes(`## ${pkg.version} - `)),
      versionAnchor.ok
        ? `version_anchor=${versionAnchor.commit.slice(0, 12)} commits_after=${versionAnchor.commits_after} unreleased_has_entries=${hasChangelogBullet(changelogSection(changelog, "Unreleased"))}`
        : `pending_version_bump=${versionBumpPending} ${versionAnchor.error}`,
      "Add a non-empty CHANGELOG.md Unreleased section for material commits made after the current version was introduced.",
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

  if (args.require_current_upstreams) {
    const genericAgent = runNodeJson("scripts/upstream-audit.mjs", ["--json"]);
    const jsReverse = runNodeJson("scripts/js-reverse-upstream-audit.mjs", ["--json", "--require-current"]);
    checks.push(check(
      "genericagent_upstream_review_current",
      genericAgent.ok && genericAgent.report?.upstream_review?.status === "current",
      genericAgent.ok
        ? `status=${genericAgent.report?.upstream_review?.status ?? "unknown"} reviewed=${genericAgent.report?.upstream_review?.reviewed_commit ?? "none"} remote=${genericAgent.report?.remote_main?.commit ?? "none"}`
        : genericAgent.error,
      "Review the latest GenericAgent remote main, then refresh UPSTREAM.review.json before release.",
    ));
    checks.push(check(
      "js_reverse_reference_reviews_current",
      jsReverse.ok && jsReverse.report?.status === "current",
      jsReverse.ok
        ? `status=${jsReverse.report?.status ?? "unknown"} stale=${jsReverse.report?.summary?.stale_count ?? "unknown"} remote_errors=${jsReverse.report?.summary?.remote_error_count ?? "unknown"}`
        : jsReverse.error,
      "Review moved JS reverse references and refresh docs/upstream/js-reverse/references.json plus the absorption matrix before release.",
    ));
  }

  if (args.strict_optional_proofs) {
    checks.push(check(
      "optional_live_proofs_complete",
      optionalProofAudit.complete,
      `satisfied=${optionalProofAudit.summary.satisfied_count}/${optionalProofAudit.summary.required_count} missing=${optionalProofAudit.summary.missing_count}`,
      "Collect the default sanitized Windows native and approved external IdP proofs, then rerun release:ready:strict. Linux desktop proof remains available on demand.",
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
    const optionalProofScope = optionalProofAudit.summary.local_missing_count > 0
      ? "local_and_external_optional"
      : "external_optional";
    advisories.push(advisory(
      "optional_live_proofs_incomplete_non_strict",
      `satisfied=${optionalProofAudit.summary.satisfied_count}/${optionalProofAudit.summary.required_count} missing=${optionalProofAudit.summary.missing_count} scope=${optionalProofScope}`,
      "Default optional live proofs require a Windows GUI host or approved external IdP tenants; Linux desktop proof is on demand and does not affect default release readiness.",
      {
        proof_dir: optionalProofAudit.proof_dir,
        missing: optionalProofAudit.missing,
        local_missing: optionalProofAudit.local_missing,
        plan_command: "npm run plan:optional-live-proofs",
        status_command: "npm run proof:optional-live-status",
      },
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
      require_current_upstreams: args.require_current_upstreams,
      strict_optional_proofs: args.strict_optional_proofs,
    },
    output: {
      show_optional_proof_detail: args.show_optional_proof_detail,
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
      if (report.output.show_optional_proof_detail && item.details && Object.keys(item.details).length > 0) {
        const missing = [...(item.details.local_missing ?? []), ...(item.details.missing ?? [])];
        process.stdout.write(`    detail_missing=${missing.join(",") || "none"}\n`);
        process.stdout.write(`    detail_proof_dir=${item.details.proof_dir ?? "unknown"}\n`);
        process.stdout.write(`    detail_plan=${item.details.plan_command ?? "npm run plan:optional-live-proofs"}\n`);
        process.stdout.write(`    detail_status=${item.details.status_command ?? "npm run proof:optional-live-status"}\n`);
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
