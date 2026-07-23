#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

const repoRoot = resolve(import.meta.dirname, "..");

const MATRIX = [
  {
    id: "lint",
    command: "npm run lint",
    tier: "required",
    covers: ["biome-static-analysis", "registry-and-contract-source"],
  },
  {
    id: "type-check",
    command: "npm run type-check",
    tier: "required",
    covers: ["checkjs-runtime-contracts", "tool-and-transport-shapes"],
  },
  {
    id: "dependency-boundaries",
    command: "npm run check:dependency-boundaries",
    tier: "required",
    covers: ["module-cycles", "layer-boundaries", "complexity-observations"],
  },
  {
    id: "core-contracts",
    command: "npm run check:mcp",
    tier: "required",
    covers: ["tool-surface", "tool-outcome-v3", "run-lifecycle", "browser-job", "wait-surface", "transport-health", "native-fallback"],
  },
  {
    id: "browser-runtime",
    command: "npm run check:browser-runtime",
    tier: "required",
    covers: ["runtime-composition", "tool-registry", "per-tab-scheduler"],
  },
  {
    id: "browser-content-core",
    command: "npm run check:browser-content-core",
    tier: "required",
    covers: ["actionable-snapshot-v2", "semantic-diff-v2", "managed-raw-execution", "adopted-navigation-suspension", "network-observation"],
  },
  {
    id: "run-store",
    command: "npm run check:run-store",
    tier: "required",
    covers: ["atomic-checkpoints", "tail-reads", "group-index", "active-job-index"],
  },
  {
    id: "browser-job-persistence",
    command: "npm run check:job-persistence",
    tier: "required",
    covers: ["run-backed-job-checkpoints", "restart-interruption-recovery", "accurate-cancel-capabilities"],
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
    id: "js-reverse-absorption-matrix",
    command: "npm run check:js-reverse-absorption-matrix",
    tier: "required",
    covers: ["js-reverse-reference-ledger", "promotion-requirements", "direct-import-boundary"],
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
    id: "skills-roots-audit",
    command: "npm run check:skills-roots-audit",
    tier: "required",
    covers: ["multi-root-skill-audit", "broken-symlink-detection", "no-blind-sync-guidance"],
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
    id: "extension-install-doctor",
    command: "npm run check:extension-install-doctor",
    tier: "required",
    covers: ["installed-extension-drift", "setup-reload-guidance", "generated-config-ignore"],
  },
  {
    id: "extension-reload-live",
    command: "npm run check:extension-reload-live",
    tier: "required",
    covers: ["connected-extension-self-reload", "reload-error-propagation"],
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
    id: "verification-manifest",
    command: "npm run check:verification-manifest",
    tier: "required",
    covers: ["ci-tier", "live-tier", "platform-tier", "release-tier"],
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
    covers: ["tmwd-hub", "extension-connectivity", "extension-build-identity", "real-browser-readiness"],
  },
  {
    id: "browser-live",
    command: "npm run check:live",
    tier: "live",
    covers: ["managed-fixture-tab", "scan-execute-target-parity", "scoped-finalize-cleanup"],
  },
  {
    id: "js-reverse-live",
    command: "npm run check:js-reverse-live",
    tier: "live",
    covers: ["real-browser-js-reverse", "managed-tabs", "runtime-hooks"],
  },
  {
    id: "tmwd-performance-live",
    command: "npm run check:tmwd-performance-live",
    tier: "live",
    covers: ["tmwd-tabs-get-latency", "managed-execute-latency", "actionable-snapshot-latency", "selector-wait-latency"],
  },
  {
    id: "screenshot-live",
    command: "npm run check:screenshot-live",
    tier: "live",
    covers: ["viewport-artifact", "responsive-override", "selector-fallback", "full-page-bounds"],
  },
  {
    id: "remote-cdp",
    command: "npm run check:remote-cdp",
    tier: "platform",
    covers: ["isolated-debug-chrome", "explicit-cdp-mode", "fixture-live"],
  },
  {
    id: "native-live-proof-readiness",
    command: "npm run check:native-live",
    tier: "platform",
    covers: ["target-os-readiness", "explicit-physical-opt-in", "sanitized-native-proof-recording"],
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
