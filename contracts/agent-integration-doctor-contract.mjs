#!/usr/bin/env node

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  cpSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";

import { runNodeScript } from "../scripts/agent-integration-doctor.mjs";

const repoRoot = path.resolve(import.meta.dirname, "..");
const doctorScript = path.resolve(repoRoot, "scripts/agent-integration-doctor.mjs");

function writeAgents(filePath) {
  writeFileSync(filePath, [
    "Use browser67 through tmwd_browser.",
    "For an exact user tab, run inspect_adoption -> adopt_existing only after an explicit request.",
    "End the current workspace_key with scoped finalize_task.",
    "Login-state work must fail closed and must not silently use remote CDP.",
    "",
  ].join("\n"), "utf8");
}

function writeConfig(filePath) {
  writeFileSync(filePath, [
    "[mcp_servers.tmwd_browser]",
    'command = "node"',
    'args = ["/fixture/browser67/src/mcp/browser/server.mjs"]',
    "",
    "[mcp_servers.js-reverse]",
    'command = "node"',
    'args = ["/fixture/browser67/src/mcp/js-reverse/server.mjs"]',
    "",
  ].join("\n"), "utf8");
}

function writeMisboundConfig(filePath) {
  writeFileSync(filePath, [
    "[mcp_servers.tmwd_browser]",
    'command = "node"',
    'args = ["/fixture/browser67/src/mcp/js-reverse/server.mjs"]',
    "",
    "[mcp_servers.js-reverse]",
    'command = "node"',
    'args = ["/fixture/browser67/src/mcp/browser/server.mjs"]',
    "",
  ].join("\n"), "utf8");
}

function writeCommentOnlyConfig(filePath) {
  writeFileSync(filePath, [
    "# /fixture/browser67/src/mcp/browser/server.mjs",
    "# /fixture/browser67/src/mcp/js-reverse/server.mjs",
    "[mcp_servers.tmwd_browser]",
    'command = "node"',
    'args = ["/fixture/wrong-browser-entrypoint.mjs"] # src/mcp/browser/server.mjs',
    "",
    "[mcp_servers.js-reverse]",
    'command = "node"',
    'args = ["/fixture/wrong-js-reverse-entrypoint.mjs"] # src/mcp/js-reverse/server.mjs',
    "",
    "[[hooks.PostToolUse]]",
    'matcher = "src/mcp/browser/server.mjs"',
    'command = "src/mcp/js-reverse/server.mjs"',
    "",
  ].join("\n"), "utf8");
}

function writeDuplicateConfig(filePath) {
  writeFileSync(filePath, [
    "[mcp_servers.tmwd_browser]",
    'command = "node"',
    'args = ["/fixture/browser67/src/mcp/browser/server.mjs"]',
    "",
    "[mcp_servers.tmwd_browser]",
    'command = "node"',
    'args = ["/fixture/wrong-browser-entrypoint.mjs"]',
    "",
    "[mcp_servers.js-reverse]",
    'command = "node"',
    'args = ["/fixture/browser67/src/mcp/js-reverse/server.mjs"]',
    "",
  ].join("\n"), "utf8");
}

function writeProbe(filePath, payload, { exitCode = 0, keepAliveMs = 0 } = {}) {
  writeFileSync(filePath, [
    `process.stdout.write(${JSON.stringify(`${JSON.stringify(payload)}\n`)});`,
    keepAliveMs > 0 ? `setTimeout(() => {}, ${keepAliveMs});` : "",
    exitCode === 0 ? "" : `process.exitCode = ${exitCode};`,
    "",
  ].filter(Boolean).join("\n"), "utf8");
}

function writeExtension(sourceDir) {
  mkdirSync(sourceDir, { recursive: true });
  writeFileSync(path.resolve(sourceDir, "manifest.json"), JSON.stringify({
    manifest_version: 3,
    name: "browser67 Agent doctor fixture",
    version: "0.0.0",
  }, null, 2), "utf8");
  writeFileSync(path.resolve(sourceDir, "background.js"), "globalThis.browser67Fixture = true;\n", "utf8");
  writeFileSync(path.resolve(sourceDir, "config.example.js"), "const TID = '__fixture';\n", "utf8");
}

function run(baseArgs, expectedStatus = 0) {
  const result = spawnSync(process.execPath, [doctorScript, ...baseArgs], {
    cwd: repoRoot,
    encoding: "utf8",
    timeout: 45_000,
  });
  if (result.status !== expectedStatus) {
    throw new Error(`agent doctor failed status=${result.status}: ${String(result.stderr || result.stdout).trim()}`);
  }
  return JSON.parse(String(result.stdout ?? "").trim());
}

function main() {
  const tempRoot = mkdtempSync(path.join(os.tmpdir(), "browser67-agent-doctor-"));
  try {
    const activeSkills = path.resolve(tempRoot, "skills");
    const extensionSource = path.resolve(tempRoot, "extension-source");
    const extensionTarget = path.resolve(tempRoot, "extension-target");
    const globalAgents = path.resolve(tempRoot, "global-AGENTS.md");
    const projectAgents = path.resolve(tempRoot, "project-AGENTS.md");
    const codexConfig = path.resolve(tempRoot, "config.toml");

    mkdirSync(activeSkills, { recursive: true });
    for (const skill of ["browser67", "tmwd-browser-mcp", "js-reverse"]) {
      cpSync(path.resolve(repoRoot, "skills", skill), path.resolve(activeSkills, skill), { recursive: true });
    }
    writeExtension(extensionSource);
    cpSync(extensionSource, extensionTarget, { recursive: true });
    writeAgents(globalAgents);
    writeAgents(projectAgents);
    writeConfig(codexConfig);

    const baseArgs = [
      "--json",
      "--check",
      "--skip-live",
      "--active-skills-dir",
      activeSkills,
      "--extension-source",
      extensionSource,
      "--extension-target",
      extensionTarget,
      "--global-agents",
      globalAgents,
      "--project-agents",
      projectAgents,
      "--codex-config",
      codexConfig,
    ];

    const ready = run(baseArgs);
    assert.equal(ready.ok, true);
    assert.equal(ready.release_artifact_ready, true);
    assert.equal(ready.readiness_basis, "static_only");
    assert.equal(ready.static_agent_usage_ready, true);
    assert.equal(ready.runtime_verified, false);
    assert.equal(ready.runtime_ready, null);
    assert.equal(ready.extension_installed_current, true);
    assert.equal(ready.active_skill_current, true);
    assert.equal(ready.instruction_route_current, true);
    assert.equal(ready.mcp_config_current, true);
    assert.equal(ready.effective_agent_usage_ready, false);
    assert.match(ready.next_steps.join("\n"), /rerun without --skip-live/);

    const activeSkillPath = path.resolve(activeSkills, "browser67", "SKILL.md");
    writeFileSync(activeSkillPath, `${readFileSync(activeSkillPath, "utf8")}\nfixture drift\n`, "utf8");
    const skillDrift = run(baseArgs, 1);
    assert.equal(skillDrift.active_skill_current, false);
    assert.equal(skillDrift.effective_agent_usage_ready, false);
    assert.match(skillDrift.next_steps.join("\n"), /skills:active:sync/);

    cpSync(path.resolve(repoRoot, "skills", "browser67", "SKILL.md"), activeSkillPath, { force: true });
    writeFileSync(projectAgents, "Use browser67 through tmwd_browser but leave user tabs unmanaged.\n", "utf8");
    const routeDrift = run(baseArgs, 1);
    assert.equal(routeDrift.instruction_route_current, false);
    assert.equal(routeDrift.checks.project_agents.anchors.explicit_adoption, false);

    writeAgents(projectAgents);
    writeFileSync(path.resolve(extensionTarget, "background.js"), "globalThis.browser67Fixture = 'stale';\n", "utf8");
    const extensionDrift = run(baseArgs, 1);
    assert.equal(extensionDrift.extension_installed_current, false);
    assert.equal(extensionDrift.effective_agent_usage_ready, false);

    cpSync(extensionSource, extensionTarget, { recursive: true, force: true });
    writeMisboundConfig(codexConfig);
    const mcpMisbinding = run(baseArgs, 1);
    assert.equal(mcpMisbinding.mcp_config_current, false);
    assert.equal(mcpMisbinding.checks.mcp_config.checks.tmwd_server_registered, true);
    assert.equal(mcpMisbinding.checks.mcp_config.checks.js_reverse_server_registered, true);
    assert.equal(mcpMisbinding.checks.mcp_config.checks.tmwd_canonical_entrypoint, false);
    assert.equal(mcpMisbinding.checks.mcp_config.checks.js_reverse_canonical_entrypoint, false);

    writeCommentOnlyConfig(codexConfig);
    const mcpCommentOnly = run(baseArgs, 1);
    assert.equal(mcpCommentOnly.mcp_config_current, false);
    assert.equal(mcpCommentOnly.checks.mcp_config.checks.tmwd_canonical_entrypoint, false);
    assert.equal(mcpCommentOnly.checks.mcp_config.checks.js_reverse_canonical_entrypoint, false);

    writeDuplicateConfig(codexConfig);
    const mcpDuplicate = run(baseArgs, 1);
    assert.equal(mcpDuplicate.mcp_config_current, false);
    assert.equal(mcpDuplicate.checks.mcp_config.checks.tmwd_server_registered, false);
    assert.equal(mcpDuplicate.checks.mcp_config.checks.tmwd_canonical_entrypoint, true);

    const expectedProbeIdentity = {
      check: "fixture-probe",
      schema: "fixture-probe.v1",
    };
    const nonzeroProbeScript = path.resolve(tempRoot, "probe-nonzero.mjs");
    writeProbe(nonzeroProbeScript, { ok: true, ...expectedProbeIdentity }, { exitCode: 7 });
    const nonzeroProbe = runNodeScript(nonzeroProbeScript, [], { expected: expectedProbeIdentity });
    assert.equal(nonzeroProbe.process_ok, false);
    assert.equal(nonzeroProbe.identity_ok, true);
    assert.equal(nonzeroProbe.ok, false);

    const wrongSchemaProbeScript = path.resolve(tempRoot, "probe-wrong-schema.mjs");
    writeProbe(wrongSchemaProbeScript, {
      ok: true,
      check: "fixture-probe",
      schema: "fixture-probe.v999",
    });
    const wrongSchemaProbe = runNodeScript(wrongSchemaProbeScript, [], { expected: expectedProbeIdentity });
    assert.equal(wrongSchemaProbe.process_ok, true);
    assert.equal(wrongSchemaProbe.identity_ok, false);
    assert.equal(wrongSchemaProbe.identity_checks.check, true);
    assert.equal(wrongSchemaProbe.identity_checks.schema, false);
    assert.equal(wrongSchemaProbe.ok, false);

    const timeoutProbeScript = path.resolve(tempRoot, "probe-timeout.mjs");
    writeProbe(timeoutProbeScript, { ok: true, ...expectedProbeIdentity }, { keepAliveMs: 1_000 });
    const timeoutProbe = runNodeScript(timeoutProbeScript, [], {
      expected: expectedProbeIdentity,
      timeout: 25,
    });
    assert.equal(timeoutProbe.process_ok, false);
    assert.equal(timeoutProbe.ok, false);
    assert.equal(timeoutProbe.error_code, "ETIMEDOUT");

    process.stdout.write(`${JSON.stringify({
      ok: true,
      check: "agent-integration-doctor-contract",
      scenarios: [
        "static-ready-not-effective",
        "active-skill-drift",
        "instruction-route-drift",
        "extension-drift",
        "mcp-misbinding",
        "mcp-comment-only",
        "mcp-duplicate-section",
        "nonzero-success-payload",
        "wrong-schema",
        "timeout",
      ],
    })}\n`);
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
  }
}

try {
  main();
} catch (error) {
  process.stderr.write(`agent-integration-doctor-contract failed: ${String(error?.message ?? error)}\n`);
  process.exitCode = 1;
}
