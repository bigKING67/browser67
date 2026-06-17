#!/usr/bin/env node

import process from "node:process";

import { detectNativeInputCapabilities } from "../native-capabilities.mjs";
import { buildNativePointerReadinessReport } from "../native-capabilities/pointer-readiness.mjs";

function parseArgs(argv) {
  const parsed = {
    json: false,
    require_pointer: false,
  };
  for (let index = 2; index < argv.length; index += 1) {
    const token = argv[index] ?? "";
    if (token === "--json") {
      parsed.json = true;
      continue;
    }
    if (token === "--require-pointer") {
      parsed.require_pointer = true;
      continue;
    }
    if (!token) {
      continue;
    }
    throw new Error(`unknown argument: ${token}`);
  }
  return parsed;
}

async function buildReport() {
  const capabilities = await detectNativeInputCapabilities({
    refresh: true,
    cache_ttl_ms: 0,
  });
  return {
    ...buildNativePointerReadinessReport(capabilities, {
      check: "native-pointer-readiness",
      platform: process.platform,
    }),
    physical_gate_command: "TMWD_CAPTCHA_ASSIST_PHYSICAL=1 TMWD_CAPTCHA_ASSIST_CONFIRM=1 npm run check:captcha-assist-physical-live",
    safe_default: "diagnostic_only_no_pointer_input",
  };
}

function outputText(report) {
  process.stdout.write(
    `native_pointer_readiness=${report.status} platform=${report.platform} driver=${report.driver} click=${report.supports_click} drag=${report.supports_drag}\n`,
  );
  if (report.requirements.length > 0) {
    const lines = report.requirements.map((requirement) => `  - ${requirement}`).join("\n");
    process.stdout.write(`requirements:\n${lines}\n`);
  }
  if (report.next_steps.length > 0) {
    const lines = report.next_steps.map((nextStep) => `  - ${nextStep}`).join("\n");
    process.stdout.write(`next_steps:\n${lines}\n`);
  }
}

async function run() {
  const args = parseArgs(process.argv);
  const report = await buildReport();
  if (args.json) {
    process.stdout.write(`${JSON.stringify(report)}\n`);
  } else {
    outputText(report);
  }
  process.exitCode = args.require_pointer && !report.ok ? 2 : 0;
}

try {
  await run();
} catch (error) {
  process.stderr.write(`native-pointer-readiness failed: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
}
