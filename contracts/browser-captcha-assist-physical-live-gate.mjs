#!/usr/bin/env node
import { spawn } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const liveSmokePath = resolve(scriptDir, "browser-captcha-assist-live-smoke.mjs");

function envEnabled(name) {
  return ["1", "true", "yes", "on"].includes(String(process.env[name] ?? "").trim().toLowerCase());
}

function jsonLine(payload) {
  process.stdout.write(`${JSON.stringify(payload)}\n`);
}

function parseLastJsonLine(output) {
  const lines = String(output ?? "").trim().split(/\r?\n/).filter(Boolean);
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    try {
      return JSON.parse(lines[index]);
    } catch {
      // Keep scanning: child failures may print diagnostics before JSON.
    }
  }
  return null;
}

function runChild(args) {
  return new Promise((resolvePromise) => {
    const child = spawn(process.execPath, [liveSmokePath, ...args], {
      cwd: process.cwd(),
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString("utf8");
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString("utf8");
    });
    child.on("error", (error) => {
      resolvePromise({
        status: 1,
        stdout,
        stderr: `${stderr}${String(error?.message ?? error)}`,
      });
    });
    child.on("close", (status) => {
      resolvePromise({
        status: Number.isFinite(Number(status)) ? Number(status) : 1,
        stdout,
        stderr,
      });
    });
  });
}

async function run() {
  const physicalEnabled = envEnabled("TMWD_CAPTCHA_ASSIST_PHYSICAL");
  const confirmEnabled = envEnabled("TMWD_CAPTCHA_ASSIST_CONFIRM");
  const requirePhysical = envEnabled("TMWD_CAPTCHA_ASSIST_REQUIRE_PHYSICAL");
  if (!physicalEnabled) {
    const payload = {
      ok: !requirePhysical,
      status: "skipped",
      check: "captcha-assist-physical-live",
      reason: "set TMWD_CAPTCHA_ASSIST_PHYSICAL=1 and TMWD_CAPTCHA_ASSIST_CONFIRM=1 to run the local physical drag gate",
      require_physical: requirePhysical,
      planning_gate: "npm run check:captcha-assist-live",
    };
    jsonLine(payload);
    return payload.ok ? 0 : 1;
  }
  if (!confirmEnabled) {
    jsonLine({
      ok: false,
      status: "blocked",
      check: "captcha-assist-physical-live",
      reason: "TMWD_CAPTCHA_ASSIST_CONFIRM=1 is required before physical input",
    });
    return 1;
  }

  const child = await runChild(process.argv.slice(2));
  const parsed = parseLastJsonLine(child.stdout);
  if (child.status !== 0 || parsed?.ok !== true) {
    jsonLine({
      ok: false,
      status: "failed",
      check: "captcha-assist-physical-live",
      child_status: child.status,
      child_result: parsed,
      stderr: child.stderr.trim().slice(0, 4000),
      stdout_tail: child.stdout.trim().split(/\r?\n/).slice(-5),
    });
    return child.status || 1;
  }
  const physicalCompleted = parsed.physical_completion?.slider_completed === true;
  const physicalSucceeded = parsed.physical_assist_status === "success" && physicalCompleted;
  jsonLine({
    ok: physicalSucceeded,
    status: physicalSucceeded ? "passed" : "failed",
    check: "captcha-assist-physical-live",
    planning_only: parsed.planning_only,
    physical_assist_status: parsed.physical_assist_status,
    physical_completion: parsed.physical_completion,
    finalized_closed: parsed.finalized_closed,
    matrix_case_count: Array.isArray(parsed.matrix_results) ? parsed.matrix_results.length : 0,
    child_workspace_key: parsed.workspace_key,
    child_tab_id: parsed.tab_id,
  });
  return physicalSucceeded ? 0 : 1;
}

process.exitCode = await run();
