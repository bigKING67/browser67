#!/usr/bin/env node

import assert from "node:assert/strict";

import {
  assessExtensionDrift,
  assessSyncPermission,
  compareFileInventories,
} from "../scripts/sync-genericagent-extension.mjs";

assert.deepEqual(compareFileInventories(
  [
    { path: "background.js", sha256: "upstream-background" },
    { path: "content.js", sha256: "upstream-content" },
  ],
  [
    { path: "background.js", sha256: "local-background" },
    { path: "local-only.js", sha256: "local-only" },
  ],
), {
  added: ["content.js"],
  removed: ["local-only.js"],
  changed: ["background.js"],
});

const review = {
  decision: {
    direct_sync_allowed: false,
  },
  extension_review: {
    changed_files: ["content.js", "disable_dialogs.js", "manifest.json"],
    reviewed_source_files: [
      { path: "content.js", sha256: "content-reviewed" },
      { path: "disable_dialogs.js", sha256: "dialogs-reviewed" },
      { path: "manifest.json", sha256: "manifest-reviewed" },
    ],
    per_file_decision: [
      { file: "content.js", action: "keep_local_bridge", risk: "medium" },
      { file: "disable_dialogs.js", action: "keep_local_no_behavior_change", risk: "none" },
      { file: "manifest.json", action: "keep_local_config_bootstrap", risk: "medium" },
    ],
  },
};

const aligned = assessExtensionDrift({
  ok: true,
  added: [],
  removed: [],
  changed: [],
  source_files: [],
}, review);
assert.equal(aligned.ok, true);
assert.equal(aligned.status, "aligned");
assert.deepEqual(assessSyncPermission(aligned), {
  allowed: true,
  forced: false,
  reason: "already_aligned",
});

const reviewed = assessExtensionDrift({
  ok: false,
  added: [],
  removed: [],
  changed: ["content.js", "disable_dialogs.js", "manifest.json"],
  source_files: [
    { path: "content.js", sha256: "content-reviewed" },
    { path: "disable_dialogs.js", sha256: "dialogs-reviewed" },
    { path: "manifest.json", sha256: "manifest-reviewed" },
  ],
}, review);
assert.equal(reviewed.ok, true);
assert.equal(reviewed.status, "reviewed_divergence");
assert.equal(reviewed.reviewed_divergence, true);
assert.deepEqual(reviewed.unresolved_files, []);
assert.equal(assessSyncPermission(reviewed).allowed, false);
assert.deepEqual(assessSyncPermission(reviewed, { forceReviewedSync: true }), {
  allowed: true,
  forced: true,
  reason: "explicit_force_reviewed_sync",
});

const strict = assessExtensionDrift({
  ok: false,
  added: [],
  removed: [],
  changed: ["content.js"],
  source_files: [
    { path: "content.js", sha256: "content-reviewed" },
  ],
}, review, { strict: true });
assert.equal(strict.ok, false);
assert.equal(strict.status, "reviewed_divergence");

const unreviewed = assessExtensionDrift({
  ok: false,
  added: ["new-upstream-file.js"],
  removed: [],
  changed: ["content.js"],
  source_files: [
    { path: "content.js", sha256: "content-reviewed" },
    { path: "new-upstream-file.js", sha256: "new-unreviewed" },
  ],
}, review);
assert.equal(unreviewed.ok, false);
assert.equal(unreviewed.status, "unreviewed_drift");
assert.deepEqual(unreviewed.unresolved_files, ["new-upstream-file.js"]);
assert.equal(assessSyncPermission(unreviewed).reason, "unreviewed_drift_requires_explicit_force");

const hashMismatch = assessExtensionDrift({
  ok: false,
  added: [],
  removed: [],
  changed: ["content.js"],
  source_files: [
    { path: "content.js", sha256: "content-not-reviewed" },
  ],
}, review);
assert.equal(hashMismatch.ok, false);
assert.equal(hashMismatch.status, "unreviewed_drift");
assert.deepEqual(hashMismatch.unresolved_files, ["content.js"]);

const directReview = structuredClone(review);
directReview.decision.direct_sync_allowed = true;
const direct = assessExtensionDrift({
  ok: false,
  added: [],
  removed: [],
  changed: ["content.js"],
  source_files: [
    { path: "content.js", sha256: "content-reviewed" },
  ],
}, directReview);
assert.equal(direct.ok, false);
assert.deepEqual(assessSyncPermission(direct), {
  allowed: true,
  forced: false,
  reason: "review_ledger_allows_direct_sync",
});

process.stdout.write(`${JSON.stringify({
  ok: true,
  check: "extension-upstream-sync-contract",
  scenarios: [
    "reviewed-source-inventory",
    "aligned",
    "reviewed-divergence",
    "strict-byte-alignment",
    "unreviewed-drift",
    "reviewed-file-hash-mismatch",
    "explicit-reviewed-sync",
    "direct-sync-allowed",
  ],
})}\n`);
