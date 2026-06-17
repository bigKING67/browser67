#!/usr/bin/env node
import { runJsReverseMcpContract } from "./js-reverse-mcp-contract/runner.mjs";

try {
  await runJsReverseMcpContract(process.argv.slice(2));
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`js-reverse-mcp-contract failed: ${message}\n`);
  process.exitCode = 1;
}
