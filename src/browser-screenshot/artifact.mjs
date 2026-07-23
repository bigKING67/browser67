import { createHash, randomBytes } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { nowIso } from "../runtime/identity.mjs";
import { readPngDimensions } from "../image/png-lite.mjs";
import {
  prepareRun,
  runDirFor,
  runRoot,
} from "../runtime/runs/lifecycle.mjs";

const SCREENSHOT_ARTIFACT_TTL_MS = 86_400_000;

function safeSegment(value, fallback = "screenshot") {
  const normalized = String(value ?? "")
    .trim()
    .replace(/[^a-zA-Z0-9_.-]/g, "_")
    .replace(/_+/g, "_")
    .slice(0, 80);
  return normalized || fallback;
}

function runGroup(args = {}) {
  return safeSegment(args.workspace_key ?? args.task_id ?? args.group ?? "screenshots", "screenshots");
}

async function readRunJson(runDir) {
  try {
    return JSON.parse(await readFile(path.join(runDir, "run.json"), "utf8"));
  } catch (error) {
    if (error?.code === "ENOENT") {
      return null;
    }
    throw error;
  }
}

async function resolveScreenshotRun(args = {}, target = "viewport") {
  const rawRunId = String(args.run_id ?? "").trim();
  if (rawRunId) {
    const runDir = runDirFor(args);
    const existing = await readRunJson(runDir);
    if (existing && typeof existing === "object") {
      const artifactsDir = String(existing.artifacts_dir ?? path.join(runDir, "artifacts"));
      await mkdir(artifactsDir, { recursive: true });
      return {
        run: {
          ...existing,
          run_dir: String(existing.run_dir ?? runDir),
          artifacts_dir: artifactsDir,
        },
        prepared: false,
      };
    }
    if (args.prepare_run !== false) {
      const prepared = await prepareRun({
        ...args,
        title: args.title ?? `browser screenshot ${target}`,
      });
      return {
        run: prepared.run,
        prepared: true,
      };
    }
    const artifactsDir = path.join(runDir, "artifacts");
    await mkdir(artifactsDir, { recursive: true });
    return {
      run: {
        run_id: safeSegment(rawRunId),
        group: runGroup(args),
        workspace_key: String(args.workspace_key ?? ""),
        task_id: String(args.task_id ?? ""),
        title: String(args.title ?? ""),
        run_dir: runDir,
        artifacts_dir: artifactsDir,
      },
      prepared: false,
    };
  }

  if (args.prepare_run === false) {
    const stamp = new Date().toISOString().replace(/[-:.]/g, "").replace("T", "T").replace("Z", "Z");
    const runId = `adhoc-${stamp}-${randomBytes(4).toString("hex")}`;
    const runDir = path.join(runRoot(), runGroup(args), runId);
    const artifactsDir = path.join(runDir, "artifacts");
    await mkdir(artifactsDir, { recursive: true });
    return {
      run: {
        run_id: runId,
        group: runGroup(args),
        workspace_key: String(args.workspace_key ?? ""),
        task_id: String(args.task_id ?? ""),
        title: String(args.title ?? ""),
        run_dir: runDir,
        artifacts_dir: artifactsDir,
      },
      prepared: false,
    };
  }

  const prepared = await prepareRun({
    ...args,
    title: args.title ?? `browser screenshot ${target}`,
  });
  return {
    run: prepared.run,
    prepared: true,
  };
}

function screenshotFileName(target, title) {
  const stamp = new Date().toISOString().replace(/[-:.]/g, "").replace("T", "T").replace("Z", "Z");
  const titlePart = safeSegment(title, "");
  const suffix = randomBytes(4).toString("hex");
  const parts = ["screenshot", safeSegment(target, "viewport"), titlePart, stamp, suffix].filter(Boolean);
  return `${parts.join("-")}.png`;
}

async function writeScreenshotArtifact({
  args = {},
  bytes,
  target = "viewport",
  title = "",
  clip = null,
  cdpClip = null,
}) {
  if (!Buffer.isBuffer(bytes) || bytes.length === 0) {
    throw new Error("screenshot artifact requires non-empty PNG bytes");
  }
  const dimensions = readPngDimensions(bytes);
  const { run, prepared } = await resolveScreenshotRun(args, target);
  await mkdir(run.artifacts_dir, { recursive: true });
  const artifactPath = path.join(run.artifacts_dir, screenshotFileName(target, title));
  await writeFile(artifactPath, bytes);
  const createdAt = nowIso();
  return {
    run,
    run_prepared: prepared,
    artifact: {
      path: artifactPath,
      sha256: createHash("sha256").update(bytes).digest("hex"),
      mime_type: "image/png",
      bytes: bytes.length,
      width: dimensions.width,
      height: dimensions.height,
      clip,
      cdp_clip: cdpClip,
      fullscreen: false,
      created_at: createdAt,
      ttl_ms: SCREENSHOT_ARTIFACT_TTL_MS,
      expires_at: new Date(Date.parse(createdAt) + SCREENSHOT_ARTIFACT_TTL_MS).toISOString(),
    },
  };
}

export {
  SCREENSHOT_ARTIFACT_TTL_MS,
  writeScreenshotArtifact,
};
