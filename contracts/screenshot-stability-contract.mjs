#!/usr/bin/env node

import assert from "node:assert/strict";

import {
  assessPayload,
  parseArgs,
  parsePayload,
  runScreenshotStability,
} from "../scripts/screenshot-stability.mjs";

const validPayload = {
  ok: true,
  background_visibility_state: "hidden",
  debugger_timeout_cleanup_verified: true,
  viewport_restored_after_mobile_capture: true,
  finalized_status: "success",
};

assert.deepEqual(parseArgs([]), {
  iterations: 3,
  child_timeout_ms: 120_000,
  child_args: ["--tmwd-mode", "tmwd", "--tmwd-transport", "auto"],
  help: false,
});
assert.deepEqual(parseArgs(["--iterations", "4", "--", "--tmwd-transport", "ws"]), {
  iterations: 4,
  child_timeout_ms: 120_000,
  child_args: ["--tmwd-transport", "ws"],
  help: false,
});
assert.throws(() => parseArgs(["--iterations", "2"]), /between 3 and 10/);
assert.throws(
  () => runScreenshotStability({ iterations: 1, spawn_run: () => null }),
  /between 3 and 10/,
);
assert.throws(() => parseArgs(["--unknown"]), /unknown argument/);
assert.deepEqual(parsePayload(JSON.stringify(validPayload)), validPayload);
assert.throws(() => parsePayload(""), /empty stdout/);
assert.throws(() => parsePayload("[]"), /one JSON object/);
assert.deepEqual(assessPayload(validPayload), []);
assert.deepEqual(
  assessPayload({ ...validPayload, background_visibility_state: "visible" }),
  ["default_lifecycle_not_hidden"],
);
assert.deepEqual(
  assessPayload({ ...validPayload, debugger_timeout_cleanup_verified: false }),
  ["timeout_cleanup_not_verified"],
);
assert.deepEqual(
  assessPayload({ ...validPayload, viewport_restored_after_mobile_capture: false }),
  ["viewport_not_restored"],
);
assert.deepEqual(
  assessPayload({ ...validPayload, finalized_status: "failed" }),
  ["managed_scope_not_finalized"],
);

const successful = runScreenshotStability({
  iterations: 3,
  child_timeout_ms: 10_000,
  child_args: ["--fixture"],
  spawn_run: () => ({ status: 0, signal: null, stdout: JSON.stringify(validPayload) }),
});
assert.equal(successful.ok, true);
assert.equal(successful.required_iterations, 3);
assert.equal(successful.passed_iterations, 3);
assert.equal(successful.failed_iterations, 0);
assert.equal(successful.no_retry_masking, true);
assert.deepEqual(successful.results.map((result) => result.ok), [true, true, true]);

let invocation = 0;
const mixed = runScreenshotStability({
  iterations: 3,
  child_timeout_ms: 10_000,
  spawn_run: () => {
    invocation += 1;
    if (invocation === 2) {
      return { status: 1, signal: null, stdout: "" };
    }
    return { status: 0, signal: null, stdout: JSON.stringify(validPayload) };
  },
});
assert.equal(mixed.ok, false);
assert.equal(mixed.passed_iterations, 2);
assert.equal(mixed.failed_iterations, 1);
assert.deepEqual(mixed.results.map((result) => result.ok), [true, false, true]);
assert.deepEqual(mixed.results[1].failures, ["process_exit:1"]);

process.stdout.write(`${JSON.stringify({
  ok: true,
  check: "screenshot-stability-contract",
  scenarios: [
    "three-independent-successes",
    "minimum-three-cannot-be-weakened",
    "middle-failure-preserved",
    "default-hidden-required",
    "cleanup-and-restoration-required",
  ],
})}\n`);
