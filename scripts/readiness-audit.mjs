#!/usr/bin/env node

import { readFile } from "node:fs/promises";

import {
  GROUPS,
  buildChangeSetReport,
} from "./change-set-lib.mjs";
import { buildOptionalLiveProofAudit } from "./optional-live-proof-audit.mjs";
import { buildNativePointerReadinessReport } from "../src/native-capabilities/pointer-readiness.mjs";
import { detectNativeInputCapabilities } from "../src/native-input.mjs";
import { loadJfbymProviderConfig } from "../src/auth/captcha/providers/config.mjs";
import { getLjqCtrlPhysicalInputProviderCapabilities } from "../src/physical-input/providers/ljq-ctrl.mjs";

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

function createGap(id, severity, deduction, evidence, next_step, details = {}) {
  const {
    id: _id,
    severity: _severity,
    deduction: _deduction,
    evidence: _evidence,
    next_step: _nextStep,
    ...safeDetails
  } = details;
  return {
    id,
    severity,
    deduction,
    evidence,
    next_step,
    ...safeDetails,
  };
}

function compactText(value, maxLength = 180) {
  return String(value ?? "unknown").replace(/\s+/g, " ").trim().slice(0, maxLength);
}

function envEnabled(name) {
  const value = String(process.env[name] ?? "").trim().toLowerCase();
  return value === "1" || value === "true" || value === "yes" || value === "on";
}

function nativePointerReady(capabilities = {}) {
  const supportedActions = Array.isArray(capabilities.supported_actions) ? capabilities.supported_actions : [];
  return supportedActions.includes("click") && supportedActions.includes("drag");
}

function summarizeLjqCtrlCandidate(candidate = {}) {
  const marker = candidate.selected === true ? "*" : "";
  const reason = candidate.reason ? ` reason=${compactText(candidate.reason, 80)}` : "";
  return `${marker}${candidate.python ?? "unknown"} exists=${candidate.exists === true} importable=${candidate.importable === true}${reason}`;
}

function buildLjqCtrlEvidence(probe = {}) {
  const candidates = Array.isArray(probe.python_candidates) ? probe.python_candidates : [];
  const candidateText = candidates.slice(0, 4).map(summarizeLjqCtrlCandidate).join("; ") || "none";
  const moreText = candidates.length > 4 ? `; more=${candidates.length - 4}` : "";
  return [
    `platform=${probe.platform ?? process.platform}`,
    `platform_supported=${probe.platform_supported === true}`,
    `source=${probe.python_candidate_source ?? "unknown"}`,
    `selected=${probe.python ?? "none"}`,
    `importable=${probe.ljqctrl_importable === true}`,
    `execution_bridge_enabled=${probe.execution_bridge_enabled === true}`,
    `candidates=${candidateText}${moreText}`,
    probe.macljqctrl ? `macljqctrl_status=${probe.macljqctrl.status ?? "unknown"}` : "",
  ].filter(Boolean).join(" ");
}

async function probeLjqCtrlReadiness() {
  try {
    const capabilities = await getLjqCtrlPhysicalInputProviderCapabilities({
      probe: true,
      refresh: true,
      cache_ttl_ms: 0,
    });
    const checks = capabilities.checks ?? {};
    return {
      status: capabilities.status,
      platform: capabilities.platform ?? process.platform,
      supported_platforms: Array.isArray(capabilities.supported_platforms) ? capabilities.supported_platforms : [],
      platform_supported: capabilities.platform_supported === true,
      python: checks.python,
      python_candidate_source: checks.python_candidate_source,
      python_selection_reason: checks.python_selection_reason,
      python_candidates: Array.isArray(checks.python_candidates) ? checks.python_candidates : [],
      ljqctrl_importable: checks.ljqctrl_importable === true,
      execution_bridge_enabled: checks.execution_bridge_enabled === true,
      supports_window_region_capture: capabilities.supports_window_region_capture === true,
      supports_background_capture: capabilities.supports_background_capture === true,
      supported_actions: Array.isArray(capabilities.supported_actions) ? capabilities.supported_actions : [],
      requirements: Array.isArray(capabilities.requirements) ? capabilities.requirements : [],
      macljqctrl: checks.macljqctrl ?? null,
    };
  } catch (error) {
    return {
      error: compactText(error instanceof Error ? error.message : String(error), 300),
    };
  }
}

function buildMacLjqCtrlGap(probe = {}) {
  const mac = probe.macljqctrl;
  if (!mac || mac.platform !== "darwin") {
    return null;
  }
  const missing = Array.isArray(mac.missing_dependencies) ? mac.missing_dependencies : [];
  const evidence = [
    `status=${mac.status ?? "unknown"}`,
    `python=${mac.python ?? "none"}`,
    `missing=${missing.join(",") || "none"}`,
    `reference=${mac.reference_source ?? "unknown"}`,
    `coordinate_model=${mac.coordinate_model ?? "unknown"}`,
  ].join(" ");
  if (mac.status === "available_for_diagnostic") {
    return createGap(
      "macljqctrl_reference_available",
      "informational",
      0,
      evidence,
      "Keep macljqCtrl as an optional reference/diagnostic path unless a future guarded macOS AX provider is explicitly enabled.",
    );
  }
  return createGap(
    "macljqctrl_reference_not_configured",
    "informational",
    0,
    evidence,
    "Use native-os by default on macOS; install pyobjc/Pillow/opencv/numpy only if intentionally validating the upstream macljqCtrl reference.",
  );
}

function buildLjqCtrlGap(probe = {}) {
  if (probe.error) {
    return createGap(
      "ljqctrl_probe_failed",
      "optional_live",
      0.006,
      `diagnostic probe failed: ${probe.error}`,
      "Run npm run check:ljqctrl for the detailed diagnostic and fix the local probe path before using ljqCtrl assist.",
    );
  }

  const configuredExternally = probe.python_candidate_source !== "default"
    || envEnabled("TMWD_LJQCTRL_EXECUTE");
  const evidence = buildLjqCtrlEvidence(probe);

  if (probe.platform_supported !== true && !configuredExternally && probe.ljqctrl_importable !== true) {
    return createGap(
      "ljqctrl_platform_not_applicable",
      "informational",
      0,
      evidence,
      "Use the native-os physical-input provider on this platform; validate ljqCtrl on a Windows host or set an explicit interpreter if one is intentionally available.",
    );
  }

  if (probe.ljqctrl_importable === true) {
    if (probe.execution_bridge_enabled === true) {
      return createGap(
        "ljqctrl_execution_bridge_available",
        "informational",
        0,
        evidence,
        "Keep ljqCtrl execution gated to trusted local CAPTCHA-assist live gates; run npm run check:ljqctrl after driver or Python changes.",
      );
    }
    return createGap(
      "ljqctrl_probe_available_execution_gated",
      "informational",
      0,
      evidence,
      "Set TMWD_LJQCTRL_EXECUTE=1 only for an approved local physical-input run; keep normal readiness diagnostic-only.",
    );
  }

  if (configuredExternally) {
    return createGap(
      "ljqctrl_config_invalid",
      "optional_live",
      0.006,
      evidence,
      "Fix TMWD_LJQCTRL_PYTHON or TMWD_LJQCTRL_PYTHON_CANDIDATES so the selected interpreter can import ljqCtrl, then run npm run check:ljqctrl.",
    );
  }

  return createGap(
    "ljqctrl_not_configured",
    "optional_live",
    0.006,
    evidence,
    "Set TMWD_LJQCTRL_PYTHON or TMWD_LJQCTRL_PYTHON_CANDIDATES to interpreter(s) that can import ljqCtrl, then run npm run check:ljqctrl.",
  );
}

function recoveryDetails(pointerReadiness = {}) {
  return pointerReadiness.permission_recovery
    ? { permission_recovery: pointerReadiness.permission_recovery }
    : {};
}

function proofPlanDetails(optionalProofAudit = {}, missing = []) {
  return {
    proof_plan: {
      command: "npm run plan:optional-live-proofs -- --json",
      proof_dir: optionalProofAudit.proof_dir,
      missing,
    },
  };
}

function buildNativePointerGap(capabilities = {}, pointerReadiness = {}) {
  if (nativePointerReady(capabilities)) {
    return null;
  }
  const supportedActions = Array.isArray(capabilities.supported_actions) ? capabilities.supported_actions : [];
  const checks = capabilities.checks ?? {};
  const requirements = Array.isArray(capabilities.requirements) ? capabilities.requirements : [];
  const evidence = [
    `platform=${capabilities.platform ?? process.platform}`,
    `driver=${capabilities.driver ?? "unknown"}`,
    `click=${supportedActions.includes("click")}`,
    `drag=${supportedActions.includes("drag")}`,
    `checks=${compactText(JSON.stringify(checks), 220)}`,
    `requirements=${compactText(requirements.join("; "), 260)}`,
  ].join(" ");
  return createGap(
    "native_pointer_actions_unavailable",
    "informational",
    0,
    evidence,
    "Fix the native pointer provider requirements before running physical CAPTCHA assist; on macOS this usually means granting Accessibility permission to the current terminal/Codex host.",
    recoveryDetails(pointerReadiness),
  );
}

function buildCaptchaPhysicalLiveGap(optionalProofAudit, nativeCapabilities, pointerReadiness = {}) {
  const localCaptchaPhysicalProof = optionalProofAudit.local_requirements
    ?.find((requirement) => requirement.id === "captcha-assist-physical-local" && requirement.satisfied === true);
  if (localCaptchaPhysicalProof) {
    const freshness = localCaptchaPhysicalProof.accepted?.expires_at
      ? ` expires_at=${localCaptchaPhysicalProof.accepted.expires_at} expires_in_days=${localCaptchaPhysicalProof.accepted.expires_in_days}`
      : "";
    return createGap(
      "captcha_physical_live_gate_proven",
      "informational",
      0,
      `proof_path=${localCaptchaPhysicalProof.proof_path} proof_dir=${optionalProofAudit.proof_dir}${freshness}`,
      "Keep the repo-external sanitized proof fresh by rerunning the physical gate after CAPTCHA assist or native-input provider changes.",
    );
  }

  if (!nativePointerReady(nativeCapabilities)) {
    return createGap(
      "captcha_physical_live_gate_blocked_by_native_pointer",
      "optional_live",
      0.006,
      `native pointer click/drag unavailable and no accepted local proof exists in ${optionalProofAudit.proof_dir}`,
      "Fix native pointer requirements first, confirm with npm run check:native-pointer, then run TMWD_CAPTCHA_ASSIST_PHYSICAL=1 TMWD_CAPTCHA_ASSIST_CONFIRM=1 npm run check:captcha-assist-physical-live.",
      {
        ...recoveryDetails(pointerReadiness),
        ...proofPlanDetails(optionalProofAudit, ["captcha-assist-physical-local"]),
      },
    );
  }

  if (!envEnabled("TMWD_CAPTCHA_ASSIST_PHYSICAL") || !envEnabled("TMWD_CAPTCHA_ASSIST_CONFIRM")) {
    return createGap(
      "captcha_physical_live_gate_not_executed",
      "optional_live",
      0.006,
      `physical gate env is not fully enabled and no accepted local proof exists in ${optionalProofAudit.proof_dir}`,
      "Only after explicit local permission, run TMWD_CAPTCHA_ASSIST_PHYSICAL=1 TMWD_CAPTCHA_ASSIST_CONFIRM=1 npm run check:captcha-assist-physical-live; a sanitized proof is written repo-externally on success.",
      proofPlanDetails(optionalProofAudit, ["captcha-assist-physical-local"]),
    );
  }

  return createGap(
    "captcha_physical_live_gate_proof_missing",
    "optional_live",
    0.006,
    `physical gate env is enabled and native pointer click/drag appear available, but no accepted local proof exists in ${optionalProofAudit.proof_dir}`,
    "Run npm run check:captcha-assist-physical-live with proof writing enabled, or inspect TMWD_CAPTCHA_ASSIST_WRITE_PROOF / TMWD_OPTIONAL_PROOF_DIR if the physical gate already passed.",
    proofPlanDetails(optionalProofAudit, ["captcha-assist-physical-local"]),
  );
}

function buildJfbymProviderGap(config = {}) {
  const evidence = [
    `config_file_present=${config.config_file_present === true}`,
    `enabled=${config.enabled === true}`,
    `token_configured=${config.token_configured === true}`,
    `coordinate_solver_enabled=${config.coordinate_solver_enabled === true}`,
    `protocol_solver_enabled=${config.protocol_solver_enabled === true}`,
    `min_confidence=${config.min_confidence}`,
    `slider_result_mode=${config.slider_result_mode}`,
    `allowed_origins=${Array.isArray(config.allowed_origins) ? config.allowed_origins.length : 0}`,
    `allowed_kinds=${Array.isArray(config.allowed_kinds) ? config.allowed_kinds.join(",") : ""}`,
    `config_path=${config.config_path ?? "unknown"}`,
  ].join(" ");

  if (config.enabled === true && config.token_configured !== true) {
    return createGap(
      "jfbym_config_invalid",
      "optional_live",
      0.004,
      evidence,
      "Add TMWD_CAPTCHA_PROVIDER_JFBYM_TOKEN to the repo-external jfbym.env file or disable TMWD_CAPTCHA_PROVIDER_JFBYM_ENABLED.",
    );
  }

  if (config.configured === true) {
    return createGap(
      config.protocol_solver_enabled === true
        ? "jfbym_provider_configured_with_protocol"
        : "jfbym_provider_configured_coordinate_only",
      "informational",
      0,
      evidence,
      "Keep JFBYM/Yunma config repo-external; use npm run setup:captcha-provider:jfbym for writes and run provider checks after config changes. Protocol routes remain allowlist + confirmation gated.",
    );
  }

  return createGap(
    "jfbym_provider_not_configured",
    "informational",
    0,
    evidence,
    "Optional: run npm run setup:captcha-provider:jfbym -- --allowed-origin <origin> --write with TMWD_CAPTCHA_PROVIDER_JFBYM_TOKEN set to enable provider coordinate planning for approved origins.",
  );
}

function buildRequiredChecks({ packageJson, readme, skill, verifySource, report }) {
  const scriptNames = [
    "check:syntax",
    "check:project-structure",
    "check:performance-smoke",
    "check:regression-matrix",
    "check:task-templates",
    "check:change-set",
    "plan:scoped-commits",
    "check:mcp",
    "check:auth-live",
    "check:captcha-assist-live",
    "check:captcha-assist-physical-live",
    "check:captcha-router",
    "check:captcha-provider-jfbym",
    "check:captcha-provider-jfbym-setup",
    "check:captcha-provider-jfbym-coordinate",
    "check:native-pointer",
    "check:ljqctrl",
    "check:optional-live-proofs",
    "check:release-readiness",
    "check:readiness",
    "release:ready",
    "release:ready:strict",
    "upstream:audit",
    "upstream:audit:latest",
    "check:upstream-audit",
    "check:upstream-review",
    "js-reverse:upstream-audit",
    "check:js-reverse-upstream-audit",
    "skills:active:diff",
    "skills:active:check",
    "skills:active:sync",
    "skills:active:backups",
    "skills:active:restore",
    "check:active-skill-sync",
    "plan:optional-live-proofs",
    "proof:optional-live-status",
    "proof:optional-live-template",
    "proof:optional-live-record",
    "verify:local",
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
        "check:performance-smoke",
        "check:project-structure",
        "check:regression-matrix",
        "check:task-templates",
        "check:change-set",
        "check:readiness",
        "check:captcha-assist-live",
        "check:captcha-router",
        "check:captcha-provider-jfbym",
        "check:captcha-provider-jfbym-setup",
        "check:captcha-provider-jfbym-coordinate",
        "check:native-pointer",
        "check:ljqctrl",
        "check:optional-live-proofs",
        "check:release-readiness",
        "upstream:audit",
        "upstream:audit:latest",
        "check:upstream-audit",
        "check:upstream-review",
        "js-reverse:upstream-audit",
        "check:js-reverse-upstream-audit",
        "skills:active:diff",
        "check:active-skill-sync",
        "plan:optional-live-proofs",
        "proof:optional-live-status",
      ]),
      "verify.mjs includes project-structure, change-set, readiness, latest upstream audit, upstream review schema, captcha assist, ljqctrl, optional live proof audit, planning, and status gates",
    ),
    createCheck(
      "local_verify_includes_active_skill_check",
      String(packageJson.scripts?.["verify:local"] ?? "").includes("skills:active:check"),
      "verify:local runs the strict active skill drift gate outside default verify",
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
        "npm run check:project-structure",
        "npm run check:change-set",
        "npm run plan:scoped-commits",
        "npm run check:captcha-assist-live",
        "npm run check:captcha-router",
        "npm run check:captcha-provider-jfbym",
        "npm run check:captcha-provider-jfbym-setup",
        "npm run check:captcha-provider-jfbym-coordinate",
        "npm run check:native-pointer",
        "npm run check:ljqctrl",
        "npm run check:release-readiness",
        "npm run release:ready",
        "npm run upstream:audit",
        "npm run upstream:audit:latest",
        "npm run check:upstream-audit",
        "npm run check:upstream-review",
        "npm run js-reverse:upstream-audit",
        "npm run check:js-reverse-upstream-audit",
        "npm run skills:active:diff",
        "npm run skills:active:check",
        "npm run skills:active:backups",
        "npm run skills:active:restore",
        "npm run check:active-skill-sync",
        "npm run plan:optional-live-proofs",
        "npm run proof:optional-live-status",
        "npm run proof:optional-live-record",
      ]),
      "README lists readiness, project-structure, change-set, scoped commit, captcha, native pointer, ljqctrl, upstream review schema, and optional proof planning/status/recording gates",
    ),
    createCheck(
      "skill_documents_captcha_boundaries",
      textIncludesAll(skill, [
        "plan_captcha_assist",
        "assist_captcha",
        "check:native-pointer",
        "check:captcha-assist-physical-live",
        "check:captcha-router",
        "check:captcha-provider-jfbym",
        "check:captcha-provider-jfbym-setup",
        "check:captcha-provider-jfbym-coordinate",
        "check:ljqctrl",
        "Do not keep trying selectors",
      ]),
      "browser67 skill preserves CAPTCHA planning, physical gate, ljqctrl, and handoff boundaries",
    ),
  ];
}

async function buildOptionalGaps({ report }) {
  const gaps = [];
  const [optionalProofAudit, ljqCtrlProbe, nativeCapabilities, jfbymConfig] = await Promise.all([
    buildOptionalLiveProofAudit({}),
    probeLjqCtrlReadiness(),
    detectNativeInputCapabilities({ refresh: true, cache_ttl_ms: 0 }),
    loadJfbymProviderConfig({}),
  ]);
  const nativePointerReadiness = buildNativePointerReadinessReport(nativeCapabilities, {
    verify_command: "npm run check:native-pointer",
    physical_gate_command: "TMWD_CAPTCHA_ASSIST_PHYSICAL=1 TMWD_CAPTCHA_ASSIST_CONFIRM=1 npm run check:captcha-assist-physical-live",
  });

  if (report.changed_paths_count > 0) {
    gaps.push(createGap(
      "scoped_commits_pending",
      "review",
      0.012,
      `changed_paths=${report.changed_paths_count}`,
      "Run npm run plan:scoped-commits, then commit each group with scoped git add commands after confirmation.",
    ));
  }

  gaps.push(buildJfbymProviderGap(jfbymConfig));
  gaps.push(buildLjqCtrlGap(ljqCtrlProbe));
  const macLjqCtrlGap = buildMacLjqCtrlGap(ljqCtrlProbe);
  if (macLjqCtrlGap) {
    gaps.push(macLjqCtrlGap);
  }
  const nativePointerGap = buildNativePointerGap(nativeCapabilities, nativePointerReadiness);
  if (nativePointerGap) {
    gaps.push(nativePointerGap);
  }

  gaps.push(buildCaptchaPhysicalLiveGap(optionalProofAudit, nativeCapabilities, nativePointerReadiness));

  const missingNativeProofs = optionalProofAudit.missing.filter((id) => id.startsWith("native-live-"));
  if (missingNativeProofs.length > 0) {
    gaps.push(createGap(
      "cross_os_native_live_not_proven",
      "portability",
      0.004,
      `current_platform=${process.platform} missing_proofs=${missingNativeProofs.join(",")} proof_dir=${optionalProofAudit.proof_dir}`,
      "Run native provider live gates on Linux and Windows hosts, save sanitized proof JSON, then run npm run check:optional-live-proofs.",
      proofPlanDetails(optionalProofAudit, missingNativeProofs),
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
      proofPlanDetails(optionalProofAudit, missingIdpProofs),
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
