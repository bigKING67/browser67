#!/usr/bin/env node
import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { promises as fs } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { DEFAULT_OPTIONAL_LIVE_PROOF_DIR } from "../scripts/optional-live-proof-audit.mjs";
import { detectNativeInputCapabilities } from "../src/native-capabilities.mjs";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const liveSmokePath = resolve(scriptDir, "browser-captcha-assist-live-smoke.mjs");

function envEnabled(name) {
  return ["1", "true", "yes", "on"].includes(String(process.env[name] ?? "").trim().toLowerCase());
}

function envDisabled(name) {
  return ["0", "false", "no", "off"].includes(String(process.env[name] ?? "").trim().toLowerCase());
}

function jsonLine(payload) {
  process.stdout.write(`${JSON.stringify(payload)}\n`);
}

function parseLastJsonLine(output) {
  const lines = String(output ?? "").trim().split(/\r?\n/).filter(Boolean);
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    try {
      return JSON.parse(lines[index]);
    } catch {
      // Keep scanning: child failures may print diagnostics before JSON.
    }
  }
  return null;
}

function expiresAtFrom(checkedAt) {
  const date = new Date(checkedAt);
  date.setUTCDate(date.getUTCDate() + 90);
  return date.toISOString();
}

function physicalGateCommand() {
  return "TMWD_CAPTCHA_ASSIST_PHYSICAL=1 TMWD_CAPTCHA_ASSIST_CONFIRM=1 npm run check:captcha-assist-physical-live";
}

function supportsAction(capabilities, action) {
  return Array.isArray(capabilities?.supported_actions) && capabilities.supported_actions.includes(action);
}

function buildPointerNextSteps(capabilities) {
  const requirements = Array.isArray(capabilities?.requirements) ? capabilities.requirements : [];
  if (requirements.length > 0) {
    return [
      "Run npm run check:native-pointer.",
      ...requirements,
    ];
  }
  return [
    "Run npm run check:native-pointer to confirm native click/drag readiness before the physical CAPTCHA gate.",
  ];
}

async function nativePointerPreflight() {
  const capabilities = await detectNativeInputCapabilities({
    refresh: true,
    cache_ttl_ms: 0,
  });
  const clickReady = supportsAction(capabilities, "click");
  const dragReady = supportsAction(capabilities, "drag");
  return {
    ok: clickReady && dragReady,
    status: clickReady && dragReady ? "pointer_ready" : "requirements_missing",
    platform: capabilities.platform ?? process.platform,
    driver: capabilities.driver ?? "unknown",
    supports_click: clickReady,
    supports_drag: dragReady,
    supported_actions: Array.isArray(capabilities.supported_actions) ? capabilities.supported_actions : [],
    unsupported_actions: Array.isArray(capabilities.unsupported_actions) ? capabilities.unsupported_actions : [],
    checks: capabilities.checks ?? {},
    requirements: Array.isArray(capabilities.requirements) ? capabilities.requirements : [],
    permission_notes: Array.isArray(capabilities.permission_notes) ? capabilities.permission_notes : [],
    next_steps: buildPointerNextSteps(capabilities),
  };
}

function buildPhysicalProof(parsed) {
  const checkedAt = new Date().toISOString();
  return {
    type: "captcha_physical_live",
    ok: true,
    platform: process.platform,
    provider_id: parsed.physical_assist_provider_id || "unknown",
    actions: ["drag"],
    checked_at: checkedAt,
    expires_at: expiresAtFrom(checkedAt),
    command: physicalGateCommand(),
    managed_tab_only: true,
    fixture: "local TMWD-owned managed tab",
    slider_completed: parsed.physical_completion?.slider_completed === true,
    fullscreen_screenshot: false,
    js_cdp_widget_click: false,
    secrets_redacted: true,
    evidence: {
      assist_target: "slider",
      coordinate_source: parsed.physical_assist_coordinates_source || "vision_corrected_region_capture",
      provider_selection_reason: parsed.physical_assist_provider_selection_reason || "not_reported",
      vision_correction_status: parsed.vision_correction_status,
      matrix_case_count: Array.isArray(parsed.matrix_results) ? parsed.matrix_results.length : 0,
      finalized_closed: parsed.finalized_closed,
      browser_private_state_access: false,
      wait_after_ms: 5000,
    },
  };
}

async function writePhysicalProof(parsed) {
  if (envDisabled("TMWD_CAPTCHA_ASSIST_WRITE_PROOF")) {
    return {
      written: false,
      reason: "TMWD_CAPTCHA_ASSIST_WRITE_PROOF disabled",
    };
  }
  const proofDir = resolve(process.env.TMWD_OPTIONAL_PROOF_DIR || DEFAULT_OPTIONAL_LIVE_PROOF_DIR);
  await fs.mkdir(proofDir, { recursive: true });
  const proof = buildPhysicalProof(parsed);
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

function runChild(args) {
  return new Promise((resolvePromise) => {
    const child = spawn(process.execPath, [liveSmokePath, ...args], {
      cwd: process.cwd(),
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString("utf8");
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString("utf8");
    });
    child.on("error", (error) => {
      resolvePromise({
        status: 1,
        stdout,
        stderr: `${stderr}${String(error?.message ?? error)}`,
      });
    });
    child.on("close", (status) => {
      resolvePromise({
        status: Number.isFinite(Number(status)) ? Number(status) : 1,
        stdout,
        stderr,
      });
    });
  });
}

async function run() {
  const physicalEnabled = envEnabled("TMWD_CAPTCHA_ASSIST_PHYSICAL");
  const confirmEnabled = envEnabled("TMWD_CAPTCHA_ASSIST_CONFIRM");
  const requirePhysical = envEnabled("TMWD_CAPTCHA_ASSIST_REQUIRE_PHYSICAL");
  if (!physicalEnabled) {
    const payload = {
      ok: !requirePhysical,
      status: "skipped",
      check: "captcha-assist-physical-live",
      reason: "set TMWD_CAPTCHA_ASSIST_PHYSICAL=1 and TMWD_CAPTCHA_ASSIST_CONFIRM=1 to run the local physical drag gate",
      require_physical: requirePhysical,
      planning_gate: "npm run check:captcha-assist-live",
    };
    jsonLine(payload);
    return payload.ok ? 0 : 1;
  }
  if (!confirmEnabled) {
    jsonLine({
      ok: false,
      status: "blocked",
      check: "captcha-assist-physical-live",
      reason: "TMWD_CAPTCHA_ASSIST_CONFIRM=1 is required before physical input",
    });
    return 1;
  }

  const nativePointer = await nativePointerPreflight();
  if (!nativePointer.ok) {
    const payload = {
      ok: !requirePhysical,
      status: requirePhysical ? "blocked" : "skipped",
      check: "captcha-assist-physical-live",
      reason: "native_pointer_requirements_missing",
      require_physical: requirePhysical,
      native_pointer: nativePointer,
      planning_gate: "npm run check:captcha-assist-live",
      readiness_gate: "npm run check:native-pointer",
      gui_fixture_started: false,
      managed_tab_created: false,
      physical_input_attempted: false,
    };
    jsonLine(payload);
    return payload.ok ? 0 : 1;
  }

  const child = await runChild(process.argv.slice(2));
  const parsed = parseLastJsonLine(child.stdout);
  if (child.status !== 0 || parsed?.ok !== true) {
    jsonLine({
      ok: false,
      status: "failed",
      check: "captcha-assist-physical-live",
      child_status: child.status,
      child_result: parsed,
      stderr: child.stderr.trim().slice(0, 4000),
      stdout_tail: child.stdout.trim().split(/\r?\n/).slice(-5),
    });
    return child.status || 1;
  }
  const physicalCompleted = parsed.physical_completion?.slider_completed === true;
  const physicalSucceeded = parsed.physical_assist_status === "success" && physicalCompleted;
  const payload = {
    ok: physicalSucceeded,
    status: physicalSucceeded ? "passed" : "failed",
    check: "captcha-assist-physical-live",
    planning_only: parsed.planning_only,
    physical_assist_status: parsed.physical_assist_status,
    physical_completion: parsed.physical_completion,
    finalized_closed: parsed.finalized_closed,
    matrix_case_count: Array.isArray(parsed.matrix_results) ? parsed.matrix_results.length : 0,
    child_workspace_key: parsed.workspace_key,
    child_tab_id: parsed.tab_id,
  };
  if (physicalSucceeded) {
    try {
      payload.proof = await writePhysicalProof(parsed);
    } catch (error) {
      payload.proof = {
        written: false,
        error: error instanceof Error ? error.message : String(error),
      };
      if (envEnabled("TMWD_CAPTCHA_ASSIST_REQUIRE_PROOF")) {
        payload.ok = false;
        payload.status = "failed";
        payload.reason = "physical proof write failed";
        jsonLine(payload);
        return 1;
      }
    }
  }
  jsonLine(payload);
  return physicalSucceeded ? 0 : 1;
}

process.exitCode = await run();
