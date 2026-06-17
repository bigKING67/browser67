import { spawn } from "node:child_process";
import process from "node:process";

function runCommand(command, args, timeoutMs = 120_000) {
  return new Promise((resolve) => {
    const proc = spawn(command, args, {
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    let done = false;
    const timer = setTimeout(() => {
      if (done) {
        return;
      }
      done = true;
      proc.kill("SIGTERM");
      resolve({
        ok: false,
        code: null,
        stdout,
        stderr: `${stderr}\nTIMEOUT after ${String(timeoutMs)}ms`.trim(),
      });
    }, timeoutMs);
    proc.stdout.on("data", (chunk) => {
      stdout += chunk.toString("utf8");
    });
    proc.stderr.on("data", (chunk) => {
      stderr += chunk.toString("utf8");
    });
    proc.on("error", (error) => {
      if (done) {
        return;
      }
      done = true;
      clearTimeout(timer);
      resolve({
        ok: false,
        code: null,
        stdout,
        stderr: `${stderr}\n${String(error)}`.trim(),
      });
    });
    proc.on("close", (code) => {
      if (done) {
        return;
      }
      done = true;
      clearTimeout(timer);
      resolve({
        ok: code === 0,
        code,
        stdout,
        stderr,
      });
    });
  });
}

async function commandExists(command) {
  const probe = process.platform === "win32" ? "where" : "which";
  const result = await runCommand(probe, [command], 5_000);
  return result.ok;
}

export {
  commandExists,
  runCommand,
};
