#!/usr/bin/env node

import { promises as fs } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { resolveBrowser67HomePath } from "../src/runtime/paths/home.mjs";

const DEFAULT_OPTIONAL_LIVE_PROOF_DIR = join(resolveBrowser67HomePath(), "optional-live-proofs");
const SENSITIVE_KEY_PATTERN = /(?:password|passwd|secret|token|cookie|session|authorization|credential)/i;
const SENSITIVE_VALUE_PATTERN = /(?:\bBearer\s+[A-Za-z0-9._~+/-]+=*|eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}|(?:^|[;,\s])(?:sid|sessionid|token|cookie|authorization)=\S+)/i;
const PLACEHOLDER_COMMAND_PATTERN = /(?:replace with exact|placeholder|template-only|template only)/i;
const SAFE_REDACTION_STATUS_KEYS = new Set(["secrets_redacted", "credentials_redacted"]);
const VALID_IDP_PROVIDER_KINDS = new Set(["oauth_popup", "cross_domain_sso", "mfa"]);
const IDP_IDENTIFIER_KEY_PATTERN = /(?:tenant|account|email|username|phone|domain|provider|client_id|org_id|user_id)/i;
const REDACTED_VALUE_PATTERN = /(?:redacted|anonymous|anonymized|hashed|synthetic|fixture|test tenant|test provider)/i;
const MIN_CAPTCHA_SLIDER_VISUAL_OFFSET = 180;

const LOCAL_OPTIONAL_LIVE_PROOF_REQUIREMENTS = [
  {
    id: "captcha-assist-physical-local",
    type: "captcha_physical_live",
    title: `Local ${process.platform} CAPTCHA physical-input live proof`,
    matches: { platform: process.platform },
    required_fields: [
      "platform",
      "provider_id",
      "actions",
      "checked_at",
      "command",
      "managed_tab_only",
      "fixture",
      "slider_completed",
      "fullscreen_screenshot",
      "js_cdp_widget_click",
      "secrets_redacted",
      "evidence",
    ],
  },
];

const OPTIONAL_LIVE_PROOF_REQUIREMENTS = [
  {
    id: "native-live-linux",
    type: "native_live",
    title: "Linux native physical-input live proof",
    matches: { platform: "linux" },
    required_fields: ["platform", "provider_id", "actions", "checked_at", "command", "evidence"],
  },
  {
    id: "native-live-win32",
    type: "native_live",
    title: "Windows native physical-input live proof",
    matches: { platform: "win32" },
    required_fields: ["platform", "provider_id", "actions", "checked_at", "command", "evidence"],
  },
  {
    id: "idp-oauth-popup",
    type: "idp_live",
    title: "External OAuth popup handoff/resume live proof",
    matches: { provider_kind: "oauth_popup" },
    required_fields: ["provider_kind", "checked_at", "command", "manual_required_verified", "resume_verified", "evidence"],
  },
  {
    id: "idp-cross-domain-sso",
    type: "idp_live",
    title: "External cross-domain SSO handoff/resume live proof",
    matches: { provider_kind: "cross_domain_sso" },
    required_fields: ["provider_kind", "checked_at", "command", "manual_required_verified", "resume_verified", "evidence"],
  },
  {
    id: "idp-mfa",
    type: "idp_live",
    title: "External MFA handoff/resume live proof",
    matches: { provider_kind: "mfa" },
    required_fields: ["provider_kind", "checked_at", "command", "manual_required_verified", "resume_verified", "evidence"],
  },
];

const ALL_OPTIONAL_LIVE_PROOF_REQUIREMENTS = [
  ...LOCAL_OPTIONAL_LIVE_PROOF_REQUIREMENTS,
  ...OPTIONAL_LIVE_PROOF_REQUIREMENTS,
];

function parseArgs(argv) {
  const parsed = {
    json: false,
    strict: false,
    proof_dir: process.env.TMWD_OPTIONAL_PROOF_DIR || DEFAULT_OPTIONAL_LIVE_PROOF_DIR,
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
    if (token === "--proof-dir") {
      parsed.proof_dir = String(argv[index + 1] ?? "").trim();
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

async function readProofFiles(proofDir) {
  let entries;
  try {
    entries = await fs.readdir(proofDir, { withFileTypes: true });
  } catch (error) {
    if (error?.code === "ENOENT") {
      return [];
    }
    throw error;
  }
  const proofFiles = entries
    .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
    .map((entry) => join(proofDir, entry.name))
    .sort();
  return Promise.all(proofFiles.map(async (path) => {
    try {
      return {
        path,
        proof: JSON.parse(await fs.readFile(path, "utf8")),
      };
    } catch (error) {
      return {
        path,
        error: `invalid_json: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  }));
}

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function findSensitiveKeys(value, path = "$") {
  if (Array.isArray(value)) {
    return value.flatMap((item, index) => findSensitiveKeys(item, `${path}[${index}]`));
  }
  if (!isPlainObject(value)) {
    return [];
  }
  const hits = [];
  for (const [key, nested] of Object.entries(value)) {
    const nextPath = `${path}.${key}`;
    if (SENSITIVE_KEY_PATTERN.test(key) && !SAFE_REDACTION_STATUS_KEYS.has(key)) {
      hits.push(nextPath);
      continue;
    }
    hits.push(...findSensitiveKeys(nested, nextPath));
  }
  return hits;
}

function findSensitiveValues(value, path = "$") {
  if (typeof value === "string") {
    return SENSITIVE_VALUE_PATTERN.test(value) ? [path] : [];
  }
  if (Array.isArray(value)) {
    return value.flatMap((item, index) => findSensitiveValues(item, `${path}[${index}]`));
  }
  if (!isPlainObject(value)) {
    return [];
  }
  return Object.entries(value).flatMap(([key, nested]) => findSensitiveValues(nested, `${path}.${key}`));
}

function safeRedactedIdentifierValue(value) {
  if (value === undefined || value === null) {
    return true;
  }
  if (typeof value !== "string") {
    return false;
  }
  return REDACTED_VALUE_PATTERN.test(value);
}

function findIdpIdentifierLeaks(value, path = "$") {
  if (Array.isArray(value)) {
    return value.flatMap((item, index) => findIdpIdentifierLeaks(item, `${path}[${index}]`));
  }
  if (!isPlainObject(value)) {
    return [];
  }
  const hits = [];
  for (const [key, nested] of Object.entries(value)) {
    const nextPath = `${path}.${key}`;
    if (IDP_IDENTIFIER_KEY_PATTERN.test(key)) {
      if (!safeRedactedIdentifierValue(nested)) {
        hits.push(nextPath);
      }
      continue;
    }
    hits.push(...findIdpIdentifierLeaks(nested, nextPath));
  }
  return hits;
}

function validIsoTimestamp(value) {
  if (typeof value !== "string" || !value.trim()) {
    return false;
  }
  const parsed = Date.parse(value);
  return Number.isFinite(parsed);
}

function numericField(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function validTranslateX(value) {
  return typeof value === "string" && /^translateX\(-?\d+(?:\.\d+)?px\)$/.test(value.trim());
}

function proofMatchesRequirement(proof, requirement) {
  if (!isPlainObject(proof)) {
    return false;
  }
  if (proof.type !== requirement.type || proof.ok !== true || proof.template_only === true) {
    return false;
  }
  for (const [key, expected] of Object.entries(requirement.matches)) {
    if (proof[key] !== expected) {
      return false;
    }
  }
  return true;
}

function proofTargetsRequirement(proof, requirement) {
  if (!isPlainObject(proof) || proof.type !== requirement.type) {
    return false;
  }
  for (const [key, expected] of Object.entries(requirement.matches)) {
    if (proof[key] !== expected) {
      return false;
    }
  }
  return true;
}

function validateProof(proof, requirement) {
  const errors = [];
  if (!proofMatchesRequirement(proof, requirement)) {
    errors.push("requirement_match_failed");
  }
  if (proof.template_only === true) {
    errors.push("template_only_not_accepted");
  }
  for (const field of requirement.required_fields) {
    if (!Object.prototype.hasOwnProperty.call(proof, field)) {
      errors.push(`missing_field:${field}`);
    }
  }
  if (!validIsoTimestamp(proof.checked_at)) {
    errors.push("invalid_checked_at");
  }
  if (proof.expires_at !== undefined && !validIsoTimestamp(proof.expires_at)) {
    errors.push("invalid_expires_at");
  }
  if (proof.expires_at !== undefined && Date.parse(proof.expires_at) <= Date.now()) {
    errors.push("expired");
  }
  if (
    validIsoTimestamp(proof.checked_at)
    && proof.expires_at !== undefined
    && validIsoTimestamp(proof.expires_at)
    && Date.parse(proof.expires_at) <= Date.parse(proof.checked_at)
  ) {
    errors.push("expires_at_must_be_after_checked_at");
  }
  if (typeof proof.command !== "string" || proof.command.trim().length === 0) {
    errors.push("command_required");
  } else if (PLACEHOLDER_COMMAND_PATTERN.test(proof.command)) {
    errors.push("placeholder_command_not_accepted");
  }
  if (requirement.type === "native_live") {
    if (!Array.isArray(proof.actions) || proof.actions.length === 0) {
      errors.push("native_actions_required");
    }
    if (!Array.isArray(proof.actions) || !proof.actions.includes("click")) {
      errors.push("native_click_action_required");
    }
    if (!Array.isArray(proof.actions) || !proof.actions.includes("drag")) {
      errors.push("native_drag_action_required");
    }
    if (!isPlainObject(proof.evidence)) {
      errors.push("evidence_object_required");
    } else {
      if (proof.evidence.managed_tab_only !== true) {
        errors.push("native_managed_tab_only_must_be_true");
      }
      if (proof.evidence.fullscreen_screenshot !== false) {
        errors.push("native_fullscreen_screenshot_must_be_false");
      }
      if (proof.evidence.secrets_redacted !== true) {
        errors.push("native_secrets_redacted_must_be_true");
      }
    }
  }
  if (requirement.type === "captcha_physical_live") {
    if (!Array.isArray(proof.actions) || !proof.actions.includes("drag")) {
      errors.push("captcha_physical_drag_action_required");
    }
    if (!Array.isArray(proof.actions) || !proof.actions.includes("click")) {
      errors.push("captcha_physical_click_action_required");
    }
    if (proof.managed_tab_only !== true) {
      errors.push("managed_tab_only_must_be_true");
    }
    if (proof.slider_completed !== true) {
      errors.push("slider_completed_must_be_true");
    }
    if (proof.checkbox_completed !== true) {
      errors.push("checkbox_completed_must_be_true");
    }
    if (proof.fullscreen_screenshot !== false) {
      errors.push("fullscreen_screenshot_must_be_false");
    }
    if (proof.js_cdp_widget_click !== false) {
      errors.push("js_cdp_widget_click_must_be_false");
    }
    if (proof.secrets_redacted !== true) {
      errors.push("secrets_redacted_must_be_true");
    }
    if (!isPlainObject(proof.evidence)) {
      errors.push("evidence_object_required");
    } else {
      if (proof.evidence.browser_private_state_access !== false) {
        errors.push("browser_private_state_access_must_be_false");
      }
      const sliderVisualOffset = numericField(proof.evidence.slider_visual_offset);
      if (sliderVisualOffset === undefined || sliderVisualOffset < MIN_CAPTCHA_SLIDER_VISUAL_OFFSET) {
        errors.push("slider_visual_offset_must_be_at_least_180");
      }
      const sliderDeltaLive = numericField(proof.evidence.slider_delta_live);
      if (sliderDeltaLive === undefined || sliderDeltaLive < MIN_CAPTCHA_SLIDER_VISUAL_OFFSET) {
        errors.push("slider_delta_live_must_be_at_least_180");
      }
      if (!validTranslateX(proof.evidence.handle_transform)) {
        errors.push("handle_transform_translatex_required");
      }
      if (proof.evidence.checkbox_click_inside !== true) {
        errors.push("checkbox_click_inside_must_be_true");
      }
    }
  }
  if (requirement.type === "idp_live") {
    if (!VALID_IDP_PROVIDER_KINDS.has(proof.provider_kind)) {
      errors.push("invalid_provider_kind");
    }
    if (proof.manual_required_verified !== true) {
      errors.push("manual_required_verified_must_be_true");
    }
    if (proof.resume_verified !== true) {
      errors.push("resume_verified_must_be_true");
    }
    if (!isPlainObject(proof.evidence)) {
      errors.push("evidence_object_required");
    } else if (proof.evidence.secrets_redacted !== true) {
      errors.push("idp_secrets_redacted_must_be_true");
    }
  }
  const sensitiveKeys = findSensitiveKeys(proof);
  if (sensitiveKeys.length > 0) {
    errors.push(`sensitive_keys_present:${sensitiveKeys.join(",")}`);
  }
  const sensitiveValues = findSensitiveValues(proof);
  if (sensitiveValues.length > 0) {
    errors.push(`sensitive_values_present:${sensitiveValues.join(",")}`);
  }
  if (requirement.type === "idp_live" && isPlainObject(proof.evidence)) {
    const idpIdentifierLeaks = findIdpIdentifierLeaks(proof.evidence);
    if (idpIdentifierLeaks.length > 0) {
      errors.push(`idp_identifier_values_must_be_redacted:${idpIdentifierLeaks.join(",")}`);
    }
  }
  return {
    ok: errors.length === 0,
    errors,
  };
}

function checklistItem(id, ok, message, details = {}) {
  return {
    id,
    ok,
    message,
    ...details,
  };
}

function buildProofRedactionChecklist(proof, requirement) {
  const sensitiveKeys = findSensitiveKeys(proof);
  const sensitiveValues = findSensitiveValues(proof);
  const idpIdentifierLeaks = requirement.type === "idp_live" && isPlainObject(proof?.evidence)
    ? findIdpIdentifierLeaks(proof.evidence)
    : [];
  const checks = [
    checklistItem(
      "no_sensitive_key_names",
      sensitiveKeys.length === 0,
      "Proof JSON must not contain keys named like password, secret, token, cookie, session, authorization, or credential.",
      sensitiveKeys.length > 0 ? { paths: sensitiveKeys } : {},
    ),
    checklistItem(
      "no_sensitive_value_patterns",
      sensitiveValues.length === 0,
      "Proof JSON must not contain Bearer tokens, JWT-like values, or cookie/session assignment strings.",
      sensitiveValues.length > 0 ? { paths: sensitiveValues } : {},
    ),
    checklistItem(
      "not_template_only",
      proof?.template_only !== true,
      "Templates must be replaced by sanitized output from a real live gate.",
    ),
    checklistItem(
      "command_is_exact",
      typeof proof?.command === "string" && proof.command.trim().length > 0 && !PLACEHOLDER_COMMAND_PATTERN.test(proof.command),
      "Command must be the exact approved gate/runbook command, not a placeholder.",
    ),
  ];

  if (requirement.type === "captcha_physical_live") {
    checks.push(
      checklistItem(
        "captcha_no_browser_private_state",
        proof?.evidence?.browser_private_state_access === false,
        "Local CAPTCHA physical proof must explicitly avoid browser private state access.",
      ),
      checklistItem(
        "captcha_no_fullscreen_or_cdp_widget_click",
        proof?.fullscreen_screenshot === false && proof?.js_cdp_widget_click === false,
        "Local CAPTCHA physical proof must not use fullscreen screenshots or JS/CDP widget clicks.",
      ),
    );
  }

  if (requirement.type === "native_live") {
    checks.push(
      checklistItem(
        "native_managed_tab_only",
        proof?.evidence?.managed_tab_only === true,
        "Native proof must run only against browser67-owned managed fixture tabs.",
      ),
      checklistItem(
        "native_no_fullscreen_screenshot",
        proof?.evidence?.fullscreen_screenshot === false,
        "Native proof must not rely on fullscreen screenshots.",
      ),
    );
  }

  if (requirement.type === "idp_live") {
    checks.push(
      checklistItem(
        "idp_handoff_resume_only",
        proof?.manual_required_verified === true && proof?.resume_verified === true,
        "External IdP proof must show manual-required handoff and resume, not bypass.",
      ),
      checklistItem(
        "idp_identifiers_redacted",
        idpIdentifierLeaks.length === 0,
        "External IdP proof must redact tenant, account, email, username, phone, domain, provider, client, org, and user identifiers.",
        idpIdentifierLeaks.length > 0 ? { paths: idpIdentifierLeaks } : {},
      ),
    );
  }

  return {
    ok: checks.every((item) => item.ok === true),
    checks,
  };
}

function proofFreshness(proof) {
  const checkedAt = validIsoTimestamp(proof?.checked_at) ? proof.checked_at : undefined;
  const expiresAt = validIsoTimestamp(proof?.expires_at) ? proof.expires_at : undefined;
  const expiresInDays = expiresAt === undefined
    ? undefined
    : Math.ceil((Date.parse(expiresAt) - Date.now()) / (24 * 60 * 60 * 1000));
  return {
    checked_at: checkedAt,
    expires_at: expiresAt,
    expires_in_days: expiresInDays,
    expires_soon: Number.isFinite(expiresInDays) ? expiresInDays <= 14 : undefined,
  };
}

function evaluateRequirements(rows, requirements = OPTIONAL_LIVE_PROOF_REQUIREMENTS) {
  return requirements.map((requirement) => {
    const candidates = rows
      .filter((row) => row.proof && proofTargetsRequirement(row.proof, requirement))
      .map((row) => ({
        path: row.path,
        ...proofFreshness(row.proof),
        validation: validateProof(row.proof, requirement),
      }));
    const accepted = candidates.find((candidate) => candidate.validation.ok);
    return {
      id: requirement.id,
      type: requirement.type,
      title: requirement.title,
      satisfied: Boolean(accepted),
      proof_path: accepted?.path,
      accepted: accepted
        ? {
          path: accepted.path,
          checked_at: accepted.checked_at,
          expires_at: accepted.expires_at,
          expires_in_days: accepted.expires_in_days,
          expires_soon: accepted.expires_soon,
        }
        : undefined,
      candidates,
    };
  });
}

async function buildOptionalLiveProofAudit(args = {}) {
  const proofDir = resolve(args.proof_dir || process.env.TMWD_OPTIONAL_PROOF_DIR || DEFAULT_OPTIONAL_LIVE_PROOF_DIR);
  const rows = await readProofFiles(proofDir);
  const invalid_files = rows
    .filter((row) => row.error)
    .map((row) => ({ path: row.path, error: row.error }));
  const proofRows = rows.filter((row) => row.proof);
  const local_requirements = evaluateRequirements(proofRows, LOCAL_OPTIONAL_LIVE_PROOF_REQUIREMENTS);
  const requirements = evaluateRequirements(proofRows, OPTIONAL_LIVE_PROOF_REQUIREMENTS);
  const missing = requirements
    .filter((requirement) => !requirement.satisfied)
    .map((requirement) => requirement.id);
  const local_missing = local_requirements
    .filter((requirement) => !requirement.satisfied)
    .map((requirement) => requirement.id);
  const localSatisfiedCount = local_requirements.filter((requirement) => requirement.satisfied).length;
  const externalSatisfiedCount = requirements.filter((requirement) => requirement.satisfied).length;
  const complete = missing.length === 0 && local_missing.length === 0 && invalid_files.length === 0;
  return {
    ok: true,
    status: complete ? "complete" : "optional_gaps",
    check: "optional-live-proof-audit",
    proof_dir: proofDir,
    strict: args.strict === true,
    complete,
    proof_file_count: rows.length,
    invalid_files,
    local_requirements,
    requirements,
    local_missing,
    missing,
    summary: {
      required_count: ALL_OPTIONAL_LIVE_PROOF_REQUIREMENTS.length,
      satisfied_count: localSatisfiedCount + externalSatisfiedCount,
      local_satisfied_count: localSatisfiedCount,
      external_satisfied_count: externalSatisfiedCount,
      local_missing_count: local_missing.length,
      external_missing_count: missing.length,
      missing_count: local_missing.length + missing.length,
      invalid_file_count: invalid_files.length,
    },
  };
}

function outputText(audit) {
  process.stdout.write(
    `optional_live_proofs=${audit.status} satisfied=${audit.summary.satisfied_count}/${audit.summary.required_count} missing=${audit.summary.missing_count} proof_dir=${audit.proof_dir}\n`,
  );
  if (audit.missing.length > 0) {
    process.stdout.write(`missing=${audit.missing.join(",")}\n`);
  }
  if (audit.local_missing.length > 0) {
    process.stdout.write(`local_missing=${audit.local_missing.join(",")}\n`);
  }
  if (audit.invalid_files.length > 0) {
    process.stdout.write(`invalid_files=${audit.invalid_files.map((item) => item.path).join(",")}\n`);
  }
}

async function run() {
  const args = parseArgs(process.argv.slice(2));
  const audit = await buildOptionalLiveProofAudit(args);
  if (args.json) {
    process.stdout.write(`${JSON.stringify(audit)}\n`);
  } else {
    outputText(audit);
  }
  process.exitCode = args.strict && !audit.complete ? 1 : 0;
}

if (import.meta.url === pathToFileURL(process.argv[1] || "").href) {
  try {
    await run();
  } catch (error) {
    process.stderr.write(`optional-live-proof-audit failed: ${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}

export {
  ALL_OPTIONAL_LIVE_PROOF_REQUIREMENTS,
  buildOptionalLiveProofAudit,
  buildProofRedactionChecklist,
  DEFAULT_OPTIONAL_LIVE_PROOF_DIR,
  LOCAL_OPTIONAL_LIVE_PROOF_REQUIREMENTS,
  OPTIONAL_LIVE_PROOF_REQUIREMENTS,
  proofTargetsRequirement,
  validateProof,
};
