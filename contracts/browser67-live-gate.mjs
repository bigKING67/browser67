#!/usr/bin/env node
import { buildLiveArgs } from "./browser67-live-gate/args.mjs";
import {
  parseLastJsonLine,
  runNodeScript,
} from "./browser67-live-gate/child-process.mjs";
import { parseArgs } from "./browser67-live-gate/cli.mjs";
import {
  doctorHints,
  ensureTmwdHub,
  runDoctorContract,
  shouldAttemptEnsureTmwdHub,
  shouldWaitForSessionReady,
  waitForSessionReady,
} from "./browser67-live-gate/doctor-flow.mjs";
import { emitAndReturn } from "./browser67-live-gate/event-log.mjs";
import { liveContractPath } from "./browser67-live-gate/paths.mjs";

async function run() {
  const config = parseArgs(process.argv.slice(2));

  let doctorPayload = runDoctorContract(config);
  let ensureTmwdHubState = {
    attempted: false,
    enabled: config.ensure_tmwd_hub === true,
    reason: "not_needed",
  };
  let sessionReadyWaitState = {
    attempted: false,
    wait_ms: config.session_ready_wait_ms,
    reason: "not_needed",
  };

  if (doctorPayload.ok !== true && shouldAttemptEnsureTmwdHub(config, doctorPayload)) {
    const ensured = await ensureTmwdHub(config, doctorPayload);
    ensureTmwdHubState = ensured.ensureState;
    doctorPayload = ensured.doctorPayloadAfter;
  }
  if (doctorPayload.ok !== true && shouldWaitForSessionReady(config, doctorPayload)) {
    const waited = await waitForSessionReady(config, doctorPayload);
    sessionReadyWaitState = waited.waitState;
    doctorPayload = waited.doctorPayloadAfter;
  }

  if (config.doctor_only) {
    emitAndReturn(config, {
      ok: doctorPayload.ok === true,
      stage: "doctor_only",
      doctor: doctorPayload,
      ensure_tmwd_hub: ensureTmwdHubState,
      session_wait: sessionReadyWaitState,
    });
    return;
  }

  if (doctorPayload.ok !== true && !config.force_live) {
    emitAndReturn(config, {
      ok: false,
      stage: "doctor_blocked",
      doctor: doctorPayload,
      ensure_tmwd_hub: ensureTmwdHubState,
      session_wait: sessionReadyWaitState,
      hints: doctorHints(config, doctorPayload),
    });
    return;
  }

  const liveResult = runNodeScript(liveContractPath, buildLiveArgs(config));
  if (liveResult.error) {
    throw liveResult.error;
  }
  const livePayload = parseLastJsonLine(liveResult.stdout);
  const liveOk = liveResult.status === 0
    && livePayload
    && typeof livePayload === "object"
    && livePayload.ok === true;

  if (!liveOk) {
    emitAndReturn(config, {
      ok: false,
      stage: "live_failed",
      doctor: doctorPayload,
      ensure_tmwd_hub: ensureTmwdHubState,
      session_wait: sessionReadyWaitState,
      live_exit_code: liveResult.status,
      live_payload: livePayload,
      live_stdout: String(liveResult.stdout ?? "").trim(),
      live_stderr: String(liveResult.stderr ?? "").trim(),
      hints: doctorHints(config, doctorPayload),
    });
    return;
  }

  emitAndReturn(config, {
    ok: true,
    stage: "live_passed",
    doctor: doctorPayload,
    ensure_tmwd_hub: ensureTmwdHubState,
    session_wait: sessionReadyWaitState,
    live: livePayload,
  });
}

try {
  await run();
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`browser67-live-gate failed: ${message}\n`);
  process.exitCode = 1;
}
