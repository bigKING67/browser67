#!/usr/bin/env node

import { existsSync, readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(import.meta.dirname, "..");

function expandHome(value) {
  const input = String(value ?? "");
  if (input === "~") return os.homedir();
  if (input.startsWith("~/")) return path.resolve(os.homedir(), input.slice(2));
  return path.resolve(input);
}

function parseArgs(argv) {
  const options = {
    json: false,
    check: false,
    skipLive: false,
    activeSkillsDir: process.env.BROWSER67_ACTIVE_SKILLS_DIR || "~/.agents/skills",
    extensionSource: path.resolve(repoRoot, "extension"),
    extensionTarget: null,
    globalAgents: "~/.codex/AGENTS.md",
    projectAgents: path.resolve(repoRoot, "AGENTS.md"),
    codexConfig: "~/.codex/config.toml",
  };
  for (let index = 0; index < argv.length; index += 1) {
    const token = String(argv[index] ?? "");
    if (token === "--json") {
      options.json = true;
      continue;
    }
    if (token === "--check") {
      options.check = true;
      continue;
    }
    if (token === "--skip-live") {
      options.skipLive = true;
      continue;
    }
    if (["--active-skills-dir", "--extension-source", "--extension-target", "--global-agents", "--project-agents", "--codex-config"].includes(token)) {
      const value = String(argv[index + 1] ?? "").trim();
      if (!value || value.startsWith("--")) throw new Error(`missing ${token} value`);
      const key = {
        "--active-skills-dir": "activeSkillsDir",
        "--extension-source": "extensionSource",
        "--extension-target": "extensionTarget",
        "--global-agents": "globalAgents",
        "--project-agents": "projectAgents",
        "--codex-config": "codexConfig",
      }[token];
      options[key] = value;
      index += 1;
      continue;
    }
    if (token === "--help" || token === "-h") {
      options.help = true;
      continue;
    }
    throw new Error(`unknown argument: ${token}`);
  }
  for (const key of ["activeSkillsDir", "extensionSource", "globalAgents", "projectAgents", "codexConfig"]) {
    options[key] = expandHome(options[key]);
  }
  if (options.extensionTarget) options.extensionTarget = expandHome(options.extensionTarget);
  return options;
}

function usage() {
  return [
    "Usage: node scripts/agent-integration-doctor.mjs [--json] [--check] [--skip-live]",
    "       [--active-skills-dir <dir>] [--extension-source <dir>] [--extension-target <dir>]",
    "       [--global-agents <file>] [--project-agents <file>] [--codex-config <file>]",
    "",
    "Audits the installed browser67 Agent usage path without modifying files.",
    "--check exits non-zero unless the requested static or static-and-live audit scope is ready.",
    "--skip-live reports static_only readiness and never claims effective runtime readiness.",
  ].join("\n");
}

function readText(filePath) {
  return existsSync(filePath) ? readFileSync(filePath, "utf8") : "";
}

function parseJsonOutput(stdout) {
  const text = String(stdout ?? "").trim();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    const lines = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean).reverse();
    for (const line of lines) {
      try {
        return JSON.parse(line);
      } catch {
        // Keep looking for the final structured line.
      }
    }
  }
  return null;
}

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function payloadIdentity(payload, expected = {}) {
  const checks = Object.fromEntries(
    Object.entries(expected).map(([key, value]) => [key, isRecord(payload) && payload[key] === value]),
  );
  return {
    ok: isRecord(payload) && Object.values(checks).every(Boolean),
    checks,
  };
}

function runNodeScript(script, args, { timeout = 30_000, expected = {} } = {}) {
  const result = spawnSync(process.execPath, [path.resolve(repoRoot, script), ...args], {
    cwd: repoRoot,
    encoding: "utf8",
    timeout,
  });
  const payload = parseJsonOutput(result.stdout);
  const identity = payloadIdentity(payload, expected);
  const processOk = result.status === 0 && result.signal === null && !result.error;
  return {
    ok: processOk && identity.ok,
    process_ok: processOk,
    identity_ok: identity.ok,
    identity_checks: identity.checks,
    expected_identity: expected,
    status: result.status,
    signal: result.signal,
    error_code: result.error?.code ?? null,
    payload,
    stderr: String(result.stderr ?? "").trim(),
  };
}

function probeReport(probe) {
  const payload = isRecord(probe.payload) ? probe.payload : {};
  return {
    ...payload,
    ok: probe.ok && payload.ok === true,
    probe: {
      ok: probe.ok,
      process_ok: probe.process_ok,
      identity_ok: probe.identity_ok,
      identity_checks: probe.identity_checks,
      expected_identity: probe.expected_identity,
      exit_code: probe.status,
      signal: probe.signal,
      error_code: probe.error_code,
    },
  };
}

function instructionAnchors(text) {
  return {
    browser67_route: /browser67/i.test(text) && /tmwd_browser/.test(text),
    explicit_adoption: /inspect_adoption[\s\S]{0,160}adopt_existing/.test(text),
    scoped_finalize: /finalize_task/.test(text) && /(scoped|workspace_key|task_id|当前)/i.test(text),
    login_fail_closed: /(fail closed|禁止静默 fallback|不静默切换)/i.test(text),
  };
}

function allTrue(record) {
  return Object.values(record).every((value) => value === true);
}

function stripTomlComment(line) {
  let quote = "";
  let escaped = false;
  for (let index = 0; index < line.length; index += 1) {
    const character = line[index];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (quote === '"' && character === "\\") {
      escaped = true;
      continue;
    }
    if (character === '"' || character === "'") {
      quote = quote === character ? "" : (quote || character);
      continue;
    }
    if (character === "#" && !quote) return line.slice(0, index);
  }
  return line;
}

function tomlSections(text) {
  const sections = new Map();
  const counts = new Map();
  let current = null;
  for (const rawLine of String(text ?? "").split(/\r?\n/)) {
    const line = stripTomlComment(rawLine).trim();
    if (!line) continue;
    const header = line.match(/^\[\s*([A-Za-z0-9_.-]+)\s*\]$/)
      ?? line.match(/^\[\[\s*([A-Za-z0-9_.-]+)\s*\]\]$/);
    if (header) {
      current = header[1];
      counts.set(current, (counts.get(current) ?? 0) + 1);
      if (!sections.has(current)) sections.set(current, []);
      continue;
    }
    if (current) sections.get(current).push(line);
  }
  return { sections, counts };
}

function mcpConfigStatus(configPath) {
  const text = readText(configPath);
  const { sections, counts } = tomlSections(text);
  const tmwdSection = sections.get("mcp_servers.tmwd_browser")?.join("\n") ?? "";
  const jsReverseSection = sections.get("mcp_servers.js-reverse")?.join("\n") ?? "";
  const checks = {
    config_present: Boolean(text),
    tmwd_server_registered: counts.get("mcp_servers.tmwd_browser") === 1,
    tmwd_canonical_entrypoint: /src\/mcp\/browser\/server\.mjs/.test(tmwdSection),
    js_reverse_server_registered: counts.get("mcp_servers.js-reverse") === 1,
    js_reverse_canonical_entrypoint: /src\/mcp\/js-reverse\/server\.mjs/.test(jsReverseSection),
  };
  return { ok: allTrue(checks), path: configPath, checks };
}

function buildReport(options) {
  const canonicalFiles = [
    "src/mcp/browser/server.mjs",
    "src/mcp/js-reverse/server.mjs",
    "skills/browser67/SKILL.md",
    "skills/tmwd-browser-mcp/SKILL.md",
    "skills/js-reverse/SKILL.md",
    "docs/codex-integration.md",
    "docs/agent-setup.md",
    "docs/global-prompt-snippet.md",
    "AGENTS.md",
  ];
  const canonicalMissing = canonicalFiles.filter((relativePath) => !existsSync(path.resolve(repoRoot, relativePath)));
  const canonicalText = canonicalFiles
    .filter((relativePath) => relativePath.endsWith(".md") && existsSync(path.resolve(repoRoot, relativePath)))
    .map((relativePath) => readText(path.resolve(repoRoot, relativePath)))
    .join("\n");
  const canonicalAnchors = instructionAnchors(canonicalText);
  const releaseArtifactReady = canonicalMissing.length === 0 && allTrue(canonicalAnchors);

  const globalAgentsText = readText(options.globalAgents);
  const projectAgentsText = readText(options.projectAgents);
  const globalAgentsAnchors = instructionAnchors(globalAgentsText);
  const projectAgentsAnchors = instructionAnchors(projectAgentsText);
  const globalAgentsCurrent = Boolean(globalAgentsText) && allTrue(globalAgentsAnchors);
  const projectAgentsCurrent = Boolean(projectAgentsText) && allTrue(projectAgentsAnchors);
  const instructionRouteCurrent = globalAgentsCurrent && projectAgentsCurrent;

  const activeSkills = runNodeScript("scripts/active-skill-sync.mjs", [
    "--target",
    options.activeSkillsDir,
    "--json",
    "--check",
  ], { expected: { check: "active-skill-sync" } });
  const activeSkillCurrent = activeSkills.ok && activeSkills.payload?.ok === true;

  const extensionArgs = ["--source", options.extensionSource, "--json", "--check"];
  if (options.extensionTarget) extensionArgs.push("--target", options.extensionTarget);
  const extension = runNodeScript("scripts/extension-install-doctor.mjs", extensionArgs, {
    expected: { check: "extension-install-doctor" },
  });
  const extensionInstalledCurrent = extension.ok
    && extension.payload?.ok === true
    && extension.payload?.installed_current === true;

  const mcpConfig = mcpConfigStatus(options.codexConfig);

  let runtime = {
    skipped: true,
    verified: false,
    ready: null,
    reason: "skip_live_requested",
    path: null,
  };
  if (!options.skipLive) {
    const live = runNodeScript("contracts/browser67-live-gate.mjs", [
      "--doctor-only",
      "--tmwd-mode",
      "tmwd",
      "--disable-event-log",
      "--json",
    ], { timeout: 45_000, expected: { stage: "doctor_only" } });
    const payloadReady = live.payload?.ok === true
      && live.payload?.doctor?.readiness?.ready === true;
    runtime = {
      skipped: false,
      verified: live.identity_ok && live.signal === null && isRecord(live.payload),
      ready: live.ok && payloadReady,
      reason: live.payload?.doctor?.readiness?.reason ?? (live.stderr || "runtime_probe_failed"),
      path: live.payload?.doctor?.readiness?.path ?? null,
      probe: probeReport(live).probe,
    };
  }

  const staticReady = releaseArtifactReady
    && activeSkillCurrent
    && extensionInstalledCurrent
    && instructionRouteCurrent
    && mcpConfig.ok;
  const effectiveReady = staticReady && runtime.verified && runtime.ready === true;
  const selectedScopeReady = runtime.skipped ? staticReady : effectiveReady;
  const readinessBasis = runtime.skipped ? "static_only" : "static_and_live";
  const nextSteps = [];
  if (!releaseArtifactReady) nextSteps.push("Repair canonical browser67 Agent docs/skills/entrypoints before syncing installed copies.");
  if (!activeSkillCurrent) nextSteps.push(`Run npm run skills:active:sync -- --target ${options.activeSkillsDir}, then start a new Agent session.`);
  if (!extensionInstalledCurrent) nextSteps.push("Run npm run setup, then npm run extension:reload-live when the existing bridge is connected, and refresh target tabs.");
  if (!globalAgentsCurrent) nextSteps.push(`Update ${options.globalAgents} with browser67 route, explicit adoption, scoped finalization, and login fail-closed rules.`);
  if (!projectAgentsCurrent) nextSteps.push(`Update ${options.projectAgents} with browser67 route, explicit adoption, scoped finalization, and login fail-closed rules.`);
  if (!mcpConfig.ok) nextSteps.push(`Register tmwd_browser and js-reverse canonical MCP entrypoints in ${options.codexConfig}.`);
  if (!runtime.skipped && !runtime.ready) nextSteps.push("Start/repair the browser67 hub and extension, then rerun npm run doctor:agent -- --check --json.");
  if (runtime.skipped && staticReady) nextSteps.push("Static Agent integration checks passed; rerun without --skip-live before claiming effective runtime readiness.");
  if (nextSteps.length === 0) nextSteps.push("Installed Agent usage path is current; start a new Agent session only if skills or AGENTS were changed during the current session.");

  return {
    schema: "browser67.agent-integration-doctor.v1",
    ok: selectedScopeReady,
    check: "agent-integration-doctor",
    readiness_basis: readinessBasis,
    release_artifact_ready: releaseArtifactReady,
    static_agent_usage_ready: staticReady,
    runtime_verified: runtime.verified,
    runtime_ready: runtime.ready,
    extension_installed_current: extensionInstalledCurrent,
    active_skill_current: activeSkillCurrent,
    instruction_route_current: instructionRouteCurrent,
    mcp_config_current: mcpConfig.ok,
    effective_agent_usage_ready: effectiveReady,
    skill_discovery_reload_policy: "start_new_agent_session_after_skill_or_AGENTS_sync",
    checks: {
      canonical: {
        missing: canonicalMissing,
        anchors: canonicalAnchors,
      },
      active_skills: probeReport(activeSkills),
      extension: probeReport(extension),
      global_agents: {
        path: options.globalAgents,
        present: Boolean(globalAgentsText),
        current: globalAgentsCurrent,
        anchors: globalAgentsAnchors,
      },
      project_agents: {
        path: options.projectAgents,
        present: Boolean(projectAgentsText),
        current: projectAgentsCurrent,
        anchors: projectAgentsAnchors,
      },
      mcp_config: mcpConfig,
      runtime,
    },
    next_steps: nextSteps,
  };
}

function formatText(report) {
  return [
    `agent_integration=${report.effective_agent_usage_ready ? "ready" : (report.ok ? "static_ready" : "not_ready")}`,
    `readiness_basis=${report.readiness_basis}`,
    `release_artifact_ready=${report.release_artifact_ready}`,
    `static_agent_usage_ready=${report.static_agent_usage_ready}`,
    `runtime_verified=${report.runtime_verified}`,
    `runtime_ready=${report.runtime_ready === null ? "skipped" : report.runtime_ready}`,
    `extension_installed_current=${report.extension_installed_current}`,
    `active_skill_current=${report.active_skill_current}`,
    `instruction_route_current=${report.instruction_route_current}`,
    `mcp_config_current=${report.mcp_config_current}`,
    `effective_agent_usage_ready=${report.effective_agent_usage_ready}`,
    "next_steps:",
    ...report.next_steps.map((item) => `  - ${item}`),
  ].join("\n");
}

function runCli() {
  try {
    const options = parseArgs(process.argv.slice(2));
    if (options.help) {
      process.stdout.write(`${usage()}\n`);
    } else {
      const report = buildReport(options);
      process.stdout.write(options.json ? `${JSON.stringify(report, null, 2)}\n` : `${formatText(report)}\n`);
      if (options.check && !report.ok) process.exitCode = 1;
    }
  } catch (error) {
    process.stderr.write(`agent-integration-doctor failed: ${String(error?.message ?? error)}\n`);
    process.exitCode = 1;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  runCli();
}

export {
  buildReport,
  instructionAnchors,
  mcpConfigStatus,
  parseArgs,
  payloadIdentity,
  runNodeScript,
  tomlSections,
};
