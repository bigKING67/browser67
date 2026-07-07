#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

function buildCommands(managedTabBaselineFile) {
  return [
    {
      command: "node",
      args: ["scripts/check-managed-tab-cleanup.mjs", "--write-baseline", managedTabBaselineFile],
      label: "managed tab cleanup baseline",
    },
    { command: "npm", args: ["run", "extension:check"] },
    { command: "npm", args: ["run", "upstream:check"] },
    { command: "npm", args: ["run", "upstream:audit"] },
    { command: "npm", args: ["run", "upstream:audit:latest"] },
    { command: "npm", args: ["run", "check:upstream-audit"] },
    { command: "npm", args: ["run", "check:upstream-review"] },
    { command: "npm", args: ["run", "check:js-reverse-upstream-audit"] },
    { command: "npm", args: ["run", "js-reverse:upstream-audit", "--", "--json"] },
    { command: "npm", args: ["run", "skills:check"] },
    { command: "npm", args: ["run", "check:syntax"] },
    { command: "npm", args: ["run", "check:project-structure"] },
    { command: "npm", args: ["run", "check:performance-smoke"] },
    { command: "npm", args: ["run", "check:task-templates"] },
    { command: "npm", args: ["run", "check:regression-matrix"] },
    { command: "npm", args: ["run", "check:captcha-router"] },
    { command: "npm", args: ["run", "check:captcha-provider-jfbym"] },
    { command: "npm", args: ["run", "check:captcha-provider-jfbym-setup"] },
    { command: "npm", args: ["run", "check:captcha-provider-jfbym-coordinate"] },
    { command: "npm", args: ["run", "check:change-set"] },
    { command: "npm", args: ["run", "check:release-readiness"] },
    { command: "npm", args: ["run", "check:readiness"] },
    { command: "npm", args: ["run", "check"] },
    { command: "npm", args: ["run", "check:live:doctor"] },
    { command: "npm", args: ["run", "check:js-reverse-live"] },
    { command: "npm", args: ["run", "check:managed-tab-live"] },
    { command: "npm", args: ["run", "check:auth-live"] },
    { command: "npm", args: ["run", "check:captcha-assist-live"] },
    { command: "npm", args: ["run", "check:native-pointer"] },
    { command: "npm", args: ["run", "check:ljqctrl"] },
    { command: "npm", args: ["run", "check:optional-live-proofs"] },
    { command: "npm", args: ["run", "plan:optional-live-proofs"] },
    { command: "npm", args: ["run", "proof:optional-live-status"] },
    {
      command: "node",
      args: ["scripts/check-managed-tab-cleanup.mjs", "--baseline-file", managedTabBaselineFile],
      label: "npm run check:managed-tabs-clean -- --baseline-file <verify-baseline>",
    },
    { command: "npm", args: ["audit", "--audit-level=moderate"] },
  ];
}

function run() {
  const tempDir = mkdtempSync(path.join(tmpdir(), "tmwd-verify-"));
  const managedTabBaselineFile = path.join(tempDir, "managed-tabs-baseline.json");
  try {
    for (const step of buildCommands(managedTabBaselineFile)) {
      const label = step.label ?? `${step.command} ${step.args.join(" ")}`;
      process.stdout.write(`\n>>> ${label}\n`);
      const result = spawnSync(step.command, step.args, {
        cwd: process.cwd(),
        env: process.env,
        stdio: "inherit",
      });
      if (result.status !== 0) {
        process.stderr.write(`verify failed at: ${label}\n`);
        return Number.isFinite(Number(result.status)) ? Number(result.status) : 1;
      }
    }
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
  process.stdout.write("\nverify ok\n");
  return 0;
}

process.exitCode = run();
