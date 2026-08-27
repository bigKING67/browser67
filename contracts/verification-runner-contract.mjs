import assert from "node:assert/strict";

import {
  resolveSpawnInvocation,
  spawnFailureDetails,
  spawnResultExitCode,
} from "../scripts/run-verification.mjs";

const direct = resolveSpawnInvocation("npm", ["run", "lint"], {
  platform: "linux",
  env: {},
  exec_path: "/fixture/node",
});
assert.deepEqual(direct, {
  command: "npm",
  args: ["run", "lint"],
  strategy: "direct",
});

const windowsLifecycle = resolveSpawnInvocation("npm", ["run", "lint"], {
  platform: "win32",
  env: { npm_execpath: "C:\\fixture\\npm-cli.js" },
  exec_path: "C:\\fixture\\node.exe",
});
assert.deepEqual(windowsLifecycle, {
  command: "C:\\fixture\\node.exe",
  args: ["C:\\fixture\\npm-cli.js", "run", "lint"],
  strategy: "npm_execpath",
});

const windowsFallback = resolveSpawnInvocation("npm", ["audit", "--audit-level=moderate"], {
  platform: "win32",
  env: { ComSpec: "C:\\Windows\\System32\\cmd.exe" },
  exec_path: "C:\\fixture\\node.exe",
});
assert.deepEqual(windowsFallback, {
  command: "C:\\Windows\\System32\\cmd.exe",
  args: ["/d", "/s", "/c", "npm.cmd", "audit", "--audit-level=moderate"],
  strategy: "windows_command_shell",
});

assert.equal(spawnResultExitCode({ status: 0 }), 0);
assert.equal(spawnResultExitCode({ status: 7 }), 7);
assert.equal(spawnResultExitCode({ status: null }), 1);
assert.equal(spawnResultExitCode({ status: undefined }), 1);
assert.equal(spawnResultExitCode({ status: 0, signal: "SIGTERM" }), 1);
assert.equal(spawnResultExitCode({
  status: null,
  error: Object.assign(new Error("spawn EINVAL"), { code: "EINVAL" }),
}), 1);

const failureDetails = spawnFailureDetails({
  status: null,
  signal: "SIGTERM",
  error: Object.assign(new Error("spawn EINVAL"), { code: "EINVAL" }),
}, windowsLifecycle);
assert.match(failureDetails, /strategy=npm_execpath/);
assert.match(failureDetails, /status=null/);
assert.match(failureDetails, /signal=SIGTERM/);
assert.match(failureDetails, /spawn_error=EINVAL:spawn EINVAL/);

process.stdout.write(`${JSON.stringify({
  ok: true,
  check: "verification-runner-contract",
  windows_npm_resolution: true,
  null_status_fails_closed: true,
  spawn_error_observable: true,
})}\n`);
