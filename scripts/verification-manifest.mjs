#!/usr/bin/env node

import { readFileSync } from "node:fs";

import { entries, resolveTier, tiers } from "./verification/manifest.mjs";

const pkg = JSON.parse(readFileSync("package.json", "utf8"));

const requiredAliases = {
  check: "node scripts/run-verification.mjs --tier check",
  verify: "node scripts/verify.mjs",
  "verify:ci": "node scripts/run-verification.mjs --tier ci",
  "verify:local": "node scripts/run-verification.mjs --tier local",
  "verify:live": "node scripts/run-verification.mjs --tier live",
  "verify:platform": "node scripts/run-verification.mjs --tier platform",
  "verify:all": "node scripts/run-verification.mjs --tier all",
};

function buildReport() {
  const ids = entries.map((entry) => entry.id);
  const duplicateIds = ids.filter((id, index) => ids.indexOf(id) !== index);
  const missingScripts = entries
    .filter((entry) => entry.script && typeof pkg.scripts?.[entry.script] !== "string")
    .map((entry) => entry.script);
  const aliasDrift = Object.entries(requiredAliases)
    .filter(([name, command]) => pkg.scripts?.[name] !== command)
    .map(([name, expected]) => ({ name, expected, actual: pkg.scripts?.[name] ?? null }));
  const tierErrors = [];
  for (const tier of Object.keys(tiers)) {
    try {
      resolveTier(tier);
    } catch (error) {
      tierErrors.push({ tier, error: String(error?.message ?? error) });
    }
  }
  return {
    ok: duplicateIds.length === 0
      && missingScripts.length === 0
      && aliasDrift.length === 0
      && tierErrors.length === 0,
    check: "verification-manifest",
    schema_version: "browser67.verification.v2",
    tiers: Object.fromEntries(Object.entries(tiers).map(([id, tier]) => [id, {
      purpose: tier.purpose,
      step_count: resolveTier(id).length,
      command: `node scripts/run-verification.mjs --tier ${id}`,
    }])),
    entry_count: entries.length,
    duplicate_ids: duplicateIds,
    missing_scripts: [...new Set(missingScripts)],
    alias_drift: aliasDrift,
    tier_errors: tierErrors,
  };
}

const args = new Set(process.argv.slice(2));
const report = buildReport();
if (args.has("--json") || !args.has("--check")) {
  process.stdout.write(`${JSON.stringify(report, null, args.has("--json") ? 2 : 0)}\n`);
} else {
  process.stdout.write(`verification_manifest=${report.ok ? "ok" : "failed"} tiers=${Object.keys(report.tiers).length} entries=${report.entry_count} missing_scripts=${report.missing_scripts.length} alias_drift=${report.alias_drift.length}\n`);
}
process.exitCode = report.ok ? 0 : 1;

export { buildReport };
