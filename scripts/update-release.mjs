#!/usr/bin/env node
import { homedir } from "node:os";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { resolveBrowser67Home } from "../src/runtime/paths/home.mjs";
import { checkUpdate, TAG_PATTERN } from "./update-release/release.mjs";
import { installRelease } from "./update-release/install.mjs";

export function parseArgs(argv) {
  const options = { check: false, json: false, help: false,
    root: resolve(dirname(fileURLToPath(import.meta.url)), ".."),
    home: resolveBrowser67Home().path, skillsRoot: resolve(homedir(), ".agents/skills"), tag: "", browserInstanceId: "" };
  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index];
    if (arg === "--check") options.check = true;
    else if (arg === "--json") options.json = true;
    else if (arg === "--help" || arg === "-h") options.help = true;
    else if (["--tag", "--skills-root", "--browser-instance-id"].includes(arg)) {
      const value = argv[++index];
      if (!value || value.startsWith("--")) throw new Error(`missing ${arg} value`);
      if (arg === "--tag") options.tag = value;
      if (arg === "--skills-root") options.skillsRoot = resolve(value.startsWith("~/") ? resolve(homedir(), value.slice(2)) : value);
      if (arg === "--browser-instance-id") options.browserInstanceId = value;
    } else throw new Error(`unknown argument: ${arg}`);
  }
  if (options.tag && !TAG_PATTERN.test(options.tag)) throw new Error("--tag must be a stable version such as v0.11.3");
  if (!options.check && !options.tag && !options.help) throw new Error("use --check or select an explicit --tag to install");
  return options;
}

export function formatReport(report) {
  const liveDescription = report.live?.version
    ?? report.live?.instances?.map((item) => `${item.version} (${item.commit})`).join(", ");
  return [
    `browser67 update: ${report.status ?? (report.ok ? "checked" : "failed")}`,
    `Target: ${report.release?.tag ?? "unknown"} (${report.release?.commit ?? "unknown"})`,
    `CLI: ${report.local?.cli_version ?? "unknown"}`,
    `Extension files: ${report.local?.extension_version ?? "unknown"} (${report.local?.extension_commit ?? "unknown"})`,
    `Live extension: ${liveDescription || "unverified"}`,
    ...(report.mode === "check" ? ["Version equality is not a content or process freshness proof. No installation performed."] : []),
    `Agent/Hub: ${report.host_action ?? "not changed"}`,
    ...(report.receipt_path ? [`Receipt/recovery: ${report.receipt_path}`] : []),
    ...(report.error ? [`Failed phase: ${report.phase ?? "preflight"}; ${report.error}`] : []),
  ].join("\n");
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    process.stdout.write("Usage: browser67 update --check [--tag vX.Y.Z] [--json]\n       browser67 update --tag vX.Y.Z [--browser-instance-id ID] [--skills-root DIR] [--json]\nInstallation updates the global package, extension and selected Skills; it preserves host configs and source checkouts.\n");
    return;
  }
  if (!options.check) process.umask(0o077);
  try {
    const report = options.check ? await checkUpdate(options) : await installRelease(options);
    process.stdout.write(`${options.json ? JSON.stringify(report) : formatReport(report)}\n`);
  } catch (error) {
    const report = error.receipt ?? { ok: false, phase: "preflight", error: error.message };
    process.stdout.write(`${options.json ? JSON.stringify(report) : formatReport(report)}\n`);
    process.exitCode = 1;
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => { process.stderr.write(`${error.message}\n`); process.exitCode = 1; });
}
