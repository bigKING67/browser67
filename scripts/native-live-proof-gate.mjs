#!/usr/bin/env node

import { promises as fs } from "node:fs";
import os from "node:os";
import { basename, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { nativePointerPreflight } from "../contracts/browser-captcha-assist-physical-live-gate/pointer-preflight.mjs";
import { runPhysicalLiveGate } from "../contracts/browser-captcha-assist-physical-live-gate/runner.mjs";
import {
  DEFAULT_OPTIONAL_LIVE_PROOF_DIR,
} from "./optional-live-proof-audit.mjs";
import { buildOptionalLiveProofRecord } from "./optional-live-proof-record.mjs";

const CHECK_ID = "native-live-proof-gate";
const DEFAULT_PHYSICAL_CHILD_TIMEOUT_MS = 60_000;
const SUPPORTED_PROOF_IDS = new Map([
  ["linux", "native-live-linux"],
  ["win32", "native-live-win32"],
]);
const ENABLED_VALUES = new Set(["1", "true", "yes", "on"]);
const CHILD_VALUE_OPTIONS = new Set([
  "--timeout-ms",
  "--tmwd-mode",
  "--tmwd-transport",
  "--tmwd-ws-endpoint",
  "--tmwd-link-endpoint",
  "--cdp-endpoint",
]);

function envEnabled(env, name) {
  return ENABLED_VALUES.has(String(env?.[name] ?? "").trim().toLowerCase());
}

function parseArgs(argv) {
  const parsed = {
    child_args: [],
    json: false,
    proof_dir: process.env.TMWD_OPTIONAL_PROOF_DIR || DEFAULT_OPTIONAL_LIVE_PROOF_DIR,
    replace: false,
    require_physical: false,
    write: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index] ?? "";
    if (token === "--json") {
      parsed.json = true;
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
    if (token === "--replace") {
      parsed.replace = true;
      continue;
    }
    if (token === "--require-physical") {
      parsed.require_physical = true;
      continue;
    }
    if (token === "--write") {
      parsed.write = true;
      continue;
    }
    if (CHILD_VALUE_OPTIONS.has(token)) {
      const value = String(argv[index + 1] ?? "").trim();
      if (!value || value.startsWith("--")) {
        throw new Error(`${token} requires a value`);
      }
      parsed.child_args.push(token, value);
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
  if (parsed.replace && !parsed.write) {
    throw new Error("--replace requires --write");
  }
  parsed.proof_dir = resolve(parsed.proof_dir);
  return parsed;
}

function proofIdForPlatform(platform) {
  return SUPPORTED_PROOF_IDS.get(platform);
}

function nativeLiveCommand(platform) {
  if (platform === "win32") {
    return '$env:TMWD_NATIVE_LIVE_PHYSICAL="1"; $env:TMWD_NATIVE_LIVE_CONFIRM="1"; npm run proof:native-live -- --write';
  }
  return "TMWD_NATIVE_LIVE_PHYSICAL=1 TMWD_NATIVE_LIVE_CONFIRM=1 npm run proof:native-live -- --write";
}

function physicalChildArgs(childArgs = []) {
  if (childArgs.includes("--timeout-ms")) {
    return [...childArgs];
  }
  return ["--timeout-ms", String(DEFAULT_PHYSICAL_CHILD_TIMEOUT_MS), ...childArgs];
}

function expiresAtFrom(checkedAt) {
  const expiresAt = new Date(checkedAt);
  expiresAt.setUTCDate(expiresAt.getUTCDate() + 90);
  return expiresAt.toISOString();
}

function finitePositive(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric > 0;
}

function buildNativeLiveProof(parsed, options = {}) {
  const platform = options.platform ?? process.platform;
  const proofId = proofIdForPlatform(platform);
  if (!proofId) {
    throw new Error(`native live proof is unsupported on platform=${platform}`);
  }
  if (parsed?.physical_assist_provider_id !== "native-os") {
    throw new Error("native live proof requires native-os drag provider");
  }
  if (parsed?.checkbox_physical_assist_provider_id !== "native-os") {
    throw new Error("native live proof requires native-os click provider");
  }
  if (parsed?.physical_completion?.slider_completed !== true) {
    throw new Error("native live proof requires completed drag fixture");
  }
  if (
    parsed?.checkbox_physical_completion?.checkbox_completed !== true
    || parsed?.checkbox_physical_completion?.checkbox_click_inside !== true
  ) {
    throw new Error("native live proof requires completed inside-hotspot click fixture");
  }
  const windowRect = parsed?.native_live_window_rect;
  if (
    windowRect?.status !== "success"
    || !finitePositive(windowRect.width)
    || !finitePositive(windowRect.height)
  ) {
    throw new Error("native live proof requires a successful positive-size get_window_rect result");
  }

  const checkedAt = options.checked_at ?? new Date().toISOString();
  return {
    type: "native_live",
    ok: true,
    platform,
    provider_id: "native-os",
    actions: ["get_window_rect", "click", "drag"],
    checked_at: checkedAt,
    expires_at: options.expires_at ?? expiresAtFrom(checkedAt),
    command: nativeLiveCommand(platform),
    evidence: {
      fixture: "local browser67-owned managed tab",
      managed_tab_only: true,
      fullscreen_screenshot: false,
      secrets_redacted: true,
      window_rect_verified: true,
      window_rect_driver: String(windowRect.driver ?? "native-os"),
      window_rect_dimensions_positive: true,
      drag_completed: true,
      click_completed: true,
      visible_completion_verified: true,
      browser_private_state_access: false,
      finalized_managed_tabs_closed: Number(parsed?.finalized_closed ?? 0) > 0,
    },
  };
}

async function pathExists(path) {
  try {
    await fs.stat(path);
    return true;
  } catch (error) {
    if (error?.code === "ENOENT") {
      return false;
    }
    throw error;
  }
}

async function recordNativeLiveProof(proof, options = {}) {
  const platform = options.platform ?? proof.platform;
  const id = proofIdForPlatform(platform);
  if (!id) {
    throw new Error(`native live proof is unsupported on platform=${platform}`);
  }
  const tempDir = await fs.mkdtemp(join(os.tmpdir(), "browser67-native-live-proof-"));
  const inputPath = join(tempDir, `${id}.json`);
  try {
    await fs.writeFile(inputPath, `${JSON.stringify(proof, null, 2)}\n`, { mode: 0o600 });
    const recordBuilder = options.buildOptionalLiveProofRecord ?? buildOptionalLiveProofRecord;
    return await recordBuilder({
      id,
      from_json: inputPath,
      proof_dir: options.proof_dir,
      replace: options.replace === true,
      write: options.write === true,
    });
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
  }
}

function noPhysicalInputFields() {
  return {
    physical_input_attempted: false,
    physical_input_executed: false,
    pointer_moved: false,
    gui_fixture_started: false,
    managed_tab_created: false,
  };
}

function blockedResult(reason, details = {}) {
  return {
    exitCode: 1,
    payload: {
      ok: false,
      status: "blocked",
      check: CHECK_ID,
      reason,
      ...noPhysicalInputFields(),
      ...details,
    },
  };
}

function readinessResult({ args, nativePointer, platform, proofId }) {
  const ready = nativePointer?.ok === true;
  return {
    exitCode: 0,
    payload: {
      ok: true,
      status: ready ? "ready_for_explicit_opt_in" : "blocked_by_native_pointer",
      check: CHECK_ID,
      platform,
      proof_id: proofId,
      proof_dir: args.proof_dir,
      native_pointer: nativePointer,
      next_command: ready ? nativeLiveCommand(platform) : "npm run check:native-pointer",
      safe_default: "diagnostic_only_no_pointer_input",
      ...noPhysicalInputFields(),
    },
  };
}

function compactProofRecord(record, proof) {
  return {
    written: record.written === true,
    id: record.id,
    path: record.target_path,
    sha256: record.output?.sha256,
    expires_at: proof.expires_at,
    validation: record.validation,
    redaction_checklist: record.redaction_checklist,
  };
}

async function runNativeLiveProofGate(options = {}) {
  const argv = options.argv ?? process.argv.slice(2);
  const env = options.env ?? process.env;
  const args = options.args ?? parseArgs(argv);
  const platform = options.platform ?? process.platform;
  const proofId = proofIdForPlatform(platform);
  const physicalEnabled = envEnabled(env, "TMWD_NATIVE_LIVE_PHYSICAL");
  const confirmEnabled = envEnabled(env, "TMWD_NATIVE_LIVE_CONFIRM");

  if (!proofId) {
    if (physicalEnabled || args.require_physical || args.write) {
      return blockedResult("native_live_target_platform_required", {
        platform,
        supported_platforms: [...SUPPORTED_PROOF_IDS.keys()],
      });
    }
    return {
      exitCode: 0,
      payload: {
        ok: true,
        status: "not_applicable",
        check: CHECK_ID,
        platform,
        supported_platforms: [...SUPPORTED_PROOF_IDS.keys()],
        safe_default: "diagnostic_only_no_pointer_input",
        ...noPhysicalInputFields(),
      },
    };
  }

  if (!physicalEnabled) {
    if (args.require_physical || args.write) {
      return blockedResult("set TMWD_NATIVE_LIVE_PHYSICAL=1 and TMWD_NATIVE_LIVE_CONFIRM=1 to run the target-OS native live proof", {
        platform,
        proof_id: proofId,
        next_command: nativeLiveCommand(platform),
      });
    }
    const pointerPreflight = options.nativePointerPreflight ?? nativePointerPreflight;
    const nativePointer = await pointerPreflight({
      platform,
      missing_message: "Run npm run check:native-pointer before the target-OS native live proof gate.",
    });
    return readinessResult({ args, nativePointer, platform, proofId });
  }

  if (!confirmEnabled) {
    return blockedResult("TMWD_NATIVE_LIVE_CONFIRM=1 is required before physical input", {
      platform,
      proof_id: proofId,
    });
  }
  if (!args.write) {
    return blockedResult("--write is required before running the physical native live proof", {
      platform,
      proof_id: proofId,
      next_command: nativeLiveCommand(platform),
    });
  }

  const targetPath = join(args.proof_dir, `${proofId}.json`);
  const exists = options.pathExists ?? pathExists;
  if (!args.replace && await exists(targetPath)) {
    return blockedResult("native_live_proof_already_exists", {
      platform,
      proof_id: proofId,
      target_path: targetPath,
      replace_command: `${nativeLiveCommand(platform)} --replace`,
    });
  }

  const pointerPreflight = options.nativePointerPreflight ?? nativePointerPreflight;
  const nativePointer = await pointerPreflight({
    platform,
    missing_message: "Run npm run check:native-pointer before the target-OS native live proof gate.",
  });
  if (nativePointer?.ok !== true) {
    return blockedResult("native_pointer_requirements_missing", {
      platform,
      proof_id: proofId,
      native_pointer: nativePointer,
      next_command: "npm run check:native-pointer",
    });
  }

  const physicalRunner = options.runPhysicalLiveGate ?? runPhysicalLiveGate;
  const physicalEnv = {
    ...env,
    TMWD_CAPTCHA_ASSIST_PHYSICAL: "1",
    TMWD_CAPTCHA_ASSIST_CONFIRM: "1",
    TMWD_CAPTCHA_ASSIST_REQUIRE_PHYSICAL: "1",
    TMWD_CAPTCHA_ASSIST_REQUIRE_PROOF: "1",
    TMWD_NATIVE_LIVE_PROOF: "1",
  };
  const physicalResult = await physicalRunner({
    argv: physicalChildArgs(args.child_args),
    cwd: options.cwd ?? process.cwd(),
    env: physicalEnv,
    platform,
    nativePointerPreflight: async () => nativePointer,
    runChild: options.runChild,
    writePhysicalProof: async (parsed) => {
      const proof = buildNativeLiveProof(parsed, {
        platform,
        checked_at: options.checked_at,
        expires_at: options.expires_at,
      });
      const record = await recordNativeLiveProof(proof, {
        platform,
        proof_dir: args.proof_dir,
        replace: args.replace,
        write: true,
        buildOptionalLiveProofRecord: options.buildOptionalLiveProofRecord,
      });
      if (record.ok !== true || record.written !== true) {
        throw new Error(record.error || `native live proof record failed status=${record.status}`);
      }
      return compactProofRecord(record, proof);
    },
  });

  const passed = physicalResult?.payload?.ok === true && physicalResult?.exitCode === 0;
  const childPayload = physicalResult?.payload?.child_result;
  const physicalInputObserved = Boolean(passed
    || physicalResult?.payload?.physical_assist_status === "success"
    || physicalResult?.payload?.checkbox_physical_assist_status === "success"
    || childPayload?.physical_assist_status === "success"
    || childPayload?.checkbox_physical_assist_status === "success");
  const managedTabCreated = Boolean(
    physicalResult?.payload?.child_tab_id
    || childPayload?.tab_id,
  );
  return {
    exitCode: physicalResult?.exitCode ?? 1,
    payload: {
      ...physicalResult?.payload,
      ok: passed,
      check: CHECK_ID,
      platform,
      proof_id: proofId,
      proof_dir: args.proof_dir,
      native_pointer: nativePointer,
      physical_input_attempted: true,
      physical_input_executed: physicalInputObserved ? true : null,
      pointer_moved: physicalInputObserved ? true : null,
      gui_fixture_started: true,
      managed_tab_created: managedTabCreated,
    },
  };
}

function outputText(payload) {
  process.stdout.write(
    `native_live_proof_gate=${payload.status} platform=${payload.platform} proof_id=${payload.proof_id ?? "none"} physical_input_executed=${payload.physical_input_executed}\n`,
  );
  if (payload.reason) {
    process.stdout.write(`reason=${payload.reason}\n`);
  }
  if (payload.next_command) {
    process.stdout.write(`next=${payload.next_command}\n`);
  }
  if (payload.proof?.path) {
    process.stdout.write(`proof=${payload.proof.path}\n`);
    process.stdout.write(`proof_sha256=${payload.proof.sha256}\n`);
  }
}

async function runCommand(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  const result = await runNativeLiveProofGate({ args, argv, env: process.env });
  if (args.json) {
    process.stdout.write(`${JSON.stringify(result.payload)}\n`);
  } else {
    outputText(result.payload);
  }
  process.exitCode = result.exitCode;
  return result;
}

if (import.meta.url === pathToFileURL(process.argv[1] || "").href) {
  try {
    await runCommand();
  } catch (error) {
    const file = basename(process.argv[1] || "native-live-proof-gate.mjs");
    process.stderr.write(`${file} failed: ${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}

export {
  CHECK_ID,
  DEFAULT_PHYSICAL_CHILD_TIMEOUT_MS,
  buildNativeLiveProof,
  nativeLiveCommand,
  parseArgs,
  physicalChildArgs,
  proofIdForPlatform,
  recordNativeLiveProof,
  runCommand,
  runNativeLiveProofGate,
};
