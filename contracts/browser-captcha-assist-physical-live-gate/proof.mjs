import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import { join, resolve } from "node:path";

import { DEFAULT_OPTIONAL_LIVE_PROOF_DIR } from "../../scripts/optional-live-proof-audit.mjs";

function expiresAtFrom(checkedAt) {
  const date = new Date(checkedAt);
  date.setUTCDate(date.getUTCDate() + 90);
  return date.toISOString();
}

function physicalGateCommand() {
  return "TMWD_CAPTCHA_ASSIST_PHYSICAL=1 TMWD_CAPTCHA_ASSIST_CONFIRM=1 npm run check:captcha-assist-physical-live";
}

function buildPhysicalProof(parsed, options = {}) {
  const checkedAt = options.checked_at ?? new Date().toISOString();
  return {
    type: "captcha_physical_live",
    ok: true,
    platform: options.platform ?? process.platform,
    provider_id: parsed.physical_assist_provider_id || "unknown",
    actions: ["drag", "click"],
    checked_at: checkedAt,
    expires_at: options.expires_at ?? expiresAtFrom(checkedAt),
    command: physicalGateCommand(),
    managed_tab_only: true,
    fixture: "local TMWD-owned managed tab",
    slider_completed: parsed.physical_completion?.slider_completed === true,
    checkbox_completed: parsed.checkbox_physical_completion?.checkbox_completed === true,
    fullscreen_screenshot: false,
    js_cdp_widget_click: false,
    secrets_redacted: true,
    evidence: {
      assist_target: "slider",
      assist_targets: ["slider", "checkbox"],
      coordinate_source: parsed.physical_assist_coordinates_source || "vision_corrected_region_capture",
      checkbox_coordinate_source: parsed.checkbox_physical_assist_coordinates_source || "vision_corrected_region_capture",
      provider_selection_reason: parsed.physical_assist_provider_selection_reason || "not_reported",
      checkbox_provider_selection_reason: parsed.checkbox_physical_assist_provider_selection_reason || "not_reported",
      vision_correction_status: parsed.vision_correction_status,
      slider_visual_offset: Number.isFinite(Number(parsed.physical_completion?.slider_visual_offset))
        ? Number(parsed.physical_completion.slider_visual_offset)
        : undefined,
      slider_delta_live: parsed.physical_completion?.slider_delta_live,
      handle_transform: parsed.physical_completion?.handle_transform,
      checkbox_click_inside: parsed.checkbox_physical_completion?.checkbox_click_inside,
      checkbox_status_text: parsed.checkbox_physical_completion?.status_text,
      checkbox_click: parsed.checkbox_physical_completion?.checkbox_click,
      physical_attempt_count: Number.isFinite(Number(parsed.physical_attempt_count))
        ? Number(parsed.physical_attempt_count)
        : undefined,
      checkbox_physical_attempt_count: Number.isFinite(Number(parsed.checkbox_physical_attempt_count))
        ? Number(parsed.checkbox_physical_attempt_count)
        : undefined,
      matrix_case_count: Array.isArray(parsed.matrix_results) ? parsed.matrix_results.length : 0,
      finalized_closed: parsed.finalized_closed,
      browser_private_state_access: false,
      wait_after_ms: 5000,
    },
  };
}

async function writePhysicalProof(parsed, options = {}) {
  if (options.write_proof_disabled) {
    return {
      written: false,
      reason: "TMWD_CAPTCHA_ASSIST_WRITE_PROOF disabled",
    };
  }
  const proofDir = resolve(options.proof_dir || DEFAULT_OPTIONAL_LIVE_PROOF_DIR);
  await fs.mkdir(proofDir, { recursive: true });
  const proof = buildPhysicalProof(parsed, {
    platform: options.platform,
    checked_at: options.checked_at,
    expires_at: options.expires_at,
  });
  const safeTimestamp = proof.checked_at.replace(/[:.]/g, "-");
  const proofPath = join(proofDir, `captcha-assist-physical-${proof.platform}-${safeTimestamp}.json`);
  const body = `${JSON.stringify(proof, null, 2)}\n`;
  await fs.writeFile(proofPath, body, { flag: "wx" });
  return {
    written: true,
    id: "captcha-assist-physical-local",
    path: proofPath,
    sha256: createHash("sha256").update(body).digest("hex"),
    expires_at: proof.expires_at,
  };
}

export {
  buildPhysicalProof,
  expiresAtFrom,
  physicalGateCommand,
  writePhysicalProof,
};
