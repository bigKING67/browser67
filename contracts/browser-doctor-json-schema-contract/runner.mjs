import assert from "node:assert/strict";

import { buildDoctorPayload, remoteDebuggingSuggestion } from "./fixtures.mjs";
import { schemaPath } from "./paths.mjs";
import { loadSchema, validateSchemaValue } from "./schema-validator.mjs";

function assertSchemaShape(schema) {
  assert.equal(schema.title, "browser67 doctor JSON output");
  assert.equal(schema.properties?.doctor?.properties?.mode?.enum?.includes("remote_cdp"), true);
  assert.equal(schema.properties?.doctor?.properties?.readiness?.properties?.path?.enum?.includes("cdp"), true);
  assert.equal(schema.properties?.doctor?.properties?.checks?.required?.includes("tmwd_ws_api"), true);
  assert.equal(schema.properties?.doctor?.properties?.checks?.required?.includes("tmwd_ws_runtime"), true);
  assert.equal(schema.properties?.doctor?.properties?.checks?.required?.includes("tmwd_link_runtime"), true);
  assert.equal(schema.$defs?.extension_identity?.required?.includes("source_digest"), true);
  assert.equal(schema.properties?.event_log?.$ref, "#/$defs/event_log");
}

function assertFixtureValidation(schema) {
  const okPayload = buildDoctorPayload({ ok: true });
  const blockedPayload = buildDoctorPayload({
    ok: false,
    path: "none",
    reason: "auto_no_route",
  });
  const tmwdBlockedPayload = buildDoctorPayload({
    ok: false,
    mode: "tmwd",
    path: "none",
    reason: "tmwd_no_route",
  });
  validateSchemaValue(schema, schema, okPayload);
  validateSchemaValue(schema, schema, blockedPayload);
  validateSchemaValue(schema, schema, tmwdBlockedPayload);

  const remoteModePayload = buildDoctorPayload({
    ok: false,
    mode: "remote_cdp",
    path: "cdp",
    reason: "cdp_unavailable",
  });
  validateSchemaValue(schema, schema, remoteModePayload);
  assert.equal(okPayload.doctor.suggestions.includes(remoteDebuggingSuggestion), false);
  assert.equal(blockedPayload.doctor.suggestions.includes(remoteDebuggingSuggestion), true);
  assert.equal(tmwdBlockedPayload.doctor.suggestions.includes(remoteDebuggingSuggestion), false);
  assert.equal(remoteModePayload.doctor.suggestions.includes(remoteDebuggingSuggestion), true);

  const missingStableField = structuredClone(okPayload);
  delete missingStableField.doctor.readiness.path;
  assert.throws(
    () => validateSchemaValue(schema, schema, missingStableField),
    /doctor\.readiness\.path is required/,
  );
}

async function runDoctorSchemaContract() {
  const schema = await loadSchema();
  assertSchemaShape(schema);
  assertFixtureValidation(schema);
  process.stdout.write(`${JSON.stringify({
    ok: true,
    schema_path: schemaPath,
    validated_examples: 4,
    required_top_level: schema.required,
    doctor_path_enum: schema.properties.doctor.properties.readiness.properties.path.enum,
  })}\n`);
}

export {
  runDoctorSchemaContract,
};
