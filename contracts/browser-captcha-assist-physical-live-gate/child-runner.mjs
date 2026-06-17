import { spawn } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const moduleDir = dirname(fileURLToPath(import.meta.url));
const defaultLiveSmokePath = resolve(moduleDir, "..", "browser-captcha-assist-live-smoke.mjs");

function parseLastJsonLine(output) {
  const lines = String(output ?? "").trim().split(/\r?\n/).filter(Boolean);
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    try {
      return JSON.parse(lines[index]);
    } catch {
      // Child failures may print diagnostics before the final JSON line.
    }
  }
  return null;
}

function runPhysicalLiveChild(args, options = {}) {
  const liveSmokePath = options.liveSmokePath ?? defaultLiveSmokePath;
  return new Promise((resolvePromise) => {
    const child = spawn(process.execPath, [liveSmokePath, ...args], {
      cwd: options.cwd ?? process.cwd(),
      env: options.env ?? process.env,
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

export {
  defaultLiveSmokePath,
  parseLastJsonLine,
  runPhysicalLiveChild,
};
