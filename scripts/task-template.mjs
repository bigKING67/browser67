#!/usr/bin/env node

import { readdir, readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const templateDir = resolve(repoRoot, "templates", "tasks");
const REQUIRED_TEMPLATE_IDS = new Set(["browser-run", "js-reverse-task"]);

function parseArgs(argv) {
  const [command = "list", ...rest] = argv;
  const parsed = {
    command,
    json: rest.includes("--json"),
    values: {
      title: "TMWD task",
      workspace_key: "tmwd-workspace",
      task_id: "tmwd-task",
      url: "https://example.test/",
      wait_selector: "body",
      keywords: "sign|token|api",
    },
  };
  for (let index = 0; index < rest.length; index += 1) {
    const token = rest[index] ?? "";
    if (token === "--json") {
      continue;
    }
    if (token === "--template") {
      parsed.template = rest[index + 1] ?? "";
      index += 1;
      continue;
    }
    if (token.startsWith("--")) {
      const key = token.slice(2).replace(/-/g, "_");
      parsed.values[key] = rest[index + 1] ?? "";
      index += 1;
      continue;
    }
    throw new Error(`unknown argument: ${token}`);
  }
  return parsed;
}

async function loadTemplates() {
  const entries = await readdir(templateDir, { withFileTypes: true });
  const templates = [];
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith(".json")) {
      continue;
    }
    const filePath = resolve(templateDir, entry.name);
    const template = JSON.parse(await readFile(filePath, "utf8"));
    templates.push({
      ...template,
      file: filePath,
    });
  }
  templates.sort((left, right) => String(left.id).localeCompare(String(right.id)));
  return templates;
}

function validateTemplate(template) {
  const errors = [];
  if (template.schema_version !== "tmwd.task_template.v1") errors.push("schema_version");
  if (!template.id || typeof template.id !== "string") errors.push("id");
  if (!template.title || typeof template.title !== "string") errors.push("title");
  if (!Array.isArray(template.steps) || template.steps.length === 0) errors.push("steps");
  for (const [index, step] of (template.steps ?? []).entries()) {
    if (!step?.tool || typeof step.tool !== "string") errors.push(`steps.${index}.tool`);
    if (!step?.arguments || typeof step.arguments !== "object") errors.push(`steps.${index}.arguments`);
  }
  return errors;
}

function renderValue(value, context) {
  if (typeof value === "string") {
    return value.replace(/\{\{([a-zA-Z0-9_-]+)\}\}/g, (_match, key) => String(context[key] ?? ""));
  }
  if (Array.isArray(value)) {
    return value.map((item) => renderValue(item, context));
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, renderValue(item, context)]));
  }
  return value;
}

async function commandList(args) {
  const templates = await loadTemplates();
  const rows = templates.map((template) => ({
    id: template.id,
    title: template.title,
    description: template.description,
    steps: Array.isArray(template.steps) ? template.steps.length : 0,
    file: template.file,
  }));
  if (args.json) {
    process.stdout.write(`${JSON.stringify({ ok: true, templates: rows })}\n`);
  } else {
    for (const row of rows) {
      process.stdout.write(`${row.id}: ${row.title} (${row.steps} steps)\n`);
    }
  }
  return 0;
}

async function commandCheck(args) {
  const templates = await loadTemplates();
  const ids = new Set(templates.map((template) => template.id));
  const rows = templates.map((template) => ({
    id: template.id,
    file: template.file,
    errors: validateTemplate(template),
  }));
  for (const requiredId of REQUIRED_TEMPLATE_IDS) {
    if (!ids.has(requiredId)) {
      rows.push({ id: requiredId, file: "", errors: ["missing"] });
    }
  }
  const ok = rows.every((row) => row.errors.length === 0);
  if (args.json) {
    process.stdout.write(`${JSON.stringify({ ok, templates: rows })}\n`);
  } else {
    for (const row of rows) {
      process.stdout.write(`${row.errors.length === 0 ? "OK" : "FAIL"} ${row.id} ${row.errors.join(",")}\n`);
    }
  }
  return ok ? 0 : 1;
}

async function commandRender(args) {
  const templates = await loadTemplates();
  const template = templates.find((entry) => entry.id === args.template);
  if (!template) {
    throw new Error(`template not found: ${args.template || "(missing)"}`);
  }
  const rendered = renderValue(template, args.values);
  delete rendered.file;
  process.stdout.write(`${JSON.stringify({ ok: true, template: rendered }, null, args.json ? 0 : 2)}\n`);
  return 0;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.command === "list") return commandList(args);
  if (args.command === "check") return commandCheck(args);
  if (args.command === "render") return commandRender(args);
  throw new Error(`unknown command: ${args.command}`);
}

try {
  process.exitCode = await main();
} catch (error) {
  process.stderr.write(`task-template failed: ${String(error?.message ?? error)}\n`);
  process.exitCode = 1;
}
