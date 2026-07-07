#!/usr/bin/env node

import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";

import { validateSchemaValue } from "./browser-doctor-json-schema-contract/schema-validator.mjs";

const repoRoot = path.resolve(import.meta.dirname, "..");
const readmePath = path.resolve(repoRoot, "docs", "upstream", "js-reverse", "README.md");
const ledgerPath = path.resolve(repoRoot, "docs", "upstream", "js-reverse", "references.json");
const schemaPath = path.resolve(repoRoot, "docs", "schemas", "js-reverse-upstream-reference.schema.json");

const REQUIRED_CANONICAL_PATHS = [
  "src/mcp/js-reverse/server.mjs",
  "src/js-reverse-server/",
  "skills/js-reverse/",
  "docs/js-reverse/",
];

const REQUIRED_REFERENCES = [
  "zhaoxuya520/reverse-skill",
  "NoOne-hub/JSReverser-MCP",
  "zhizhuodemao/js-reverse-mcp",
];

const REQUIRED_NON_GOALS = [
  "replace_browser67_backed_js_reverse_skill",
  "import_reverse_skill_action_required_semantics",
  "auto_install_external_tools",
  "auto_write_mcp_config",
  "copy_reverse_skill_pack",
  "promote_jshookmcp_or_anything_analyzer_to_default_entry",
  "allow_legacy_local_snapshot_to_override_canonical",
];

function assertPathExists(relativePath) {
  assert.equal(existsSync(path.resolve(repoRoot, relativePath)), true, `missing ${relativePath}`);
}

async function readJson(filePath) {
  return JSON.parse(await readFile(filePath, "utf8"));
}

function assertIncludesAll(actual, required, label) {
  assert.equal(Array.isArray(actual), true, `${label} must be an array`);
  for (const item of required) {
    assert.ok(actual.includes(item), `${label} must include ${item}`);
  }
}

function assertLedgerSemantics(ledger) {
  assert.equal(ledger.schema_version, 1);
  assert.equal(ledger.canonical?.implementation, "browser67");
  assertIncludesAll(ledger.canonical?.paths, REQUIRED_CANONICAL_PATHS, "canonical.paths");
  for (const relativePath of REQUIRED_CANONICAL_PATHS) {
    assertPathExists(relativePath);
  }

  assert.equal(ledger.legacy_snapshot_policy?.direct_import_allowed, false);
  assert.equal(ledger.legacy_snapshot_policy?.may_override_canonical, false);

  const references = ledger.references ?? [];
  assert.equal(Array.isArray(references), true, "references must be an array");
  const referenceByName = new Map(references.map((item) => [item.name, item]));
  for (const name of REQUIRED_REFERENCES) {
    const reference = referenceByName.get(name);
    assert.ok(reference, `references must include ${name}`);
    assert.equal(typeof reference.remote, "string", `${name}.remote must be a string`);
    assert.ok(reference.remote.length > 0, `${name}.remote must be non-empty`);
    assert.match(reference.reviewed_commit, /^[0-9a-f]{40}$/i, `${name}.reviewed_commit must be a 40 character hex commit`);
    assert.equal(reference.direct_import_allowed, false, `${name}.direct_import_allowed must be false`);
  }

  assertIncludesAll(ledger.non_goals, REQUIRED_NON_GOALS, "non_goals");
}

function assertSchemaShape(schema) {
  assert.equal(schema.$id, "https://browser67.local/schemas/js-reverse-upstream-reference.schema.json");
  assert.equal(schema.title, "js-reverse upstream reference ledger");
  assert.equal(schema.properties?.schema_version?.enum?.includes(1), true);
  assert.equal(schema.properties?.canonical?.properties?.implementation?.enum?.includes("browser67"), true);
  assert.equal(schema.properties?.references?.items?.$ref, "#/$defs/reference");
  assert.equal(schema.$defs?.reference?.properties?.reviewed_commit?.pattern, "^[0-9a-fA-F]{40}$");
}

function assertReadmeSemantics(text) {
  for (const pattern of [
    /browser67-backed/,
    /reference only/,
    /not implementation upstream/,
    /legacy local snapshot/,
    /evidence\.v1/,
    /finalize_task/,
  ]) {
    assert.match(text, pattern, `js-reverse upstream README must include ${String(pattern)}`);
  }
  assert.doesNotMatch(
    text,
    /ACTION REQUIRED|读完后立刻执行|bootstrap-reverse|field-journal\/precedent-reverse/,
    "js-reverse upstream README must not import auto-execution/bootstrap semantics",
  );
}

function assertInvalidLedgerThrows(schema, validLedger) {
  const invalidCommit = structuredClone(validLedger);
  invalidCommit.references[0].reviewed_commit = "bad";
  assert.throws(
    () => assertLedgerSemantics(invalidCommit),
    /reviewed_commit/,
  );

  const directImport = structuredClone(validLedger);
  directImport.references[0].direct_import_allowed = true;
  assert.throws(
    () => assertLedgerSemantics(directImport),
    /direct_import_allowed/,
  );

  const missingNonGoal = structuredClone(validLedger);
  missingNonGoal.non_goals = missingNonGoal.non_goals.filter((item) => item !== "allow_legacy_local_snapshot_to_override_canonical");
  assert.throws(
    () => assertLedgerSemantics(missingNonGoal),
    /allow_legacy_local_snapshot_to_override_canonical/,
  );

  const missingSchemaField = structuredClone(validLedger);
  delete missingSchemaField.legacy_snapshot_policy;
  assert.throws(
    () => validateSchemaValue(schema, schema, missingSchemaField),
    /legacy_snapshot_policy is required/,
  );
}

async function main() {
  assert.equal(existsSync(readmePath), true, "missing docs/upstream/js-reverse/README.md");
  assert.equal(existsSync(ledgerPath), true, "missing docs/upstream/js-reverse/references.json");
  assert.equal(existsSync(schemaPath), true, "missing docs/schemas/js-reverse-upstream-reference.schema.json");

  const schema = await readJson(schemaPath);
  const ledger = await readJson(ledgerPath);
  const readme = await readFile(readmePath, "utf8");

  assertSchemaShape(schema);
  validateSchemaValue(schema, schema, ledger);
  assertLedgerSemantics(ledger);
  assertReadmeSemantics(readme);
  assertInvalidLedgerThrows(schema, ledger);

  process.stdout.write(`${JSON.stringify({
    ok: true,
    check: "js-reverse-upstream-reference-contract",
    canonical: ledger.canonical.implementation,
    reference_count: ledger.references.length,
    legacy_snapshot_direct_import_allowed: ledger.legacy_snapshot_policy.direct_import_allowed,
  })}\n`);
}

main().catch((error) => {
  process.stderr.write(`js-reverse-upstream-reference-contract failed: ${String(error?.message ?? error)}\n`);
  process.exitCode = 1;
});
