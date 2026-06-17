import assert from "node:assert/strict";

import { assertNoSecretLeak, commonArgs } from "./helpers.mjs";

async function runUnknownOriginCase({ callTool, cli }) {
  const unknownDryRun = await callTool("browser_auth_ops", {
    ...commonArgs(cli),
    action: "ensure_login",
    url: "http://unknown.example/login",
    dry_run: true,
  });
  assert.equal(unknownDryRun.status, "blocked");
  assert.equal(unknownDryRun.reason, "no_matching_login_profile");
  assertNoSecretLeak(unknownDryRun, "unknown dry-run auth result");
  return {
    unknownDryRun,
  };
}

export {
  runUnknownOriginCase,
};
