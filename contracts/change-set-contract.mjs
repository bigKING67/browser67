#!/usr/bin/env node

import assert from "node:assert/strict";

import {
  buildChangeSetReport,
  classifyPath,
} from "../scripts/change-set-lib.mjs";

const tombstones = [
  "src/codex-host-finalizer.mjs",
  "src/codex-host-finalizer/payloads.mjs",
  "contracts/codex-host-finalizer-contract.mjs",
];

for (const path of tombstones) {
  assert.equal(classifyPath(path), "codex_host_finalizer_removal", path);
}

const unknownDeletion = {
  status: " D",
  path: "src/unknown-deleted-module.mjs",
};
assert.equal(classifyPath(unknownDeletion.path), "ungrouped");

const report = buildChangeSetReport([
  ...tombstones.map((path) => ({ status: " D", path })),
  unknownDeletion,
]);
assert.equal(report.ok, false);
assert.equal(report.changed_paths_count, 4);
assert.equal(report.grouped_paths_count, 3);
assert.equal(report.ungrouped_paths_count, 1);
assert.deepEqual(report.ungrouped.paths, [unknownDeletion]);

const screenshotPaths = [
  "src/browser-screenshot/transport.mjs",
  "src/server/browser-core/screenshot.mjs",
  "contracts/browser-screenshot-live-smoke.mjs",
  "contracts/screenshot-stability-contract.mjs",
  "scripts/screenshot-stability.mjs",
];
for (const path of screenshotPaths) {
  assert.equal(classifyPath(path), "screenshot_runtime", path);
}
assert.equal(classifyPath(".review-craft.json"), "browser67_identity_package");

process.stdout.write(`${JSON.stringify({
  ok: true,
  check: "change-set-contract",
  scenarios: [
    "exact-finalizer-tombstones",
    "unknown-deletion-ungrouped",
    "screenshot-runtime-closure",
    "review-craft-project-config",
  ],
})}\n`);
