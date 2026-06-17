#!/usr/bin/env node

import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import { basename, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

import {
  ALL_OPTIONAL_LIVE_PROOF_REQUIREMENTS,
  buildProofRedactionChecklist,
  DEFAULT_OPTIONAL_LIVE_PROOF_DIR,
  validateProof,
} from "./optional-live-proof-audit.mjs";

const MAX_PROOF_BYTES = 256 * 1024;

function parseArgs(argv) {
  const parsed = {
    from_json: "",
    id: "",
    json: false,
    proof_dir: process.env.TMWD_OPTIONAL_PROOF_DIR || DEFAULT_OPTIONAL_LIVE_PROOF_DIR,
    replace: false,
    write: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index] ?? "";
    if (token === "--from-json" || token === "--input") {
      const value = String(argv[index + 1] ?? "").trim();
      if (!value || value.startsWith("--")) {
        throw new Error(`${token} requires a JSON file path`);
      }
      parsed.from_json = value;
      index += 1;
      continue;
    }
    if (token === "--id") {
      const value = String(argv[index + 1] ?? "").trim();
      if (!value || value.startsWith("--")) {
        throw new Error("--id requires a proof id");
      }
      parsed.id = value;
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
    if (token === "--replace") {
      parsed.replace = true;
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
  if (!parsed.id) {
    throw new Error("--id is required");
  }
  if (!parsed.from_json) {
    throw new Error("--from-json is required");
  }
  if (!parsed.proof_dir) {
    throw new Error("proof directory is required");
  }
  if (parsed.replace && !parsed.write) {
    throw new Error("--replace requires --write");
  }
  parsed.from_json = resolve(parsed.from_json);
  parsed.proof_dir = resolve(parsed.proof_dir);
  return parsed;
}

function requirementById(id) {
  const requirement = ALL_OPTIONAL_LIVE_PROOF_REQUIREMENTS.find((item) => item.id === id);
  if (!requirement) {
    throw new Error(`unknown optional proof id: ${id}`);
  }
  return requirement;
}

function proofFileName(requirement) {
  return `${requirement.id}.json`;
}

function sha256(text) {
  return createHash("sha256").update(text).digest("hex");
}

async function readProofInput(path) {
  const stat = await fs.stat(path);
  if (!stat.isFile()) {
    throw new Error(`input is not a file: ${path}`);
  }
  if (stat.size > MAX_PROOF_BYTES) {
    throw new Error(`input JSON is too large: ${stat.size} bytes > ${MAX_PROOF_BYTES}`);
  }
  const raw = await fs.readFile(path, "utf8");
  let proof;
  try {
    proof = JSON.parse(raw);
  } catch (error) {
    throw new Error(`invalid JSON: ${error instanceof Error ? error.message : String(error)}`);
  }
  return {
    proof,
    raw,
    size: stat.size,
  };
}

async function pathExists(path) {
  try {
    await fs.stat(path);
    return true;
  } catch (error) {
    if (error?.code === "ENOENT") {
      return false;
    }
    throw error;
  }
}

async function buildOptionalLiveProofRecord(args = {}) {
  const requirement = requirementById(args.id);
  const proofDir = resolve(args.proof_dir || process.env.TMWD_OPTIONAL_PROOF_DIR || DEFAULT_OPTIONAL_LIVE_PROOF_DIR);
  const inputPath = resolve(args.from_json);
  const targetPath = join(proofDir, proofFileName(requirement));
  const { proof, raw, size } = await readProofInput(inputPath);
  const validation = validateProof(proof, requirement);
  const redactionChecklist = buildProofRedactionChecklist(proof, requirement);
  const canonical_json = `${JSON.stringify(proof, null, 2)}\n`;
  const payload = {
    ok: validation.ok,
    action: "optional-live-proof-record",
    status: validation.ok ? "validated" : "invalid",
    id: requirement.id,
    type: requirement.type,
    proof_dir: proofDir,
    input_path: inputPath,
    target_path: targetPath,
    write: args.write === true,
    replace: args.replace === true,
    validation,
    redaction_checklist: redactionChecklist,
    input: {
      bytes: size,
      sha256: sha256(raw),
    },
    output: {
      bytes: Buffer.byteLength(canonical_json),
      sha256: sha256(canonical_json),
    },
    written: false,
  };

  if (!validation.ok || args.write !== true) {
    return payload;
  }

  await fs.mkdir(proofDir, { recursive: true });
  const existing = await pathExists(targetPath);
  if (existing && args.replace !== true) {
    return {
      ...payload,
      ok: false,
      status: "blocked_existing_proof",
      error: `refusing to overwrite existing proof: ${targetPath}`,
    };
  }

  await fs.writeFile(targetPath, canonical_json, { flag: args.replace === true ? "w" : "wx", mode: 0o600 });
  return {
    ...payload,
    status: "written",
    written: true,
  };
}

function outputText(payload) {
  process.stdout.write(
    `optional_live_proof_record=${payload.status} id=${payload.id} write=${payload.write} target=${payload.target_path}\n`,
  );
  process.stdout.write(`validation=${payload.validation.ok ? "ok" : "fail"}\n`);
  process.stdout.write(`redaction_checklist=${payload.redaction_checklist.ok ? "ok" : "fail"}\n`);
  if (!payload.validation.ok) {
    process.stdout.write(`errors=${payload.validation.errors.join(",")}\n`);
  }
  if (!payload.redaction_checklist.ok) {
    const failed = payload.redaction_checklist.checks
      .filter((item) => item.ok !== true)
      .map((item) => item.id)
      .join(",");
    process.stdout.write(`redaction_failures=${failed}\n`);
  }
  if (payload.error) {
    process.stdout.write(`error=${payload.error}\n`);
  }
  process.stdout.write(`input_sha256=${payload.input.sha256}\n`);
  process.stdout.write(`output_sha256=${payload.output.sha256}\n`);
}

async function runRecordCommand(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  const payload = await buildOptionalLiveProofRecord(args);
  if (args.json) {
    process.stdout.write(`${JSON.stringify(payload)}\n`);
  } else {
    outputText(payload);
  }
  process.exitCode = payload.ok ? 0 : 1;
  return payload;
}

if (import.meta.url === pathToFileURL(process.argv[1] || "").href) {
  try {
    await runRecordCommand();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const file = basename(process.argv[1] || "optional-live-proof-record.mjs");
    process.stderr.write(`${file} failed: ${message}\n`);
    process.exitCode = 1;
  }
}

export {
  buildOptionalLiveProofRecord,
  runRecordCommand,
};
