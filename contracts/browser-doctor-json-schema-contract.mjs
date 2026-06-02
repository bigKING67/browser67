#!/usr/bin/env node
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const repoRoot = resolve(__dirname, "..");
const schemaPath = resolve(repoRoot, "docs/schemas/browser-doctor.schema.json");

function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function loadSchema() {
  const parsed = JSON.parse(readFileSync(schemaPath, "utf8"));
  if (!isRecord(parsed)) {
    throw new Error("browser doctor schema must be a JSON object");
  }
  return parsed;
}

function resolveRef(rootSchema, ref) {
  if (typeof ref !== "string" || !ref.startsWith("#/")) {
    throw new Error(`unsupported schema ref: ${String(ref)}`);
  }
  let current = rootSchema;
  for (const rawPart of ref.slice(2).split("/")) {
    const part = rawPart.replace(/~1/g, "/").replace(/~0/g, "~");
    if (!isRecord(current) || !(part in current)) {
      throw new Error(`schema ref not found: ${ref}`);
    }
    current = current[part];
  }
  if (!isRecord(current)) {
    throw new Error(`schema ref must resolve to object: ${ref}`);
  }
  return current;
}

function valueMatchesType(value, typeName) {
  if (typeName === "null") {
    return value === null;
  }
  if (typeName === "array") {
    return Array.isArray(value);
  }
  if (typeName === "object") {
    return isRecord(value);
  }
  if (typeName === "integer") {
    return Number.isInteger(value);
  }
  if (typeName === "number") {
    return typeof value === "number" && Number.isFinite(value);
  }
  return typeof value === typeName;
}

function validateSchemaValue(rootSchema, schema, value, path = "$") {
  if (!isRecord(schema)) {
    throw new Error(`schema at ${path} must be object`);
  }
  if (schema.$ref) {
    validateSchemaValue(rootSchema, resolveRef(rootSchema, schema.$ref), value, path);
    return;
  }

  if (schema.type) {
    const types = Array.isArray(schema.type) ? schema.type : [schema.type];
    const matched = types.some((typeName) => valueMatchesType(value, typeName));
    if (!matched) {
      throw new Error(`${path} expected type ${types.join("|")}, got ${Array.isArray(value) ? "array" : typeof value}`);
    }
  }

  if (Array.isArray(schema.enum) && !schema.enum.includes(value)) {
    throw new Error(`${path} expected one of ${schema.enum.join(", ")}, got ${String(value)}`);
  }

  if (Array.isArray(schema.required)) {
    if (!isRecord(value)) {
      throw new Error(`${path} required fields need object value`);
    }
    for (const key of schema.required) {
      if (!(key in value)) {
        throw new Error(`${path}.${key} is required`);
      }
    }
  }

  if (isRecord(schema.properties) && isRecord(value)) {
    for (const [key, childSchema] of Object.entries(schema.properties)) {
      if (key in value) {
        validateSchemaValue(rootSchema, childSchema, value[key], `${path}.${key}`);
      }
    }
  }

  if (isRecord(schema.items) && Array.isArray(value)) {
    for (let index = 0; index < value.length; index += 1) {
      validateSchemaValue(rootSchema, schema.items, value[index], `${path}[${String(index)}]`);
    }
  }
}

function tcpCheck(endpoint, reachable) {
  return {
    endpoint,
    host: "127.0.0.1",
    port: Number(new URL(endpoint).port || 80),
    reachable,
    latency_ms: reachable ? 1 : 0,
    detail: reachable ? "connect_ok" : "ECONNREFUSED",
  };
}

function unavailableApiCheck(endpoint) {
  return {
    endpoint,
    ok: false,
    status: null,
    latency_ms: 0,
    detail: "skipped_tcp_unreachable",
  };
}

const remoteDebuggingSuggestion = "For remote-debugging CDP path, launch Chrome with --remote-debugging-port=9222";

function doctorSuggestions({ ok, mode, path }) {
  const tmwdReady = ok === true && (path === "tmwd_ws" || path === "tmwd_link");
  const cdpReady = ok === true && path === "cdp";
  if (mode === "remote_cdp" || mode === "cdp") {
    return [remoteDebuggingSuggestion];
  }
  const suggestions = [
    "For TMWD path, run: npm run hub:start",
    "Install or enable the TMWD browser extension, then keep a Chrome/Edge tab open.",
  ];
  if (mode === "auto" && !tmwdReady && !cdpReady) {
    suggestions.push(remoteDebuggingSuggestion);
  }
  return suggestions;
}

function buildDoctorPayload({ ok, mode = "auto", path = "tmwd_ws", reason = "auto_has_route" }) {
  const tmwdReachable = path === "tmwd_ws" || path === "tmwd_link";
  return {
    ok,
    stage: "doctor_only",
    doctor: {
      ok,
      mode,
      transport: "auto",
      allow_empty_tabs: false,
      readiness: {
        ready: ok,
        reason,
        path,
      },
      checks: {
        tmwd_ws_tcp: tcpCheck("ws://127.0.0.1:18765/", tmwdReachable),
        tmwd_link_tcp: tcpCheck("http://127.0.0.1:18766/link", tmwdReachable),
        cdp_tcp: tcpCheck("http://127.0.0.1:9222/", false),
        tmwd_ws_api: {
          endpoint: "ws://127.0.0.1:18765",
          ok: tmwdReachable,
          latency_ms: tmwdReachable ? 3 : 0,
          tab_count: tmwdReachable ? 1 : 0,
          detail: tmwdReachable ? "ws_tabs_ok" : "skipped_tcp_unreachable",
        },
        tmwd_link_http: {
          endpoint: "http://127.0.0.1:18766/link",
          ok: tmwdReachable,
          status: tmwdReachable ? 200 : null,
          latency_ms: tmwdReachable ? 3 : 0,
          session_count: tmwdReachable ? 1 : 0,
          detail: tmwdReachable ? "http_ok_with_r" : "skipped_tcp_unreachable",
        },
        cdp_http: unavailableApiCheck("http://127.0.0.1:9222/json/version"),
        cdp_targets: {
          ...unavailableApiCheck("http://127.0.0.1:9222/json/list"),
          page_count: 0,
        },
      },
      suggestions: doctorSuggestions({ ok, mode, path }),
    },
    ensure_tmwd_hub: {
      attempted: false,
      enabled: true,
      reason: "not_needed",
    },
    session_wait: {
      attempted: false,
      wait_ms: 6000,
      reason: "not_needed",
    },
    event_log: {
      enabled: false,
    },
  };
}

function run() {
  const schema = loadSchema();
  assert.equal(schema.title, "tmwd-browser-mcp doctor JSON output");
  assert.equal(schema.properties?.doctor?.properties?.mode?.enum?.includes("remote_cdp"), true);
  assert.equal(schema.properties?.doctor?.properties?.readiness?.properties?.path?.enum?.includes("cdp"), true);
  assert.equal(schema.properties?.doctor?.properties?.checks?.required?.includes("tmwd_ws_api"), true);
  assert.equal(schema.properties?.event_log?.$ref, "#/$defs/event_log");

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

  process.stdout.write(`${JSON.stringify({
    ok: true,
    schema_path: schemaPath,
    validated_examples: 4,
    required_top_level: schema.required,
    doctor_path_enum: schema.properties.doctor.properties.readiness.properties.path.enum,
  })}\n`);
}

try {
  run();
} catch (error) {
  process.stderr.write(`browser-doctor-json-schema-contract failed: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
}
