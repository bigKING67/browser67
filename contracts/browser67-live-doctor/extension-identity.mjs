import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

import {
  compareExtensionIdentityContent,
} from "../../src/identity/extension-content.mjs";
import { resolveBrowser67Home } from "../../src/runtime/paths/home.mjs";
import { normalizeExtensionIdentity } from "../../src/tmwd-hub/extension-identity.mjs";
import { buildExtension } from "../../scripts/build-extension.mjs";

const repoRoot = resolve(import.meta.dirname, "..", "..");
const extensionSourceDir = resolve(repoRoot, "extension");

function readInstalledIdentity(path, basis) {
  if (!existsSync(path)) {
    return { basis, path, available: false, identity: null, error: "identity_missing" };
  }
  try {
    const identity = normalizeExtensionIdentity(JSON.parse(readFileSync(path, "utf8")));
    return {
      basis,
      path,
      available: identity !== null,
      identity,
      error: identity ? "" : "identity_invalid",
    };
  } catch (error) {
    return {
      basis,
      path,
      available: false,
      identity: null,
      error: `identity_read_failed: ${String(error?.message ?? error)}`,
    };
  }
}

function installedIdentityCandidates() {
  const home = resolveBrowser67Home();
  return [
    readInstalledIdentity(
      resolve(home.path, "browser/tmwd_cdp_bridge/browser67/build-identity.json"),
      "active_home",
    ),
    readInstalledIdentity(
      resolve(repoRoot, "runtime/chrome-extension/tmwd_cdp_bridge/browser67/build-identity.json"),
      "project_local",
    ),
  ];
}

function loadExpectedExtensionIdentity() {
  const candidates = installedIdentityCandidates();
  const tempRoot = mkdtempSync(resolve(tmpdir(), "browser67-live-doctor-identity-"));
  try {
    const result = buildExtension({
      source_dir: extensionSourceDir,
      target_dir: resolve(tempRoot, "extension"),
    });
    return {
      available: true,
      path: extensionSourceDir,
      basis: "generated_current_source",
      identity: result.extension_identity,
      installed_candidates: candidates,
      error: "",
    };
  } catch (error) {
    return {
      available: false,
      path: extensionSourceDir,
      basis: "generated_current_source",
      identity: null,
      installed_candidates: candidates,
      error: `current_extension_identity_build_failed: ${String(error?.message ?? error)}`,
    };
  } finally {
    rmSync(tempRoot, { recursive: true, force: true, maxRetries: 8, retryDelay: 125 });
  }
}

function compareExtensionRuntimeIdentity(runtimeProbe, expected) {
  const runtimeInfo = runtimeProbe?.runtime_info && typeof runtimeProbe.runtime_info === "object"
    ? runtimeProbe.runtime_info
    : null;
  const expectedIdentity = expected?.identity ?? null;
  const activeInstances = (Array.isArray(runtimeInfo?.browser_instances)
    ? runtimeInfo.browser_instances
    : []).filter((instance) => instance?.active === true);
  const activeInstanceIdentities = activeInstances.map((instance) => ({
    browser_instance_id: String(instance?.browser_instance_id ?? ""),
    identity_status: String(instance?.extension_identity_status ?? "missing"),
    identity: normalizeExtensionIdentity(instance?.extension_identity),
  }));
  const observed = normalizeExtensionIdentity(runtimeInfo?.extension_identity)
    ?? (activeInstanceIdentities.length === 1 ? activeInstanceIdentities[0].identity : null);
  const mismatches = [];
  const observedForComparison = activeInstanceIdentities.length > 0
    ? activeInstanceIdentities.map((entry) => entry.identity)
    : [observed];
  const observedComparisons = observedForComparison.map((identity) => (
    compareExtensionIdentityContent(identity, expectedIdentity)
  ));
  if (expectedIdentity) {
    for (const comparison of observedComparisons) {
      for (const field of comparison.mismatches) {
        if (!mismatches.includes(field)) mismatches.push(field);
      }
    }
  }
  const connected = runtimeInfo?.extension_connected === true;
  const identityStatus = activeInstanceIdentities.length > 0
    ? (activeInstanceIdentities.every((entry) => entry.identity_status === "valid" && entry.identity) ? "valid" : "invalid")
    : String(runtimeInfo?.extension_identity_status ?? "missing");
  const identityMatch = Boolean(
    expectedIdentity
    && observedForComparison.length > 0
    && observedForComparison.every(Boolean)
    && observedComparisons.every((comparison) => comparison.content_match),
  );
  const installedCandidates = (Array.isArray(expected?.installed_candidates)
    ? expected.installed_candidates
    : []).map((candidate) => {
    const candidateIdentity = candidate?.identity ?? null;
    const candidateComparison = compareExtensionIdentityContent(observed, candidateIdentity);
    const candidateMatchesObserved = candidateComparison.content_match;
    return {
      basis: String(candidate?.basis ?? "unknown"),
      path: String(candidate?.path ?? ""),
      available: candidate?.available === true,
      identity_match: candidateMatchesObserved,
      provenance_match: candidateComparison.provenance_match,
      provenance_variant: candidateComparison.provenance_variant,
      extension_version: candidateIdentity?.extension_version ?? null,
      source_digest: candidateIdentity?.source_digest ?? null,
      error: String(candidate?.error ?? ""),
    };
  });
  const ok = runtimeProbe?.ok === true
    && connected
    && identityStatus === "valid"
    && expected?.available === true
    && identityMatch;
  let detail = "extension_identity_ok";
  if (runtimeProbe?.ok !== true) detail = String(runtimeProbe?.detail ?? "runtime_info_unavailable");
  else if (!connected) detail = "extension_not_connected";
  else if (identityStatus !== "valid" || !observed) detail = `live_extension_identity_${identityStatus}`;
  else if (expected?.available !== true) detail = String(expected?.error || "installed_extension_identity_unavailable");
  else if (!identityMatch) detail = `extension_identity_mismatch:${mismatches.join(",")}`;
  return {
    endpoint: String(runtimeProbe?.endpoint ?? ""),
    ok,
    latency_ms: Number(runtimeProbe?.latency_ms ?? 0),
    detail,
    extension_connected: connected,
    extension_identity_status: identityStatus,
    extension_identity_received_at: runtimeInfo?.extension_identity_received_at ?? null,
    expected_identity_path: String(expected?.path ?? ""),
    expected_identity_basis: String(expected?.basis ?? "unknown"),
    expected_identity_available: expected?.available === true,
    identity_match: identityMatch,
    provenance_match: Boolean(
      identityMatch
      && observedComparisons.every((comparison) => comparison.provenance_match),
    ),
    provenance_variant: Boolean(
      identityMatch
      && observedComparisons.some((comparison) => comparison.provenance_variant),
    ),
    mismatches,
    observed_identity: observed,
    observed_browser_instances: activeInstanceIdentities.map((entry) => ({
      browser_instance_id: entry.browser_instance_id,
      identity_status: entry.identity_status,
      identity_match: compareExtensionIdentityContent(entry.identity, expectedIdentity).content_match,
      provenance_variant: compareExtensionIdentityContent(entry.identity, expectedIdentity).provenance_variant,
    })),
    expected_identity: expectedIdentity,
    installed_identity_candidates: installedCandidates,
    matching_installed_paths: installedCandidates
      .filter((candidate) => candidate.identity_match)
      .map((candidate) => candidate.path),
  };
}

export {
  compareExtensionRuntimeIdentity,
  loadExpectedExtensionIdentity,
};
