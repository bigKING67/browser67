import assert from "node:assert/strict";

import { firstOutcomeContent } from "../browser67-browser-mcp-contract/rpc-content.mjs";

function jsReverseOutcome(result, label) {
  const outcome = firstOutcomeContent(result);
  assert.equal(outcome?.schema, "browser67.tool-outcome.v3", `${label} outcome schema`);
  assert.equal(typeof outcome?.ok, "boolean", `${label} outcome ok`);
  assert.equal(["completed", "partial", "failed"].includes(outcome?.status), true, `${label} outcome status`);
  return outcome;
}

function jsReverseData(result, label) {
  const outcome = jsReverseOutcome(result, label);
  assert.equal(outcome.ok, true, `${label} should complete`);
  return outcome.data;
}

export {
  jsReverseData,
  jsReverseOutcome,
};
