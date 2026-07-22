#!/usr/bin/env node

import assert from "node:assert/strict";

import {
  preferredTmwdTransportOrder,
  recordTmwdTransportResult,
  resetTmwdTransportHealth,
  tmwdTransportHealthSnapshot,
} from "../src/tmwd-runtime/health.mjs";

function run() {
  const args = {
    tmwd_ws_endpoint: "ws://127.0.0.1:18765",
    tmwd_link_endpoint: "http://127.0.0.1:18766/link",
  };
  resetTmwdTransportHealth();
  assert.deepEqual(preferredTmwdTransportOrder(args).map((item) => item.transport), ["ws", "link"]);

  recordTmwdTransportResult(args, "ws", false, { error: "contract ws failure" });
  const afterWsFailure = preferredTmwdTransportOrder(args);
  assert.equal(afterWsFailure[0].transport, "link");
  assert.equal(afterWsFailure[1].health.backed_off, true);
  assert.equal(tmwdTransportHealthSnapshot(args, "ws").consecutive_failures, 1);

  recordTmwdTransportResult(args, "link", true);
  assert.equal(preferredTmwdTransportOrder(args)[0].transport, "link");
  recordTmwdTransportResult(args, "ws", true);
  const recovered = preferredTmwdTransportOrder(args);
  assert.equal(recovered[0].transport, "ws");
  assert.equal(recovered[0].reason, "last_known_good");
  assert.equal(tmwdTransportHealthSnapshot(args, "ws").backed_off, false);

  resetTmwdTransportHealth();
  process.stdout.write(`${JSON.stringify({
    ok: true,
    check: "tmwd-transport-health-contract",
    default_order: ["ws", "link"],
    failure_backoff: true,
    last_known_good: true,
    recovery: true,
  })}\n`);
}

try {
  run();
} catch (error) {
  resetTmwdTransportHealth();
  process.stderr.write(`tmwd-transport-health-contract failed: ${error?.stack || String(error)}\n`);
  process.exitCode = 1;
}
