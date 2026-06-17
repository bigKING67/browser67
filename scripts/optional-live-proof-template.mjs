#!/usr/bin/env node

import { promises as fs } from "node:fs";
import { basename, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

import {
  ALL_OPTIONAL_LIVE_PROOF_REQUIREMENTS,
  DEFAULT_OPTIONAL_LIVE_PROOF_DIR,
} from "./optional-live-proof-audit.mjs";

function parseArgs(argv) {
  const parsed = {
    all: false,
    ids: [],
    json: false,
    proof_dir: process.env.TMWD_OPTIONAL_PROOF_DIR || DEFAULT_OPTIONAL_LIVE_PROOF_DIR,
    write: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index] ?? "";
    if (token === "--all") {
      parsed.all = true;
      continue;
    }
    if (token === "--id") {
      const value = String(argv[index + 1] ?? "").trim();
      if (!value || value.startsWith("--")) {
        throw new Error("--id requires a proof id");
      }
      parsed.ids.push(value);
      index += 1;
      continue;
    }
    if (token === "--json") {
      parsed.json = true;
      continue;
    }
    if (token === "--proof-dir") {
      const value = String(argv[index + 1] ?? "").trim();
      if (!value || value.startsWith("--")) {
        throw new Error("--proof-dir requires a directory");
      }
      parsed.proof_dir = value;
      index += 1;
      continue;
    }
    if (token === "--write") {
      parsed.write = true;
      continue;
    }
    if (!token) {
      continue;
    }
    throw new Error(`unknown argument: ${token}`);
  }
  if (!parsed.proof_dir) {
    throw new Error("proof directory is required");
  }
  parsed.proof_dir = resolve(parsed.proof_dir);
  return parsed;
}

function selectedRequirements(args) {
  if (args.all || args.ids.length === 0) {
    return ALL_OPTIONAL_LIVE_PROOF_REQUIREMENTS;
  }
  const byId = new Map(ALL_OPTIONAL_LIVE_PROOF_REQUIREMENTS.map((requirement) => [requirement.id, requirement]));
  return args.ids.map((id) => {
    const requirement = byId.get(id);
    if (!requirement) {
      throw new Error(`unknown optional proof id: ${id}`);
    }
    return requirement;
  });
}

function expiresAtFrom(checkedAt) {
  const date = new Date(checkedAt);
  date.setUTCDate(date.getUTCDate() + 90);
  return date.toISOString();
}

function createProofTemplate(requirement, now = new Date()) {
  const checkedAt = now.toISOString();
  if (requirement.type === "captcha_physical_live") {
    return {
      type: "captcha_physical_live",
      ok: false,
      template_only: true,
      platform: requirement.matches.platform,
      provider_id: "native-os",
      actions: ["drag", "click"],
      checked_at: checkedAt,
      expires_at: expiresAtFrom(checkedAt),
      command: "TMWD_CAPTCHA_ASSIST_PHYSICAL=1 TMWD_CAPTCHA_ASSIST_CONFIRM=1 npm run check:captcha-assist-physical-live",
      managed_tab_only: true,
      fixture: "local TMWD-owned managed tab",
      slider_completed: false,
      checkbox_completed: false,
      fullscreen_screenshot: false,
      js_cdp_widget_click: false,
      secrets_redacted: true,
      evidence: {
        assist_target: "slider",
        assist_targets: ["slider", "checkbox"],
        slider_visual_offset: null,
        slider_delta_live: null,
        handle_transform: null,
        checkbox_click_inside: null,
        checkbox_status_text: null,
        browser_private_state_access: false,
        notes: "This template is intentionally not accepted. Run the physical gate to generate a sanitized passing proof automatically.",
      },
    };
  }
  if (requirement.type === "native_live") {
    return {
      type: "native_live",
      ok: false,
      template_only: true,
      platform: requirement.matches.platform,
      provider_id: "native-os",
      actions: ["get_window_rect", "click", "drag"],
      checked_at: checkedAt,
      expires_at: expiresAtFrom(checkedAt),
      command: "TMWD_CAPTCHA_ASSIST_PHYSICAL=1 TMWD_CAPTCHA_ASSIST_CONFIRM=1 npm run check:captcha-assist-physical-live",
      evidence: {
        fixture: "local TMWD-owned managed tab",
        managed_tab_only: true,
        fullscreen_screenshot: false,
        secrets_redacted: true,
        notes: "Replace ok=false with ok=true only after this proof was produced by a real approved live gate.",
      },
    };
  }
  return {
    type: "idp_live",
    ok: false,
    template_only: true,
    provider_kind: requirement.matches.provider_kind,
    checked_at: checkedAt,
    expires_at: expiresAtFrom(checkedAt),
    command: `replace with exact approved external live gate command for ${requirement.id}`,
    manual_required_verified: false,
    resume_verified: false,
    evidence: {
      approved_provider: "redacted test tenant",
      profile_scope: "repo-external exact-origin profile",
      secrets_redacted: true,
      notes: "Set ok/manual_required_verified/resume_verified to true only after a real approved external provider live gate passes.",
    },
  };
}

function templateFileName(requirement) {
  return `${requirement.id}.template.json`;
}

async function writeTemplates(proofDir, templates) {
  await fs.mkdir(proofDir, { recursive: true });
  const paths = templates.map(({ requirement }) => join(proofDir, templateFileName(requirement)));
  await Promise.all(paths.map(async (path) => {
    try {
      await fs.stat(path);
    } catch (error) {
      if (error?.code === "ENOENT") {
        return;
      }
      throw error;
    }
    throw new Error(`refusing to overwrite existing proof template: ${path}`);
  }));
  return Promise.all(templates.map(async ({ template }, index) => {
    const path = paths[index];
    await fs.writeFile(path, `${JSON.stringify(template, null, 2)}\n`, { flag: "wx" });
    return path;
  }));
}

function buildOutput({ args, templates, written = [] }) {
  return {
    ok: true,
    action: "optional-live-proof-template",
    proof_dir: args.proof_dir,
    template_count: templates.length,
    templates: templates.map(({ requirement, template }, index) => ({
      id: requirement.id,
      title: requirement.title,
      file_name: templateFileName(requirement),
      written_path: written[index],
      template,
    })),
  };
}

function outputText(payload) {
  process.stdout.write(
    `optional_live_proof_templates=${payload.template_count} proof_dir=${payload.proof_dir}\n`,
  );
  for (const template of payload.templates) {
    const target = template.written_path || template.file_name;
    process.stdout.write(`- ${template.id}: ${target}\n`);
  }
  if (!payload.templates.some((template) => template.written_path)) {
    process.stdout.write("\n");
    process.stdout.write(JSON.stringify(
      Object.fromEntries(payload.templates.map((template) => [template.id, template.template])),
      null,
      2,
    ));
    process.stdout.write("\n");
  }
}

async function runTemplateCommand(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  const templates = selectedRequirements(args).map((requirement) => ({
    requirement,
    template: createProofTemplate(requirement),
  }));
  const written = args.write ? await writeTemplates(args.proof_dir, templates) : [];
  const payload = buildOutput({ args, templates, written });
  if (args.json) {
    process.stdout.write(`${JSON.stringify(payload)}\n`);
  } else {
    outputText(payload);
  }
  return payload;
}

if (import.meta.url === pathToFileURL(process.argv[1] || "").href) {
  try {
    await runTemplateCommand();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const file = basename(process.argv[1] || "optional-live-proof-template.mjs");
    process.stderr.write(`${file} failed: ${message}\n`);
    process.exitCode = 1;
  }
}

export {
  createProofTemplate,
  runTemplateCommand,
};
