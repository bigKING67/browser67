#!/usr/bin/env node

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";

import { validateSchemaValue } from "./browser-doctor-json-schema-contract/schema-validator.mjs";

const repoRoot = path.resolve(import.meta.dirname, "..");
const schemaPath = path.resolve(repoRoot, "docs", "schemas", "upstream-review.schema.json");
const reviewPath = path.resolve(repoRoot, "UPSTREAM.review.json");

const ALLOWED_MERGE_MODES = [
  "manual_merge_preserve_local_bridge_features",
  "no_extension_changes",
  "no_behavior_changes_keep_local",
  "selective_cherry_pick",
];

const REQUIRED_REVIEWED_FILES = [
  "background.js",
  "disable_dialogs.js",
];

const REQUIRED_BACKGROUND_FEATURES = [
  "handle_tabs_dispatch",
  "tabs_get",
  "tabs_close",
  "include_unscriptable",
  "unsupported_tabs_method",
  "batch_uses_handle_tabs",
  "numeric_tab_id_validation",
  "cookies_tabid_validation",
  "cdp_tabid_validation",
  "ws_exec_tabid_validation",
];

function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function readJson(filePath) {
  return JSON.parse(await readFile(filePath, "utf8"));
}

function assertStringArrayIncludesAll(value, required, label) {
  assert.equal(Array.isArray(value), true, `${label} must be an array`);
  for (const item of required) {
    assert.ok(value.includes(item), `${label} must include ${item}`);
  }
}

function assertReviewLedgerSemantics(review) {
  assert.equal(review.schema_version, 1);
  assert.ok(isRecord(review.upstream), "upstream must be an object");
  assert.equal(review.upstream.name, "lsdefine/GenericAgent");
  assert.ok(
    /^[0-9a-f]{40}$/i.test(String(review.upstream.reviewed_commit ?? "")),
    "upstream.reviewed_commit must be a 40 character hex commit",
  );
  assert.match(review.upstream.reviewed_at, /^\d{4}-\d{2}-\d{2}$/);

  assert.ok(isRecord(review.decision), "decision must be an object");
  assert.ok(
    ALLOWED_MERGE_MODES.includes(review.decision.extension_merge_mode),
    `unsupported extension_merge_mode: ${String(review.decision.extension_merge_mode)}`,
  );
  assert.equal(typeof review.decision.direct_sync_allowed, "boolean");
  if (review.decision.direct_sync_allowed === false) {
    assert.equal(typeof review.decision.reason, "string");
    assert.ok(review.decision.reason.trim().length > 0, "decision.reason is required when direct_sync_allowed=false");
  }

  assert.ok(isRecord(review.extension_review), "extension_review must be an object");
  assertStringArrayIncludesAll(
    review.extension_review.changed_files,
    REQUIRED_REVIEWED_FILES,
    "extension_review.changed_files",
  );
  assertStringArrayIncludesAll(
    review.extension_review.background_preserve_features,
    REQUIRED_BACKGROUND_FEATURES,
    "extension_review.background_preserve_features",
  );

  const decisions = review.extension_review.per_file_decision ?? [];
  assert.equal(Array.isArray(decisions), true, "extension_review.per_file_decision must be an array");
  const decisionByFile = new Map(decisions.map((item) => [item.file, item]));
  assert.equal(decisionByFile.get("background.js")?.action, "keep_local_bridge_features");
  assert.equal(decisionByFile.get("background.js")?.risk, "high_if_blind_synced");
  assert.equal(decisionByFile.get("disable_dialogs.js")?.action, "keep_local_no_behavior_change");
  assert.equal(decisionByFile.get("disable_dialogs.js")?.risk, "none_final_newline_only");
}

function assertSchemaShape(schema) {
  assert.equal(schema.title, "GenericAgent upstream review ledger");
  assert.equal(schema.properties?.schema_version?.enum?.includes(1), true);
  assert.equal(schema.properties?.upstream?.properties?.reviewed_commit?.pattern, "^[0-9a-fA-F]{40}$");
  assert.deepEqual(schema.properties?.decision?.properties?.extension_merge_mode?.enum, ALLOWED_MERGE_MODES);
  assert.equal(schema.properties?.extension_review?.properties?.changed_files?.$ref, "#/$defs/string_array");
  assert.equal(schema.properties?.extension_review?.properties?.per_file_decision?.items?.$ref, "#/$defs/per_file_decision");
}

function assertInvalidReviewThrows(schema, validReview) {
  const invalidCommit = structuredClone(validReview);
  invalidCommit.upstream.reviewed_commit = "bad";
  assert.throws(
    () => assertReviewLedgerSemantics(invalidCommit),
    /reviewed_commit/,
  );

  const missingReason = structuredClone(validReview);
  missingReason.decision.reason = "";
  assert.throws(
    () => assertReviewLedgerSemantics(missingReason),
    /decision\.reason is required/,
  );

  const missingReviewedFile = structuredClone(validReview);
  missingReviewedFile.extension_review.changed_files = ["background.js"];
  assert.throws(
    () => assertReviewLedgerSemantics(missingReviewedFile),
    /disable_dialogs\.js/,
  );

  const missingBridgeFeature = structuredClone(validReview);
  missingBridgeFeature.extension_review.background_preserve_features =
    missingBridgeFeature.extension_review.background_preserve_features.filter((item) => item !== "tabs_get");
  assert.throws(
    () => assertReviewLedgerSemantics(missingBridgeFeature),
    /tabs_get/,
  );

  const missingRequiredSchemaField = structuredClone(validReview);
  delete missingRequiredSchemaField.extension_review.per_file_decision;
  assert.throws(
    () => validateSchemaValue(schema, schema, missingRequiredSchemaField),
    /per_file_decision is required/,
  );
}

async function main() {
  const schema = await readJson(schemaPath);
  const review = await readJson(reviewPath);
  assertSchemaShape(schema);
  validateSchemaValue(schema, schema, review);
  assertReviewLedgerSemantics(review);
  assertInvalidReviewThrows(schema, review);

  process.stdout.write(`${JSON.stringify({
    ok: true,
    check: "upstream-review-schema-contract",
    schema_path: schemaPath,
    review_path: reviewPath,
    reviewed_commit: review.upstream.reviewed_commit,
    reviewed_files: review.extension_review.changed_files,
    preserved_features: review.extension_review.background_preserve_features.length,
  })}\n`);
}

try {
  await main();
} catch (error) {
  process.stderr.write(`upstream-review-schema-contract failed: ${String(error?.stack ?? error)}\n`);
  process.exitCode = 1;
}
