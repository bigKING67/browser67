import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { promisify } from "node:util";

const execute = promisify(execFile);

export function npmInvocation(args, { platform = process.platform, env = process.env, execPath = process.execPath } = {}) {
  const candidates = [env.npm_execpath, resolve(dirname(execPath), "node_modules/npm/bin/npm-cli.js"),
    resolve(dirname(execPath), "../lib/node_modules/npm/bin/npm-cli.js")];
  const cli = candidates.find((candidate) => candidate && /npm-cli\.js$/.test(candidate) && existsSync(candidate));
  if (cli) return [execPath, [cli, ...args]];
  if (platform === "win32") throw new Error("npm-cli.js unavailable; run through npm or repair the Node/npm installation");
  return ["npm", args];
}

export async function run(command, args, options = {}) {
  const [executable, argv] = command === "npm" ? npmInvocation(args) : [command, args];
  try {
    const result = await execute(executable, argv, {
      cwd: options.cwd, env: options.env ?? process.env,
      timeout: options.timeout ?? 120_000, maxBuffer: 8 * 1024 * 1024,
      windowsHide: true,
    });
    return result.stdout.trim();
  } catch (error) {
    if (options.allowFailure && typeof error.stdout === "string" && error.stdout.trim()) return error.stdout.trim();
    // Child output can include registry credentials or private host paths.
    throw new Error(`${command} failed (${String(error.code ?? "timeout")}); phase=${options.phase ?? "command"}`);
  }
}

export function parseJsonOutput(value) {
  try { return JSON.parse(value); } catch {
    for (const line of String(value).split(/\r?\n/).reverse()) {
      try { return JSON.parse(line); } catch { /* Skip human-readable prefixes. */ }
    }
  }
  throw new Error("command did not return JSON");
}
