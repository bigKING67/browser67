#!/usr/bin/env node

import { runVerification } from "./run-verification.mjs";

const result = runVerification({ tier: "verify" });
process.exitCode = result.ok ? 0 : result.exit_code ?? 1;
