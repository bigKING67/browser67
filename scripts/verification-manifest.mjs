#!/usr/bin/env node

import { readFileSync } from "node:fs";

const pkg = JSON.parse(readFileSync("package.json", "utf8"));
const verifySource = readFileSync("scripts/verify.mjs", "utf8");

const tiers = {
  ci: {
    command: "npm run verify:ci",
    purpose: "Deterministic contracts, docs/skills sync, dependency audit, and release metadata without a real browser profile.",
    requires: ["node", "network_for_npm_audit"],
  },
  coverage: {
    command: "npm run coverage:contracts",
    purpose: "Generate the deterministic src/scripts coverage baseline without pretending the first baseline is a release threshold.",
    requires: ["node", "c8"],
  },
  local: {
    command: "npm run verify:local",
    purpose: "Full local TMWD verification plus strict active skill drift checking.",
    requires: ["browser67_extension", "tmwd_hub", "active_browser_tab"],
  },
  live: {
    command: "npm run verify:live",
    purpose: "Real-browser doctor, managed tabs, auth/CAPTCHA planning, JS reverse, and screenshot behavior.",
    requires: ["browser67_extension", "tmwd_hub", "active_browser_tab"],
  },
  platform: {
    command: "npm run verify:platform",
    purpose: "Explicit remote CDP and native/platform capability gates without claiming cross-OS proof.",
    requires: ["local_chrome", "native_capability_probe"],
  },
  all: {
    command: "npm run verify:all",
    purpose: "Local release-grade verification including active skills, screenshot live proof, and isolated remote CDP.",
    requires: ["local", "platform"],
  },
  release: {
    command: "npm run release:ready",
    purpose: "Clean, synced release gate with current GenericAgent and JS reverse reference reviews.",
    requires: ["clean_git", "synced_origin_main", "network_for_upstream_freshness"],
  },
};

const requiredScripts = [
  "verify",
  "coverage:contracts",
  "verify:ci",
  "verify:local",
  "verify:live",
  "verify:platform",
  "verify:all",
  "release:ready",
  "release:ready:strict",
  "check:job-persistence",
  "check:screenshot-live",
  "check:remote-cdp",
  "check:native-live",
  "proof:native-live",
];

function buildReport() {
  const missingScripts = requiredScripts.filter((name) => typeof pkg.scripts?.[name] !== "string");
  const verifyMissing = [
    "check:job-persistence",
    "check:screenshot-live",
  ].filter((name) => !verifySource.includes(name));
  return {
    ok: missingScripts.length === 0 && verifyMissing.length === 0,
    check: "verification-manifest",
    schema_version: "browser67.verification.v1",
    tiers,
    required_scripts: requiredScripts,
    missing_scripts: missingScripts,
    default_verify_missing: verifyMissing,
  };
}

const args = new Set(process.argv.slice(2));
const report = buildReport();
if (args.has("--json") || !args.has("--check")) {
  process.stdout.write(`${JSON.stringify(report, null, args.has("--json") ? 2 : 0)}\n`);
} else {
  process.stdout.write(`verification_manifest=${report.ok ? "ok" : "failed"} tiers=${Object.keys(tiers).length} missing_scripts=${report.missing_scripts.length} verify_missing=${report.default_verify_missing.length}\n`);
}
process.exitCode = report.ok ? 0 : 1;
