#!/usr/bin/env node

import { readFile } from "node:fs/promises";

import {
  GROUPS,
  buildChangeSetReport,
} from "./change-set-lib.mjs";
import { buildOptionalLiveProofAudit } from "./optional-live-proof-audit.mjs";

const DEFAULT_FAIL_BELOW = 99.0;

function parseArgs(argv) {
  const parsed = {
    json: false,
    strict: false,
    fail_below: DEFAULT_FAIL_BELOW,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index] ?? "";
    if (token === "--json") {
      parsed.json = true;
      continue;
    }
    if (token === "--strict") {
      parsed.strict = true;
      continue;
    }
    if (token === "--fail-below") {
      const value = Number(argv[index + 1] ?? "");
      if (!Number.isFinite(value) || value < 0 || value > 100) {
        throw new Error("invalid --fail-below value");
      }
      parsed.fail_below = value;
      index += 1;
      continue;
    }
    if (!token) {
      continue;
    }
    throw new Error(`unknown argument: ${token}`);
  }
  return parsed;
}

async function readText(path) {
  return readFile(path, "utf8");
}

async function readPackageJson() {
  return JSON.parse(await readText("package.json"));
}

function hasScript(packageJson, name) {
  return typeof packageJson.scripts?.[name] === "string" && packageJson.scripts[name].length > 0;
}

function textIncludesAll(text, needles) {
  return needles.every((needle) => text.includes(needle));
}

function createCheck(id, ok, evidence, required = true) {
  return {
    id,
    ok,
    required,
    evidence,
  };
}

function createGap(id, severity, deduction, evidence, next_step) {
  return {
    id,
    severity,
    deduction,
    evidence,
    next_step,
  };
}

function buildRequiredChecks({ packageJson, readme, skill, verifySource, report }) {
  const scriptNames = [
    "check:syntax",
    "check:change-set",
    "plan:scoped-commits",
    "check:mcp",
    "check:auth-live",
    "check:captcha-assist-live",
    "check:captcha-assist-physical-live",
    "check:ljqctrl",
    "check:optional-live-proofs",
    "check:readiness",
    "verify",
  ];

  const packageScriptsOk = scriptNames.every((name) => hasScript(packageJson, name));
  const groupedIds = new Set(report.groups.map((group) => group.id));
  const groupedPlanOk = GROUPS.every((group) => groupedIds.has(group.id) || report.changed_paths_count === 0);
  const groupMetadataOk = GROUPS.every((group) => (
    group.id
    && group.title
    && group.description
    && group.commit_message
    && group.verification.length > 0
    && group.patterns.length > 0
  ));

  return [
    createCheck(
      "package_scripts_registered",
      packageScriptsOk,
      `checked=${scriptNames.length}`,
    ),
    createCheck(
      "verify_includes_governance_gates",
      textIncludesAll(verifySource, [
        "check:change-set",
        "check:readiness",
        "check:captcha-assist-live",
        "check:ljqctrl",
        "check:optional-live-proofs",
      ]),
      "verify.mjs includes change-set, readiness, captcha assist, ljqctrl, and optional live proof gates",
    ),
    createCheck(
      "change_set_grouped",
      report.ok,
      `changed=${report.changed_paths_count} grouped=${report.grouped_paths_count} ungrouped=${report.ungrouped_paths_count}`,
    ),
    createCheck(
      "scoped_commit_groups_defined",
      groupedPlanOk && groupMetadataOk,
      `groups=${GROUPS.length} active_groups=${report.groups.length}`,
    ),
    createCheck(
      "readme_documents_gates",
      textIncludesAll(readme, [
        "npm run check:readiness",
        "npm run check:change-set",
        "npm run plan:scoped-commits",
        "npm run check:captcha-assist-live",
        "npm run check:ljqctrl",
      ]),
      "README lists readiness, change-set, scoped commit, captcha, and ljqctrl gates",
    ),
    createCheck(
      "skill_documents_captcha_boundaries",
      textIncludesAll(skill, [
        "plan_captcha_assist",
        "assist_captcha",
        "check:captcha-assist-physical-live",
        "check:ljqctrl",
        "Do not keep trying selectors",
      ]),
      "TMWD skill preserves CAPTCHA planning, physical gate, ljqctrl, and handoff boundaries",
    ),
  ];
}

async function buildOptionalGaps({ report }) {
  const gaps = [];
  const optionalProofAudit = await buildOptionalLiveProofAudit({});

  if (report.changed_paths_count > 0) {
    gaps.push(createGap(
      "scoped_commits_pending",
      "review",
      0.012,
      `changed_paths=${report.changed_paths_count}`,
      "Run npm run plan:scoped-commits, then commit each group with scoped git add commands after confirmation.",
    ));
  }

  if (process.env.TMWD_LJQCTRL_PYTHON !== undefined || process.env.TMWD_LJQCTRL_EXECUTE === "1") {
    gaps.push(createGap(
      "ljqctrl_config_external",
      "informational",
      0,
      "ljqCtrl environment is externally supplied; use npm run check:ljqctrl for live proof.",
      "Keep ljqCtrl execution gated by TMWD_LJQCTRL_EXECUTE=1.",
    ));
  } else {
    gaps.push(createGap(
      "ljqctrl_not_configured",
      "optional_live",
      0.006,
      "TMWD_LJQCTRL_PYTHON unset and TMWD_LJQCTRL_EXECUTE not enabled",
      "Set TMWD_LJQCTRL_PYTHON to a Python that can import ljqCtrl, then run npm run check:ljqctrl.",
    ));
  }

  if (process.env.TMWD_CAPTCHA_ASSIST_PHYSICAL !== "1" || process.env.TMWD_CAPTCHA_ASSIST_CONFIRM !== "1") {
    gaps.push(createGap(
      "captcha_physical_live_gate_not_executed",
      "optional_live",
      0.006,
      "physical gate env is not fully enabled",
      "Only after explicit local permission, run TMWD_CAPTCHA_ASSIST_PHYSICAL=1 TMWD_CAPTCHA_ASSIST_CONFIRM=1 npm run check:captcha-assist-physical-live.",
    ));
  }

  const missingNativeProofs = optionalProofAudit.missing.filter((id) => id.startsWith("native-live-"));
  if (missingNativeProofs.length > 0) {
    gaps.push(createGap(
      "cross_os_native_live_not_proven",
      "portability",
      0.004,
      `current_platform=${process.platform} missing_proofs=${missingNativeProofs.join(",")} proof_dir=${optionalProofAudit.proof_dir}`,
      "Run native provider live gates on Linux and Windows hosts, save sanitized proof JSON, then run npm run check:optional-live-proofs.",
    ));
  }

  const missingIdpProofs = optionalProofAudit.missing.filter((id) => id.startsWith("idp-"));
  if (missingIdpProofs.length > 0) {
    gaps.push(createGap(
      "complex_idp_optional_live_not_proven",
      "optional_live",
      0.001,
      `Local OAuth/SSO/MFA manual handoff/resume fixtures are covered; external provider-specific proofs missing=${missingIdpProofs.join(",")} proof_dir=${optionalProofAudit.proof_dir}.`,
      "Run optional live gates against approved representative OAuth popup, cross-domain SSO, and MFA providers, save sanitized proof JSON, then run npm run check:optional-live-proofs.",
    ));
  }

  return gaps;
}

function computeScore(requiredChecks, optionalGaps) {
  const failedRequired = requiredChecks.filter((check) => check.required && !check.ok);
  const requiredDeduction = failedRequired.length * 1.0;
  const optionalDeduction = optionalGaps.reduce((total, gap) => total + gap.deduction, 0);
  const score = Math.max(0, 100 - requiredDeduction - optionalDeduction);
  return Math.round(score * 1000) / 1000;
}

function statusFor(score, requiredOk, optionalGaps, strict) {
  if (!requiredOk) return "not_ready";
  if (strict && optionalGaps.some((gap) => gap.deduction > 0)) return "strict_optional_gaps";
  if (optionalGaps.some((gap) => gap.deduction > 0)) return "ready_with_optional_gaps";
  return score >= 100 ? "ready_100" : "ready";
}

async function buildAudit(args) {
  const [
    packageJson,
    readme,
    skill,
    verifySource,
  ] = await Promise.all([
    readPackageJson(),
    readText("README.md"),
    readText("skills/tmwd-browser-mcp/SKILL.md"),
    readText("scripts/verify.mjs"),
  ]);
  const report = buildChangeSetReport(undefined, {
    include_empty_groups: true,
  });

  const required_checks = buildRequiredChecks({
    packageJson,
    readme,
    skill,
    verifySource,
    report,
  });
  const optional_gaps = await buildOptionalGaps({ report });
  const required_ok = required_checks.every((check) => !check.required || check.ok);
  const score = computeScore(required_checks, optional_gaps);

  return {
    ok: required_ok && score >= args.fail_below && (!args.strict || optional_gaps.every((gap) => gap.deduction === 0)),
    status: statusFor(score, required_ok, optional_gaps, args.strict),
    check: "tmwd-readiness-audit",
    score,
    fail_below: args.fail_below,
    strict: args.strict,
    required_ok,
    required_checks,
    optional_gaps,
    summary: {
      changed_paths_count: report.changed_paths_count,
      grouped_paths_count: report.grouped_paths_count,
      ungrouped_paths_count: report.ungrouped_paths_count,
      scoped_commit_groups: GROUPS.length,
      optional_gap_count: optional_gaps.filter((gap) => gap.deduction > 0).length,
    },
  };
}

function outputText(audit) {
  process.stdout.write(
    `readiness_audit=${audit.status} score=${audit.score.toFixed(3)} required_ok=${audit.required_ok} optional_gaps=${audit.summary.optional_gap_count}\n`,
  );
  process.stdout.write(
    `change_set changed=${audit.summary.changed_paths_count} grouped=${audit.summary.grouped_paths_count} ungrouped=${audit.summary.ungrouped_paths_count} groups=${audit.summary.scoped_commit_groups}\n`,
  );
  const requiredLines = audit.required_checks
    .map((check) => `  - ${check.id}: ${check.ok ? "ok" : "fail"} (${check.evidence})`)
    .join("\n");
  const gapLines = audit.optional_gaps
    .map((gap) => [
      `  - ${gap.id}: severity=${gap.severity} deduction=${gap.deduction.toFixed(3)} evidence=${gap.evidence}`,
      `    next=${gap.next_step}`,
    ].join("\n"))
    .join("\n");
  process.stdout.write(`\nrequired_checks:\n${requiredLines}\n`);
  process.stdout.write(`\noptional_gaps:\n${gapLines}\n`);
}

async function run() {
  const args = parseArgs(process.argv.slice(2));
  const audit = await buildAudit(args);
  if (args.json) {
    process.stdout.write(`${JSON.stringify(audit)}\n`);
  } else {
    outputText(audit);
  }
  process.exitCode = audit.ok ? 0 : 1;
}

try {
  await run();
} catch (error) {
  process.stderr.write(`readiness-audit failed: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
}
