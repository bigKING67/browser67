#!/usr/bin/env node

import process from "node:process";

import { emit, parseArgs } from "./native-deps-setup/cli.mjs";
import { resolveServerPath } from "./native-deps-setup/paths.mjs";
import { runNativeDepsSetup } from "./native-deps-setup/report.mjs";

const options = parseArgs(process.argv);
const serverPath = resolveServerPath(import.meta.url);
const result = await runNativeDepsSetup({
  options,
  serverPath,
});

for (const line of result.notice_lines) {
  emit(line, options);
}
emit(result.report, options);
process.exitCode = result.exit_code;
