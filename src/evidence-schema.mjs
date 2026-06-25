import { randomUUID } from "node:crypto";

const EVIDENCE_SCHEMA_VERSION = "evidence.v1";
const EVIDENCE_SOURCES = new Set([
  "browser",
  "network",
  "dom",
  "storage",
  "script",
  "hook",
  "manual",
  "artifact",
  "tool",
]);
const EVIDENCE_CONFIDENCE = new Set([
  "exact",
  "partial",
  "inferred",
  "missing",
  "unknown",
]);

function normalizeEvidenceSource(raw) {
  const value = String(raw ?? "tool").trim().toLowerCase();
  return EVIDENCE_SOURCES.has(value) ? value : "tool";
}

function normalizeEvidenceConfidence(raw) {
  const value = String(raw ?? "unknown").trim().toLowerCase();
  return EVIDENCE_CONFIDENCE.has(value) ? value : "unknown";
}

function normalizeEvidenceRecord(input = {}, defaults = {}) {
  const data = input && typeof input === "object" ? input : {};
  return {
    schema_version: EVIDENCE_SCHEMA_VERSION,
    id: String(data.id ?? defaults.id ?? `evidence_${randomUUID()}`),
    ts: String(data.ts ?? defaults.ts ?? new Date().toISOString()),
    source: normalizeEvidenceSource(data.source ?? defaults.source),
    confidence: normalizeEvidenceConfidence(data.confidence ?? defaults.confidence),
    title: String(data.title ?? defaults.title ?? "").trim(),
    keys: data.keys && typeof data.keys === "object" && !Array.isArray(data.keys) ? data.keys : {},
    timestamps: data.timestamps && typeof data.timestamps === "object" && !Array.isArray(data.timestamps)
      ? data.timestamps
      : {},
    request_ids: Array.isArray(data.request_ids) ? data.request_ids.map(String) : [],
    script_ids: Array.isArray(data.script_ids) ? data.script_ids.map(String) : [],
    artifacts: Array.isArray(data.artifacts) ? data.artifacts.map(String) : [],
    data: data.data && typeof data.data === "object" ? data.data : (data.payload ?? {}),
  };
}

export {
  EVIDENCE_CONFIDENCE,
  EVIDENCE_SCHEMA_VERSION,
  EVIDENCE_SOURCES,
  normalizeEvidenceConfidence,
  normalizeEvidenceRecord,
  normalizeEvidenceSource,
};
