import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { nowIso } from "../common.mjs";
import { createToolError } from "../errors.mjs";
import { readPngDimensions } from "../image/png-lite.mjs";

const DESIGN_CRAFT_L4_SCHEMA = "design-craft.l4-screenshots.v1";
const VALID_PHASES = new Set(["before", "after"]);
const VALID_TARGETS = new Set(["viewport", "selector", "clip", "full_page"]);
const SHA256_PATTERN = /^[a-f0-9]{64}$/;

function asObject(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function positiveNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : null;
}

function positiveInteger(value) {
  const number = positiveNumber(value);
  return number === null ? null : Math.round(number);
}

function sanitizeUrl(raw, redactUrlQuery = true) {
  const text = String(raw ?? "").trim();
  if (!text || redactUrlQuery === false) {
    return text;
  }
  try {
    const parsed = new URL(text);
    parsed.search = "";
    parsed.hash = "";
    return parsed.toString();
  } catch {
    return text;
  }
}

function normalizeDimensions(source, artifact, label) {
  const explicit = source.dimensions ?? artifact.dimensions;
  if (
    Array.isArray(explicit)
    && explicit.length === 2
    && positiveInteger(explicit[0]) !== null
    && positiveInteger(explicit[1]) !== null
  ) {
    return [positiveInteger(explicit[0]), positiveInteger(explicit[1])];
  }
  const width = positiveInteger(artifact.width ?? source.width);
  const height = positiveInteger(artifact.height ?? source.height);
  if (width !== null && height !== null) {
    return [width, height];
  }
  throw createToolError("INVALID_ARGUMENT", `${label} requires screenshot dimensions`, {
    retryable: false,
    details: { required: ["artifact.width", "artifact.height", "dimensions"] },
  });
}

function normalizeViewportFromCandidate(candidate) {
  const object = asObject(candidate);
  const width = positiveNumber(object.width ?? object.inner_width);
  const height = positiveNumber(object.height ?? object.inner_height);
  const dpr = positiveNumber(object.dpr ?? object.device_pixel_ratio ?? object.device_scale_factor) ?? 1;
  if (width === null || height === null || dpr === null) {
    return null;
  }
  return {
    width,
    height,
    dpr,
    ...(typeof object.is_mobile === "boolean" ? { is_mobile: object.is_mobile } : {}),
    ...(typeof object.mobile === "boolean" ? { is_mobile: object.mobile } : {}),
  };
}

function normalizeViewport(entry, source, label) {
  const candidates = [
    entry.viewport,
    source.viewport,
    asObject(source.viewport_override).requested,
    asObject(source.layout_metrics).viewport,
    asObject(source.page).viewport,
  ];
  for (const candidate of candidates) {
    const viewport = normalizeViewportFromCandidate(candidate);
    if (viewport) {
      return viewport;
    }
  }
  throw createToolError("INVALID_ARGUMENT", `${label} requires viewport metadata`, {
    retryable: false,
    details: {
      accepted_sources: [
        "entry.viewport",
        "screenshot.viewport_override.requested",
        "screenshot.layout_metrics.viewport",
        "screenshot.page.viewport",
      ],
    },
  });
}

function normalizeLayoutMetrics(source) {
  const metrics = asObject(source.layout_metrics);
  if (!Object.keys(metrics).length) {
    return undefined;
  }
  const result = {};
  if (typeof metrics.horizontal_overflow === "boolean") {
    result.horizontal_overflow = metrics.horizontal_overflow;
  }
  if (metrics.selectors && typeof metrics.selectors === "object" && !Array.isArray(metrics.selectors)) {
    result.selectors = metrics.selectors;
  }
  if (Object.keys(result).length === 0) {
    return undefined;
  }
  return result;
}

function assertSafeArtifactPath(artifactPath, label) {
  const text = String(artifactPath ?? "").trim();
  if (!text) {
    throw createToolError("INVALID_ARGUMENT", `${label} requires artifact path`, {
      retryable: false,
      details: { required: ["artifact.path", "artifact.artifact_path"] },
    });
  }
  if (/^data:/i.test(text) || /base64,/i.test(text)) {
    throw createToolError("INVALID_ARGUMENT", `${label} artifact path must not embed data URLs or base64`, {
      retryable: false,
    });
  }
  return text;
}

function assertSha256(value, label) {
  const digest = String(value ?? "").trim();
  if (!SHA256_PATTERN.test(digest)) {
    throw createToolError("INVALID_ARGUMENT", `${label} requires lowercase SHA-256`, {
      retryable: false,
      details: { required_pattern: "^[a-f0-9]{64}$" },
    });
  }
  return digest;
}

async function verifyArtifactFile(artifactPath, sha256, dimensions, label) {
  const bytes = await readFile(artifactPath).catch((error) => {
    throw createToolError("INVALID_ARGUMENT", `${label} artifact path does not exist or is unreadable`, {
      retryable: false,
      details: { path: artifactPath, cause: String(error?.message ?? error) },
    });
  });
  const actualSha = createHash("sha256").update(bytes).digest("hex");
  if (actualSha !== sha256) {
    throw createToolError("INVALID_ARGUMENT", `${label} artifact SHA-256 does not match file contents`, {
      retryable: false,
      details: { path: artifactPath, expected: sha256, actual: actualSha },
    });
  }
  const actualDimensions = readPngDimensions(bytes);
  if (actualDimensions.width !== dimensions[0] || actualDimensions.height !== dimensions[1]) {
    throw createToolError("INVALID_ARGUMENT", `${label} artifact dimensions do not match PNG header`, {
      retryable: false,
      details: {
        path: artifactPath,
        expected: dimensions,
        actual: [actualDimensions.width, actualDimensions.height],
      },
    });
  }
  return {
    verified: true,
    bytes: bytes.length,
  };
}

async function normalizeEntry(entry, options = {}) {
  const object = asObject(entry);
  const source = asObject(object.screenshot ?? object.payload ?? object);
  const artifact = asObject(source.artifact ?? object.artifact ?? source);
  const phase = String(object.phase ?? "").trim();
  if (!VALID_PHASES.has(phase)) {
    throw createToolError("INVALID_ARGUMENT", "design-craft L4 entries require phase=before or phase=after", {
      retryable: false,
      details: { phase },
    });
  }
  const key = String(object.key ?? object.artifact_key ?? "").trim();
  if (!key) {
    throw createToolError("INVALID_ARGUMENT", "design-craft L4 entries require artifact key", {
      retryable: false,
      details: { required: ["key"] },
    });
  }
  const label = `entries.${phase}.${key}`;
  const target = String(object.target ?? source.target ?? artifact.target ?? "viewport").trim();
  if (!VALID_TARGETS.has(target)) {
    throw createToolError("INVALID_ARGUMENT", `${label} target must be a supported screenshot target`, {
      retryable: false,
      details: { target, accepted_targets: Array.from(VALID_TARGETS).sort() },
    });
  }
  const artifactPath = assertSafeArtifactPath(artifact.path ?? artifact.artifact_path, label);
  const sha256 = assertSha256(artifact.sha256 ?? artifact.artifact_sha256, label);
  const dimensions = normalizeDimensions(source, artifact, label);
  const viewport = normalizeViewport(object, source, label);
  const page = asObject(source.page);
  const layoutMetrics = normalizeLayoutMetrics(source);
  const normalized = {
    tool: String(object.tool ?? source.tool ?? "tmwd_browser.browser_screenshot_ops"),
    target,
    artifact_path: artifactPath,
    artifact_sha256: sha256,
    dimensions,
    viewport,
    ...(layoutMetrics ? { layout_metrics: layoutMetrics } : {}),
    ...(page.url ? { url: sanitizeUrl(page.url, options.redact_url_query) } : {}),
    ...(page.title ? { title: String(page.title) } : {}),
    ...(source.capture && typeof source.capture === "object" ? { capture: source.capture } : {}),
    ...(source.run && typeof source.run === "object" ? { run: source.run } : {}),
    ...(source.tab_id ? { tab_id: String(source.tab_id) } : {}),
    ...(source.session_id ? { session_id: String(source.session_id) } : {}),
  };
  if (options.verify_artifacts === true) {
    normalized.artifact_verification = await verifyArtifactFile(artifactPath, sha256, dimensions, label);
  }
  return {
    phase,
    key,
    artifact: normalized,
  };
}

function sharedKeys(artifacts) {
  const before = new Set(Object.keys(asObject(artifacts.before)));
  const after = new Set(Object.keys(asObject(artifacts.after)));
  return Array.from(before).filter((key) => after.has(key)).sort();
}

async function maybeWriteManifest(manifest, args) {
  if (args.write !== true) {
    return null;
  }
  if (args.confirm_write !== true) {
    throw createToolError("INVALID_ARGUMENT", "writing design-craft manifest requires confirm_write=true", {
      retryable: false,
    });
  }
  const outputPath = path.resolve(String(args.output_path ?? ""));
  if (!outputPath || path.basename(outputPath) !== "screenshots.json") {
    throw createToolError("INVALID_ARGUMENT", "output_path must end with screenshots.json", {
      retryable: false,
      details: { output_path: args.output_path ?? "" },
    });
  }
  await mkdir(path.dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  return outputPath;
}

async function buildDesignCraftL4Manifest(args = {}) {
  const caseId = String(args.case_id ?? "").trim();
  if (!caseId) {
    throw createToolError("INVALID_ARGUMENT", "case_id is required for design-craft L4 manifests", {
      retryable: false,
    });
  }
  const entries = Array.isArray(args.entries) ? args.entries : [];
  if (entries.length === 0) {
    throw createToolError("INVALID_ARGUMENT", "entries must include before/after screenshot payloads", {
      retryable: false,
    });
  }

  const artifacts = { before: {}, after: {} };
  const normalizedEntries = [];
  for (const entry of entries) {
    const normalized = await normalizeEntry(entry, {
      redact_url_query: args.redact_url_query !== false,
      verify_artifacts: args.verify_artifacts === true,
    });
    artifacts[normalized.phase][normalized.key] = normalized.artifact;
    normalizedEntries.push({ phase: normalized.phase, key: normalized.key });
  }

  const missingPhases = [];
  for (const phase of VALID_PHASES) {
    if (Object.keys(artifacts[phase]).length === 0) {
      missingPhases.push(phase);
    }
  }
  if (missingPhases.length > 0) {
    throw createToolError("INVALID_ARGUMENT", "design-craft L4 manifests require before and after artifacts", {
      retryable: false,
      details: { missing_phases: missingPhases },
    });
  }

  const shared_artifact_keys = sharedKeys(artifacts);
  if (args.require_shared_keys !== false && shared_artifact_keys.length === 0) {
    throw createToolError("INVALID_ARGUMENT", "design-craft L4 manifests require at least one shared before/after artifact key", {
      retryable: false,
    });
  }

  const manifest = {
    schema: DESIGN_CRAFT_L4_SCHEMA,
    case_id: caseId,
    created_at: nowIso(),
    source_tool: "tmwd_browser.browser_evidence_bundle_ops",
    artifacts,
    evidence_bundle: {
      schema: "tmwd.design-craft-evidence-bundle.v1",
      normalized_entries: normalizedEntries,
      shared_artifact_keys,
      transport_health: args.transport_health && typeof args.transport_health === "object"
        ? args.transport_health
        : undefined,
      finalize_summary: args.finalize_summary && typeof args.finalize_summary === "object"
        ? args.finalize_summary
        : undefined,
      run: args.run && typeof args.run === "object" ? args.run : undefined,
    },
  };

  const outputPath = await maybeWriteManifest(manifest, args);
  return {
    ok: true,
    status: "success",
    tool: "browser_evidence_bundle_ops",
    action: "build_design_craft_l4_manifest",
    schema: DESIGN_CRAFT_L4_SCHEMA,
    case_id: caseId,
    manifest,
    validation: {
      phases: {
        before: Object.keys(artifacts.before).sort(),
        after: Object.keys(artifacts.after).sort(),
      },
      shared_artifact_keys,
      artifact_count: entries.length,
    },
    written: Boolean(outputPath),
    output_path: outputPath ?? undefined,
  };
}

export {
  DESIGN_CRAFT_L4_SCHEMA,
  buildDesignCraftL4Manifest,
};
