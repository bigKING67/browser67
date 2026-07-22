#!/usr/bin/env node

import { basename, resolve } from "node:path";
import { pathToFileURL } from "node:url";

import {
  ALL_OPTIONAL_LIVE_PROOF_REQUIREMENTS,
  buildOptionalLiveProofAudit,
  DEFAULT_OPTIONAL_LIVE_PROOF_REQUIREMENTS,
  DEFAULT_OPTIONAL_LIVE_PROOF_DIR,
} from "./optional-live-proof-audit.mjs";
import { detectNativeInputCapabilities } from "../src/native-input.mjs";
import { buildNativePointerReadinessReport } from "../src/native-capabilities/pointer-readiness.mjs";
import { nativeLiveCommand } from "./native-live-proof-gate.mjs";

const PHYSICAL_GATE_COMMAND = "TMWD_CAPTCHA_ASSIST_PHYSICAL=1 TMWD_CAPTCHA_ASSIST_CONFIRM=1 npm run check:captcha-assist-physical-live";
const NATIVE_POINTER_COMMAND = "npm run check:native-pointer";

function parseArgs(argv) {
  const parsed = {
    id: "",
    json: false,
    proof_dir: process.env.TMWD_OPTIONAL_PROOF_DIR || DEFAULT_OPTIONAL_LIVE_PROOF_DIR,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index] ?? "";
    if (token === "--json") {
      parsed.json = true;
      continue;
    }
    if (token === "--id") {
      const value = String(argv[index + 1] ?? "").trim();
      if (!value || value.startsWith("--")) {
        throw new Error("--id requires a proof id");
      }
      parsed.id = value;
      index += 1;
      continue;
    }
    if (token === "--proof-dir") {
      const value = String(argv[index + 1] ?? "").trim();
      if (!value || value.startsWith("--")) {
        throw new Error("--proof-dir requires a directory");
      }
      parsed.proof_dir = value;
      index += 1;
      continue;
    }
    if (!token) {
      continue;
    }
    throw new Error(`unknown argument: ${token}`);
  }
  if (!parsed.proof_dir) {
    throw new Error("proof directory is required");
  }
  parsed.proof_dir = resolve(parsed.proof_dir);
  return parsed;
}

function selectedRequirements(id) {
  if (!id) {
    return DEFAULT_OPTIONAL_LIVE_PROOF_REQUIREMENTS;
  }
  const selected = ALL_OPTIONAL_LIVE_PROOF_REQUIREMENTS.filter((requirement) => requirement.id === id);
  if (selected.length === 0) {
    throw new Error(`unknown optional live proof id: ${id}`);
  }
  return selected;
}

function summarizeItems(items, auditSummary = {}) {
  const missing = items.filter((item) => item.satisfied !== true);
  const rejectedCandidateCount = items.reduce((count, item) => (
    count + (Array.isArray(item.candidates)
      ? item.candidates.filter((candidate) => candidate.validation?.ok === false).length
      : 0)
  ), 0);
  return {
    required_count: items.length,
    satisfied_count: items.length - missing.length,
    missing_count: missing.length,
    local_missing_count: missing.filter((item) => item.type === "captcha_physical_live").length,
    external_missing_count: missing.filter((item) => item.type !== "captcha_physical_live").length,
    invalid_file_count: Number(auditSummary.invalid_file_count ?? 0),
    rejected_candidate_count: rejectedCandidateCount,
  };
}

function requirementResultsById(audit) {
  return new Map([
    ...audit.local_requirements,
    ...audit.requirements,
    ...audit.on_demand_requirements,
  ].map((requirement) => [requirement.id, requirement]));
}

function proofTemplateCommand(id) {
  return `npm run proof:optional-live-template -- --id ${id} --write`;
}

function proofRecordCommand(id) {
  return `npm run proof:optional-live-record -- --id ${id} --from-json <sanitized.json>`;
}

function proofRecordReplaceCommand(id) {
  return `${proofRecordCommand(id)} --write --replace`;
}

function validateProofCommand(proofDir, requirement) {
  const includeOnDemand = requirement?.release_scope === "on_demand"
    ? " -- --include-on-demand"
    : "";
  return `TMWD_OPTIONAL_PROOF_DIR=${proofDir} npm run check:optional-live-proofs${includeOnDemand}`;
}

function baseCommands(requirement, proofDir) {
  return {
    record: proofRecordCommand(requirement.id),
    record_write: `${proofRecordCommand(requirement.id)} --write`,
    record_replace: proofRecordReplaceCommand(requirement.id),
    template: proofTemplateCommand(requirement.id),
    validate: validateProofCommand(proofDir, requirement),
  };
}

function baseItem({ requirement, result, proofDir }) {
  return {
    id: requirement.id,
    type: requirement.type,
    title: requirement.title,
    release_scope: requirement.release_scope,
    default_required: requirement.default_required,
    satisfied: result?.satisfied === true,
    proof_path: result?.proof_path,
    accepted: result?.accepted,
    candidates: result?.candidates,
    proof_dir: proofDir,
    commands: baseCommands(requirement, proofDir),
  };
}

function buildLocalCaptchaItem({ requirement, result, proofDir, nativePointer, currentPlatform }) {
  const satisfied = result?.satisfied === true;
  let status = "ready_for_explicit_opt_in";
  if (satisfied) {
    status = "satisfied";
  } else if (nativePointer?.ok !== true) {
    status = "blocked_by_native_pointer";
  }
  const nextCommand = satisfied
    ? validateProofCommand(proofDir, requirement)
    : nativePointer?.ok === true ? PHYSICAL_GATE_COMMAND : NATIVE_POINTER_COMMAND;
  return {
    ...baseItem({ requirement, result, proofDir }),
    status,
    collection_mode: "local_gui_physical_gate",
    current_platform: currentPlatform,
    required_current_platform: requirement.matches.platform,
    next_command: nextCommand,
    commands: {
      ...baseCommands(requirement, proofDir),
      native_pointer_readiness: NATIVE_POINTER_COMMAND,
      live_gate: PHYSICAL_GATE_COMMAND,
    },
    prerequisites: [
      "Run only on the local GUI host that owns the browser67-managed browser tab.",
      "Grant OS permissions required by the native pointer provider.",
      "Set TMWD_CAPTCHA_ASSIST_PHYSICAL=1 and TMWD_CAPTCHA_ASSIST_CONFIRM=1 explicitly.",
      "Use browser67-owned managed fixture tabs only.",
    ],
    evidence_requirements: [
      "slider_completed=true",
      "slider_visual_offset>=180",
      "handle_transform starts with translateX(",
      "checkbox_completed=true",
      "checkbox_click_inside=true",
      "managed_tab_only=true",
      "fullscreen_screenshot=false",
      "js_cdp_widget_click=false",
      "browser_private_state_access=false",
      "secrets_redacted=true",
    ],
    safety_boundaries: [
      "Do not use JS/CDP clicks on CAPTCHA widgets.",
      "Do not capture fullscreen screenshots.",
      "Do not read cookies, tokens, passwords, browser history, or session stores.",
      "Stop and hand off on multi-round image or puzzle challenges.",
    ],
    collection_steps: [
      "Run the native pointer readiness check.",
      "Run the explicit physical gate on a browser67-owned local fixture tab.",
      "Confirm the generated proof records slider completion and visible movement.",
      "Validate the repo-external proof directory.",
    ],
    native_pointer: nativePointer,
    permission_recovery: nativePointer?.permission_recovery ?? undefined,
  };
}

function buildNativeHostItem({ requirement, result, proofDir, nativePointer, currentPlatform }) {
  const targetPlatform = requirement.matches.platform;
  const currentHostMatches = currentPlatform === targetPlatform;
  const satisfied = result?.satisfied === true;
  const liveGateCommand = nativeLiveCommand(targetPlatform);
  const nextCommand = satisfied
    ? validateProofCommand(proofDir, requirement)
    : currentHostMatches
      ? (nativePointer?.ok === true ? liveGateCommand : NATIVE_POINTER_COMMAND)
      : `Run this plan on a ${targetPlatform} GUI host`;
  return {
    ...baseItem({ requirement, result, proofDir }),
    status: satisfied
      ? "satisfied"
      : currentHostMatches
        ? (nativePointer?.ok === true ? "run_on_this_host_with_explicit_opt_in" : "blocked_by_native_pointer")
        : "requires_target_platform_host",
    collection_mode: "cross_os_native_physical_gate",
    current_platform: currentPlatform,
    target_platform: targetPlatform,
    next_command: nextCommand,
    commands: {
      ...baseCommands(requirement, proofDir),
      native_pointer_readiness: NATIVE_POINTER_COMMAND,
      native_live_readiness: "npm run check:native-live",
      live_gate: liveGateCommand,
    },
    prerequisites: [
      `Run on a ${targetPlatform} GUI host with the same repo, an interactive desktop session, and a visible Chrome/Edge window.`,
      "Verify native pointer click/drag support before the physical gate.",
      "Use the unpacked browser67 extension and local hub; headless CI/SSH-only hosts do not qualify.",
      "Persist only the gate-generated sanitized proof JSON under the repo-external proof directory.",
    ],
    evidence_requirements: [
      `platform=${targetPlatform}`,
      "provider_id=native-os",
      "actions include get_window_rect",
      "actions include click",
      "actions include drag",
      "evidence.managed_tab_only=true",
      "evidence.fullscreen_screenshot=false",
      "evidence.secrets_redacted=true",
      "evidence.window_rect_verified=true",
      "evidence.drag_completed=true",
      "evidence.click_completed=true",
      "evidence.browser_private_state_access=false",
    ],
    safety_boundaries: [
      "Do not run against user unmanaged tabs.",
      "Do not store screenshots or secrets in proof JSON.",
      "Do not mark templates as accepted proof.",
    ],
    collection_steps: [
      `Move to a ${targetPlatform} GUI host with this repo, TMWD browser setup, and an unlocked interactive desktop.`,
      "Run native pointer readiness on that host.",
      "Run check:native-live to confirm the no-input target-host readiness result.",
      "Run the explicit proof:native-live physical gate; it creates a managed fixture, verifies get_window_rect/drag/click, finalizes its tabs, and records sanitized JSON automatically.",
      "Transfer only the generated native-live-*.json file to the release host and record it through proof:optional-live-record.",
      "Validate all optional proofs from the release host's repo-external proof directory.",
    ],
    native_pointer: currentHostMatches ? nativePointer : undefined,
    permission_recovery: currentHostMatches ? nativePointer?.permission_recovery : undefined,
  };
}

function buildIdpItem({ requirement, result, proofDir }) {
  const providerKind = requirement.matches.provider_kind;
  const satisfied = result?.satisfied === true;
  return {
    ...baseItem({ requirement, result, proofDir }),
    status: satisfied ? "satisfied" : "requires_approved_external_provider",
    collection_mode: "approved_external_idp_handoff_resume",
    provider_kind: providerKind,
    next_command: satisfied
      ? validateProofCommand(proofDir, requirement)
      : `Run approved external ${providerKind} handoff/resume gate`,
    commands: {
      ...baseCommands(requirement, proofDir),
      local_fixture_baseline: "npm run check:auth-live",
      external_live_gate: `Run an approved provider-specific ${providerKind} live gate and record sanitized proof JSON.`,
    },
    prerequisites: [
      "Use an approved representative provider or test tenant.",
      "Use repo-external exact-origin login profiles only.",
      "Capture manual-required state first, then complete user/native handoff, then resume ensure_login.",
      "Redact provider, tenant, account, token, cookie, and session details.",
    ],
    evidence_requirements: [
      `provider_kind=${providerKind}`,
      "manual_required_verified=true",
      "resume_verified=true",
      "evidence.secrets_redacted=true",
    ],
    safety_boundaries: [
      "Do not store provider tokens, cookies, session IDs, passwords, or authorization headers.",
      "Do not bypass MFA/SSO; prove handoff and resume only.",
      "Do not broaden profile origin allowlists.",
    ],
    collection_steps: [
      "Run the local auth live fixture baseline first.",
      "Use an approved external provider or test tenant.",
      "Capture manual_required state without storing provider secrets.",
      "Complete manual/native handoff outside the proof JSON.",
      "Resume ensure_login and record sanitized proof JSON.",
      "Validate the repo-external proof directory.",
    ],
  };
}

function buildPlanItem({ requirement, result, proofDir, nativePointer, currentPlatform }) {
  if (requirement.type === "captcha_physical_live") {
    return buildLocalCaptchaItem({ requirement, result, proofDir, nativePointer, currentPlatform });
  }
  if (requirement.type === "native_live") {
    return buildNativeHostItem({ requirement, result, proofDir, nativePointer, currentPlatform });
  }
  return buildIdpItem({ requirement, result, proofDir });
}

async function buildOptionalLiveProofPlan(args = {}) {
  const proofDir = resolve(args.proof_dir || process.env.TMWD_OPTIONAL_PROOF_DIR || DEFAULT_OPTIONAL_LIVE_PROOF_DIR);
  const selected = selectedRequirements(String(args.id ?? "").trim());
  const currentPlatform = String(args.current_platform || process.platform);
  const auditPromise = buildOptionalLiveProofAudit({ proof_dir: proofDir });
  const nativePointerPromise = args.native_pointer
    ? Promise.resolve(args.native_pointer)
    : detectNativeInputCapabilities({ refresh: true, cache_ttl_ms: 0 }).then((nativeCapabilities) => (
      buildNativePointerReadinessReport(nativeCapabilities, {
        verify_command: NATIVE_POINTER_COMMAND,
        physical_gate_command: PHYSICAL_GATE_COMMAND,
      })
    ));
  const [audit, nativePointer] = await Promise.all([auditPromise, nativePointerPromise]);
  const resultById = requirementResultsById(audit);
  const items = selected.map((requirement) => buildPlanItem({
    requirement,
    result: resultById.get(requirement.id),
    proofDir,
    nativePointer,
    currentPlatform,
  }));
  const summary = summarizeItems(items, audit.summary);
  return {
    ok: true,
    action: "optional-live-proof-plan",
    proof_dir: proofDir,
    filter: {
      id: args.id || undefined,
      release_scope: args.id ? selected[0]?.release_scope : "default",
    },
    complete: summary.missing_count === 0 && summary.invalid_file_count === 0,
    summary,
    audit_summary: audit.summary,
    safe_defaults: [
      "This plan does not move the mouse.",
      "This plan does not open Chrome or create managed tabs.",
      "This plan does not read browser private state.",
      "This plan does not write proof files unless the operator runs a listed write-enabled command.",
    ],
    items,
  };
}

function outputText(plan) {
  process.stdout.write(
    `optional_live_proof_plan=${plan.complete ? "complete" : "missing"} satisfied=${plan.summary.satisfied_count}/${plan.summary.required_count} missing=${plan.summary.missing_count} proof_dir=${plan.proof_dir}${plan.filter?.id ? ` filter_id=${plan.filter.id}` : ""}\n`,
  );
  for (const item of plan.items) {
    process.stdout.write(`- ${item.id}: status=${item.status} mode=${item.collection_mode}\n`);
    if (item.proof_path) {
      process.stdout.write(`  proof=${item.proof_path}\n`);
    }
    if (item.accepted?.expires_at) {
      process.stdout.write(`  expires_at=${item.accepted.expires_at} expires_in_days=${item.accepted.expires_in_days}\n`);
    }
    if (item.permission_recovery) {
      process.stdout.write(`  permission_recovery=${item.permission_recovery.status} blocker=${item.permission_recovery.blocker}\n`);
    }
    if (item.next_command) {
      process.stdout.write(`  next=${item.next_command}\n`);
    }
    process.stdout.write(`  template=${item.commands.template}\n`);
    process.stdout.write(`  record=${item.commands.record}\n`);
    process.stdout.write(`  validate=${item.commands.validate}\n`);
  }
}

async function runPlanCommand(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  const plan = await buildOptionalLiveProofPlan(args);
  if (args.json) {
    process.stdout.write(`${JSON.stringify(plan)}\n`);
  } else {
    outputText(plan);
  }
  return plan;
}

if (import.meta.url === pathToFileURL(process.argv[1] || "").href) {
  try {
    await runPlanCommand();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const file = basename(process.argv[1] || "optional-live-proof-plan.mjs");
    process.stderr.write(`${file} failed: ${message}\n`);
    process.exitCode = 1;
  }
}

export {
  buildOptionalLiveProofPlan,
  runPlanCommand,
};
