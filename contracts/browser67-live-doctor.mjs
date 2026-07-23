#!/usr/bin/env node
import { CAPABILITIES } from "../src/tab-workspace/capabilities.mjs";
import { collectDoctorChecks } from "./browser67-live-doctor/checks.mjs";
import { parseArgs } from "./browser67-live-doctor/cli.mjs";
import { evaluateModeReadiness } from "./browser67-live-doctor/readiness.mjs";
import { buildSuggestions } from "./browser67-live-doctor/suggestions.mjs";

async function runDoctor(argv = process.argv.slice(2)) {
  const cli = parseArgs(argv);
  const checks = await collectDoctorChecks(cli);
  const readiness = evaluateModeReadiness(cli, checks);
  return {
    ok: readiness.ready,
    mode: cli.tmwd_mode,
    transport: cli.tmwd_transport,
    allow_empty_tabs: cli.allow_empty_tabs,
    capabilities: CAPABILITIES,
    readiness,
    checks,
    suggestions: buildSuggestions(cli, readiness),
  };
}

try {
  const result = await runDoctor();
  process.stdout.write(`${JSON.stringify(result)}\n`);
  if (!result.ok) {
    process.exitCode = 1;
  }
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`browser67-live-doctor failed: ${message}\n`);
  process.exitCode = 1;
}

export {
  runDoctor,
};
