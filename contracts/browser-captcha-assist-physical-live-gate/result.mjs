const CHECK_ID = "captcha-assist-physical-live";
const PHYSICAL_GATE_COMMAND = "TMWD_CAPTCHA_ASSIST_PHYSICAL=1 TMWD_CAPTCHA_ASSIST_CONFIRM=1 npm run check:captcha-assist-physical-live";

function noPointerInputFields() {
  return {
    physical_input_attempted: false,
    physical_input_executed: false,
    pointer_moved: false,
    gui_fixture_started: false,
    managed_tab_created: false,
    physical_gate_command: PHYSICAL_GATE_COMMAND,
  };
}

function buildPhysicalDisabledResult(flags) {
  const payload = {
    ok: !flags.require_physical,
    status: "skipped",
    check: CHECK_ID,
    reason: "set TMWD_CAPTCHA_ASSIST_PHYSICAL=1 and TMWD_CAPTCHA_ASSIST_CONFIRM=1 to run the local physical drag/click gate",
    require_physical: flags.require_physical,
    planning_gate: "npm run check:captcha-assist-live",
    ...noPointerInputFields(),
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
      ...noPointerInputFields(),
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
    ...noPointerInputFields(),
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
  const checkboxRequired = parsed.checkbox_physical_required === true
    || parsed.checkbox_physical_completion !== undefined
    || parsed.checkbox_physical_assist_status !== undefined;
  const checkboxCompleted = parsed.checkbox_physical_completion?.checkbox_completed === true
    && parsed.checkbox_physical_completion?.checkbox_click_inside === true;
  const physicalSucceeded = parsed.physical_assist_status === "success"
    && physicalCompleted
    && (!checkboxRequired || checkboxCompleted);
  return {
    ok: physicalSucceeded,
    status: physicalSucceeded ? "passed" : "failed",
    check: CHECK_ID,
    planning_only: parsed.planning_only,
    physical_assist_status: parsed.physical_assist_status,
    physical_completion: parsed.physical_completion,
    physical_attempt_count: parsed.physical_attempt_count,
    physical_attempts: Array.isArray(parsed.physical_attempts)
      ? parsed.physical_attempts.map((attempt) => ({
        attempt: attempt.attempt,
        strategy: attempt.strategy,
        requested: attempt.requested,
        physical_completion: attempt.physical_completion,
      }))
      : undefined,
    checkbox_physical_required: checkboxRequired,
    checkbox_physical_assist_status: parsed.checkbox_physical_assist_status,
    checkbox_physical_completion: parsed.checkbox_physical_completion,
    checkbox_physical_attempt_count: parsed.checkbox_physical_attempt_count,
    checkbox_physical_attempts: Array.isArray(parsed.checkbox_physical_attempts)
      ? parsed.checkbox_physical_attempts.map((attempt) => ({
        attempt: attempt.attempt,
        strategy: attempt.strategy,
        requested: attempt.requested,
        physical_completion: attempt.physical_completion,
      }))
      : undefined,
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
