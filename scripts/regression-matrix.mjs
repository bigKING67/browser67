#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

const repoRoot = resolve(import.meta.dirname, "..");

const MATRIX = [
  {
    id: "core-contracts",
    command: "npm run check:mcp",
    tier: "required",
    covers: ["tool-surface", "run-lifecycle", "browser-job", "wait-surface", "transport-health", "native-fallback"],
  },
  {
    id: "js-reverse-contracts",
    command: "npm run check:js-reverse-mcp",
    tier: "required",
    covers: ["js-reverse-surface", "frame-surface", "evidence-schema", "managed-lifecycle"],
  },
  {
    id: "js-reverse-upstream-audit",
    command: "npm run check:js-reverse-upstream-audit",
    tier: "required",
    covers: ["js-reverse-reference-ledger", "external-reference-drift", "reference-only-policy"],
  },
  {
    id: "active-skill-sync",
    command: "npm run check:active-skill-sync",
    tier: "required",
    covers: ["active-skill-install", "dry-run-sync", "backup-before-write", "backup-list", "restore-current-backup"],
  },
  {
    id: "active-skill-local-check",
    command: "npm run skills:active:check",
    tier: "local",
    covers: ["active-skill-install", "local-drift-gate"],
  },
  {
    id: "syntax",
    command: "npm run check:syntax",
    tier: "required",
    covers: ["esm-syntax", "scripts", "contracts"],
  },
  {
    id: "project-structure",
    command: "npm run check:project-structure",
    tier: "required",
    covers: ["directory-governance", "runtime-artifact-boundaries", "entrypoint-shims"],
  },
  {
    id: "performance-smoke",
    command: "npm run check:performance-smoke",
    tier: "required",
    covers: ["run-artifact-io", "evidence-normalization"],
  },
  {
    id: "task-templates",
    command: "npm run check:task-templates",
    tier: "required",
    covers: ["browser-task-template", "js-reverse-task-template"],
  },
  {
    id: "upstream-audit",
    command: "npm run check:upstream-audit",
    tier: "required",
    covers: ["genericagent-drift", "extension-merge-classifier", "latest-temp-audit"],
  },
  {
    id: "upstream-review-ledger",
    command: "npm run check:upstream-review",
    tier: "required",
    covers: ["genericagent-review-ledger", "schema-contract", "stale-review-governance"],
  },
  {
    id: "live-doctor",
    command: "npm run check:live:doctor",
    tier: "live",
    covers: ["tmwd-hub", "extension-connectivity", "real-browser-readiness"],
  },
  {
    id: "js-reverse-live",
    command: "npm run check:js-reverse-live",
    tier: "live",
    covers: ["real-browser-js-reverse", "managed-tabs", "runtime-hooks"],
  },
];

async function packageScripts() {
  const pkg = JSON.parse(await readFile(resolve(repoRoot, "package.json"), "utf8"));
  return pkg.scripts ?? {};
}

function parseArgs(argv) {
  return {
    json: argv.includes("--json"),
    includeLive: argv.includes("--include-live"),
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const scripts = await packageScripts();
  const rows = MATRIX
    .filter((row) => args.includeLive || row.tier !== "live")
    .map((row) => {
      const scriptName = row.command.startsWith("npm run ") ? row.command.slice("npm run ".length) : "";
      return {
        ...row,
        available: Boolean(scripts[scriptName]),
      };
    });
  const payload = {
    ok: rows.every((row) => row.available),
    generated_at: new Date().toISOString(),
    include_live: args.includeLive,
    matrix: rows,
  };
  if (args.json) {
    process.stdout.write(`${JSON.stringify(payload)}\n`);
    return payload.ok ? 0 : 1;
  }
  for (const row of rows) {
    process.stdout.write(`${row.available ? "OK" : "MISSING"} ${row.id}: ${row.command} (${row.tier})\n`);
  }
  return payload.ok ? 0 : 1;
}

try {
  process.exitCode = await main();
} catch (error) {
  process.stderr.write(`regression-matrix failed: ${String(error?.message ?? error)}\n`);
  process.exitCode = 1;
}
