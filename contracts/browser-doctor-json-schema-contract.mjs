#!/usr/bin/env node

import { runDoctorSchemaContract } from "./browser-doctor-json-schema-contract/runner.mjs";

try {
  await runDoctorSchemaContract();
} catch (error) {
  process.stderr.write(`browser-doctor-json-schema-contract failed: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
}
