#!/usr/bin/env node

import { basename, resolve } from "node:path";
import { pathToFileURL } from "node:url";

import {
  buildOptionalLiveProofPlan,
} from "./optional-live-proof-plan.mjs";
import {
  DEFAULT_OPTIONAL_LIVE_PROOF_DIR,
} from "./optional-live-proof-audit.mjs";

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

function proofScope(item = {}) {
  if (item.type === "captcha_physical_live") {
    return "local_current_host";
  }
  if (item.type === "native_live") {
    return "external_target_os_host";
  }
  return "external_approved_idp";
}

function proofOwner(item = {}) {
  if (item.type === "captcha_physical_live") {
    return `local_${item.current_platform ?? "current"}_gui_operator`;
  }
  if (item.type === "native_live") {
    return `${item.target_platform ?? "target"}_gui_operator`;
  }
  return `${item.provider_kind ?? "idp"}_test_tenant_operator`;
}

function compactChecklistItem(item = {}) {
  return {
    id: item.id,
    title: item.title,
    type: item.type,
    release_scope: item.release_scope,
    default_required: item.default_required,
    scope: proofScope(item),
    owner: proofOwner(item),
    status: item.status,
    satisfied: item.satisfied === true,
    next_command: item.next_command,
    record_command: item.commands?.record,
    record_write_command: item.commands?.record_write,
    record_replace_command: item.commands?.record_replace,
    validate_command: item.commands?.validate,
    evidence_requirements: item.evidence_requirements,
    safety_boundaries: item.safety_boundaries,
    collection_steps: item.collection_steps,
  };
}

function acceptedItem(item = {}) {
  return {
    id: item.id,
    title: item.title,
    type: item.type,
    release_scope: item.release_scope,
    default_required: item.default_required,
    proof_path: item.proof_path,
    checked_at: item.accepted?.checked_at,
    expires_at: item.accepted?.expires_at,
    expires_in_days: item.accepted?.expires_in_days,
    expires_soon: item.accepted?.expires_soon,
    refresh_command: item.commands?.record_replace,
  };
}

function classifyMissing(items) {
  const missing = items.filter((item) => item.satisfied !== true);
  const local = missing.filter((item) => proofScope(item) === "local_current_host");
  const crossOs = missing.filter((item) => proofScope(item) === "external_target_os_host");
  const idp = missing.filter((item) => proofScope(item) === "external_approved_idp");
  const runnableNow = missing.filter((item) => (
    item.status === "ready_for_explicit_opt_in"
    || item.status === "run_on_this_host_with_explicit_opt_in"
  ));
  const blockedNow = missing.filter((item) => (
    item.status === "blocked_by_native_pointer"
    || item.status === "requires_target_platform_host"
    || item.status === "requires_approved_external_provider"
  ));
  return {
    missing,
    local,
    cross_os: crossOs,
    idp,
    runnable_now: runnableNow,
    blocked_now: blockedNow,
  };
}

async function buildOptionalLiveProofStatus(args = {}) {
  const proofDir = resolve(args.proof_dir || process.env.TMWD_OPTIONAL_PROOF_DIR || DEFAULT_OPTIONAL_LIVE_PROOF_DIR);
  const plan = await buildOptionalLiveProofPlan({
    proof_dir: proofDir,
    id: args.id,
    current_platform: args.current_platform,
    native_pointer: args.native_pointer,
  });
  const classified = classifyMissing(plan.items);
  const accepted = plan.items
    .filter((item) => item.satisfied === true)
    .map(acceptedItem);
  const checklist = classified.missing.map(compactChecklistItem);
  const nextActions = classified.runnable_now.length > 0
    ? classified.runnable_now.map((item) => ({
      id: item.id,
      action: "run_explicit_local_gate",
      command: item.next_command,
    }))
    : classified.blocked_now.map((item) => ({
      id: item.id,
      action: item.status,
      command: item.next_command,
    }));

  return {
    ok: true,
    action: "optional-live-proof-status",
    status: plan.complete ? "complete" : classified.local.length > 0 ? "needs_local_action" : "needs_external_proofs",
    complete: plan.complete,
    proof_dir: proofDir,
    filter: plan.filter,
    summary: {
      ...plan.summary,
      accepted_count: accepted.length,
      checklist_count: checklist.length,
      runnable_now_count: classified.runnable_now.length,
      blocked_now_count: classified.blocked_now.length,
      cross_os_missing_count: classified.cross_os.length,
      idp_missing_count: classified.idp.length,
    },
    safe_defaults: [
      ...plan.safe_defaults,
      "This status output does not execute any listed command.",
      "This status output stores no proof files and reads no browser private state.",
    ],
    accepted,
    checklist,
    next_actions: nextActions,
    completion_policy: {
      required: [
        "All checklist items must have sanitized accepted proof JSON.",
        "Templates and placeholder commands never count as accepted proof.",
        "External IdP proofs must prove manual-required handoff/resume, not bypass.",
        "Cross-OS native proofs must be collected on the target GUI OS host.",
      ],
      forbidden: [
        "Do not fabricate Linux, Windows, OAuth, SSO, or MFA proofs on a different host/provider.",
        "Do not store cookies, tokens, session IDs, passwords, screenshots with private data, or authorization headers.",
        "Do not use JS/CDP clicks on CAPTCHA widgets or unmanaged user tabs during physical proof collection.",
      ],
    },
  };
}

function outputText(status) {
  process.stdout.write(
    `optional_live_proof_status=${status.status} satisfied=${status.summary.satisfied_count}/${status.summary.required_count} missing=${status.summary.missing_count} invalid_files=${status.summary.invalid_file_count} rejected_candidates=${status.summary.rejected_candidate_count} proof_dir=${status.proof_dir}${status.filter?.id ? ` filter_id=${status.filter.id}` : ""}\n`,
  );
  if (status.accepted.length > 0) {
    process.stdout.write("accepted:\n");
    status.accepted.forEach((item) => {
      const freshness = item.expires_at
        ? ` expires_at=${item.expires_at} expires_in_days=${item.expires_in_days}`
        : "";
      process.stdout.write(`- ${item.id}: proof=${item.proof_path}${freshness}\n`);
    });
  }
  if (status.checklist.length > 0) {
    process.stdout.write("checklist:\n");
    status.checklist.forEach((item) => {
      process.stdout.write(`- ${item.id}: owner=${item.owner} status=${item.status}\n`);
      process.stdout.write(`  next=${item.next_command}\n`);
      process.stdout.write(`  record=${item.record_command}\n`);
      process.stdout.write(`  write=${item.record_write_command}\n`);
      process.stdout.write(`  validate=${item.validate_command}\n`);
    });
  }
  if (status.next_actions.length > 0) {
    process.stdout.write("next_actions:\n");
    status.next_actions.forEach((item) => {
      process.stdout.write(`- ${item.id}: action=${item.action} command=${item.command}\n`);
    });
  }
}

async function runStatusCommand(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  const status = await buildOptionalLiveProofStatus(args);
  if (args.json) {
    process.stdout.write(`${JSON.stringify(status)}\n`);
  } else {
    outputText(status);
  }
  return status;
}

if (import.meta.url === pathToFileURL(process.argv[1] || "").href) {
  runStatusCommand().catch((error) => {
    const message = error instanceof Error ? error.message : String(error);
    const file = basename(process.argv[1] || "optional-live-proof-status.mjs");
    process.stderr.write(`${file} failed: ${message}\n`);
    process.exitCode = 1;
  });
}

export {
  buildOptionalLiveProofStatus,
  runStatusCommand,
};
