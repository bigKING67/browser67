#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const smokePath = path.join(repoRoot, "contracts", "browser-screenshot-live-smoke.mjs");
const DEFAULT_ITERATIONS = 3;
const DEFAULT_CHILD_TIMEOUT_MS = 120_000;
const MAX_ITERATIONS = 10;
const DEFAULT_CHILD_ARGS = ["--tmwd-mode", "tmwd", "--tmwd-transport", "auto"];

function integerInRange(raw, name, minimum, maximum) {
  const value = Number(raw);
  if (!Number.isInteger(value) || value < minimum || value > maximum) {
    throw new Error(
      `${name} must be an integer between ${String(minimum)} and ${String(maximum)}`,
    );
  }
  return value;
}

function parseArgs(argv = []) {
  const delimiterIndex = argv.indexOf("--");
  const ownArgs = delimiterIndex >= 0 ? argv.slice(0, delimiterIndex) : argv;
  const forwardedArgs = delimiterIndex >= 0 ? argv.slice(delimiterIndex + 1) : [];
  const options = {
    iterations: DEFAULT_ITERATIONS,
    child_timeout_ms: DEFAULT_CHILD_TIMEOUT_MS,
    child_args: forwardedArgs.length > 0 ? forwardedArgs : [...DEFAULT_CHILD_ARGS],
    help: false,
  };
  for (let index = 0; index < ownArgs.length; index += 1) {
    const token = String(ownArgs[index] ?? "");
    if (token === "--iterations") {
      options.iterations = integerInRange(
        ownArgs[index + 1],
        "--iterations",
        DEFAULT_ITERATIONS,
        MAX_ITERATIONS,
      );
      index += 1;
      continue;
    }
    if (token === "--child-timeout-ms") {
      options.child_timeout_ms = integerInRange(
        ownArgs[index + 1],
        "--child-timeout-ms",
        1,
        900_000,
      );
      index += 1;
      continue;
    }
    if (token === "--help" || token === "-h") {
      options.help = true;
      continue;
    }
    if (token) throw new Error(`unknown argument: ${token}`);
  }
  return options;
}

function usage() {
  return [
    "Usage: node scripts/screenshot-stability.mjs [options] [-- <screenshot-live args>]",
    "",
    `  --iterations N         required independent runs (minimum/default ${String(DEFAULT_ITERATIONS)})`,
    `  --child-timeout-ms N   per-run process deadline (default ${String(DEFAULT_CHILD_TIMEOUT_MS)})`,
  ].join("\n");
}

function parsePayload(stdout) {
  const text = String(stdout ?? "").trim();
  if (!text) throw new Error("screenshot live gate returned empty stdout");
  const payload = JSON.parse(text);
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new Error("screenshot live gate did not return one JSON object");
  }
  return payload;
}

function assessPayload(payload) {
  const failures = [];
  if (payload?.ok !== true) failures.push("ok_not_true");
  if (payload?.background_visibility_state !== "hidden") {
    failures.push("default_lifecycle_not_hidden");
  }
  if (payload?.debugger_timeout_cleanup_verified !== true) {
    failures.push("timeout_cleanup_not_verified");
  }
  if (payload?.viewport_restored_after_mobile_capture !== true) {
    failures.push("viewport_not_restored");
  }
  if (payload?.finalized_status !== "success") {
    failures.push("managed_scope_not_finalized");
  }
  return failures;
}

function defaultSpawnRun({ child_args, child_timeout_ms }) {
  return spawnSync(process.execPath, [smokePath, ...child_args], {
    cwd: repoRoot,
    env: process.env,
    encoding: "utf8",
    timeout: child_timeout_ms,
    maxBuffer: 10 * 1024 * 1024,
  });
}

function runScreenshotStability(options = {}) {
  const iterations = integerInRange(
    options.iterations ?? DEFAULT_ITERATIONS,
    "iterations",
    DEFAULT_ITERATIONS,
    MAX_ITERATIONS,
  );
  const childTimeoutMs = integerInRange(
    options.child_timeout_ms ?? DEFAULT_CHILD_TIMEOUT_MS,
    "child_timeout_ms",
    1,
    900_000,
  );
  const childArgs = Array.isArray(options.child_args)
    ? options.child_args.map((value) => String(value))
    : [...DEFAULT_CHILD_ARGS];
  const spawnRun = options.spawn_run ?? defaultSpawnRun;
  const results = [];

  for (let iteration = 1; iteration <= iterations; iteration += 1) {
    const child = spawnRun({
      iteration,
      child_args: childArgs,
      child_timeout_ms: childTimeoutMs,
    });
    const failures = [];
    let payload = null;
    if (child?.error) failures.push(`process_error:${String(child.error.code ?? child.error.name)}`);
    if (child?.signal) failures.push(`process_signal:${String(child.signal)}`);
    if (child?.status !== 0) failures.push(`process_exit:${String(child?.status ?? "null")}`);
    if (failures.length === 0) {
      try {
        payload = parsePayload(child.stdout);
        failures.push(...assessPayload(payload));
      } catch (error) {
        failures.push(`invalid_json:${String(error?.message ?? error)}`);
      }
    }
    results.push({
      iteration,
      ok: failures.length === 0,
      exit_code: Number.isInteger(child?.status) ? child.status : null,
      signal: child?.signal ? String(child.signal) : null,
      background_visibility_state: payload?.background_visibility_state ?? null,
      debugger_timeout_cleanup_verified: payload?.debugger_timeout_cleanup_verified ?? false,
      viewport_restored_after_mobile_capture:
        payload?.viewport_restored_after_mobile_capture ?? false,
      finalized_status: payload?.finalized_status ?? null,
      failures,
    });
  }

  const passedIterations = results.filter((result) => result.ok).length;
  return {
    schema: "browser67.screenshot-stability.v1",
    ok: passedIterations === iterations,
    required_iterations: iterations,
    passed_iterations: passedIterations,
    failed_iterations: iterations - passedIterations,
    child_timeout_ms: childTimeoutMs,
    no_retry_masking: true,
    results,
  };
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    process.stdout.write(`${usage()}\n`);
    return 0;
  }
  const report = runScreenshotStability(options);
  process.stdout.write(`${JSON.stringify(report)}\n`);
  return report.ok ? 0 : 1;
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  try {
    process.exitCode = main();
  } catch (error) {
    process.stderr.write(`screenshot stability failed: ${String(error?.stack ?? error)}\n`);
    process.exitCode = 1;
  }
}

export {
  assessPayload,
  parseArgs,
  parsePayload,
  runScreenshotStability,
};
