const CHECK_ID = "captcha-assist-physical-live";

function buildPhysicalDisabledResult(flags) {
  const payload = {
    ok: !flags.require_physical,
    status: "skipped",
    check: CHECK_ID,
    reason: "set TMWD_CAPTCHA_ASSIST_PHYSICAL=1 and TMWD_CAPTCHA_ASSIST_CONFIRM=1 to run the local physical drag gate",
    require_physical: flags.require_physical,
    planning_gate: "npm run check:captcha-assist-live",
  };
  return {
    exitCode: payload.ok ? 0 : 1,
    payload,
  };
}

function buildConfirmMissingResult() {
  return {
    exitCode: 1,
    payload: {
      ok: false,
      status: "blocked",
      check: CHECK_ID,
      reason: "TMWD_CAPTCHA_ASSIST_CONFIRM=1 is required before physical input",
    },
  };
}

function buildNativePointerMissingResult(nativePointer, flags) {
  const payload = {
    ok: !flags.require_physical,
    status: flags.require_physical ? "blocked" : "skipped",
    check: CHECK_ID,
    reason: "native_pointer_requirements_missing",
    require_physical: flags.require_physical,
    native_pointer: nativePointer,
    planning_gate: "npm run check:captcha-assist-live",
    readiness_gate: "npm run check:native-pointer",
    gui_fixture_started: false,
    managed_tab_created: false,
    physical_input_attempted: false,
  };
  return {
    exitCode: payload.ok ? 0 : 1,
    payload,
  };
}

function buildChildFailureResult(child, parsed) {
  return {
    exitCode: child.status || 1,
    payload: {
      ok: false,
      status: "failed",
      check: CHECK_ID,
      child_status: child.status,
      child_result: parsed,
      stderr: String(child.stderr ?? "").trim().slice(0, 4000),
      stdout_tail: String(child.stdout ?? "").trim().split(/\r?\n/).slice(-5),
    },
  };
}

function buildPhysicalResultPayload(parsed) {
  const physicalCompleted = parsed.physical_completion?.slider_completed === true;
  const physicalSucceeded = parsed.physical_assist_status === "success" && physicalCompleted;
  return {
    ok: physicalSucceeded,
    status: physicalSucceeded ? "passed" : "failed",
    check: CHECK_ID,
    planning_only: parsed.planning_only,
    physical_assist_status: parsed.physical_assist_status,
    physical_completion: parsed.physical_completion,
    finalized_closed: parsed.finalized_closed,
    matrix_case_count: Array.isArray(parsed.matrix_results) ? parsed.matrix_results.length : 0,
    child_workspace_key: parsed.workspace_key,
    child_tab_id: parsed.tab_id,
  };
}

function buildPhysicalResult(parsed) {
  const payload = buildPhysicalResultPayload(parsed);
  return {
    exitCode: payload.ok ? 0 : 1,
    payload,
  };
}

function attachProofFailure(payload, error) {
  payload.proof = {
    written: false,
    error: error instanceof Error ? error.message : String(error),
  };
  payload.ok = false;
  payload.status = "failed";
  payload.reason = "physical proof write failed";
  return {
    exitCode: 1,
    payload,
  };
}

export {
  CHECK_ID,
  attachProofFailure,
  buildChildFailureResult,
  buildConfirmMissingResult,
  buildNativePointerMissingResult,
  buildPhysicalDisabledResult,
  buildPhysicalResult,
  buildPhysicalResultPayload,
};
