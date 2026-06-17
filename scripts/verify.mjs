#!/usr/bin/env node

import { spawnSync } from "node:child_process";

const commands = [
  ["npm", ["run", "extension:check"]],
  ["npm", ["run", "upstream:check"]],
  ["npm", ["run", "skills:check"]],
  ["npm", ["run", "check:syntax"]],
  ["npm", ["run", "check:change-set"]],
  ["npm", ["run", "check:readiness"]],
  ["npm", ["run", "check"]],
  ["npm", ["run", "check:live:doctor"]],
  ["npm", ["run", "check:js-reverse-live"]],
  ["npm", ["run", "check:managed-tab-live"]],
  ["npm", ["run", "check:auth-live"]],
  ["npm", ["run", "check:captcha-assist-live"]],
  ["npm", ["run", "check:ljqctrl"]],
  ["npm", ["run", "check:managed-tabs-clean"]],
  ["npm", ["audit", "--audit-level=moderate"]],
];

function run() {
  for (const [command, args] of commands) {
    const label = `${command} ${args.join(" ")}`;
    process.stdout.write(`\n>>> ${label}\n`);
    const result = spawnSync(command, args, {
      cwd: process.cwd(),
      env: process.env,
      stdio: "inherit",
    });
    if (result.status !== 0) {
      process.stderr.write(`verify failed at: ${label}\n`);
      return Number.isFinite(Number(result.status)) ? Number(result.status) : 1;
    }
  }
  process.stdout.write("\nverify ok\n");
  return 0;
}

process.exitCode = run();
