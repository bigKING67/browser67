import { createHash, randomBytes } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { nowIso } from "../runtime/identity.mjs";
import { readPngDimensions } from "../image/png-lite.mjs";
import {
  finishRun,
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

async function resolveScreenshotRun(args = {}, target = "viewport", options = {}) {
  const rawRunId = String(args.run_id ?? "").trim();
  if (rawRunId) {
    const runDir = runDirFor(args, options);
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
        mode: "explicit",
        auto_finish: false,
      };
    }
    if (args.prepare_run !== false) {
      const prepared = await prepareRun({
        ...args,
        title: args.title ?? `browser screenshot ${target}`,
      }, options);
      return {
        run: prepared.run,
        prepared: true,
        mode: "explicit",
        auto_finish: false,
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
      mode: "explicit_untracked",
      auto_finish: false,
    };
  }

  if (args.prepare_run === false) {
    const stamp = new Date().toISOString().replace(/[-:.]/g, "").replace("T", "T").replace("Z", "Z");
    const runId = `adhoc-${stamp}-${randomBytes(4).toString("hex")}`;
    const runDir = path.join(runRoot(options), runGroup(args), runId);
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
      mode: "adhoc",
      auto_finish: false,
    };
  }

  const prepared = await prepareRun({
    ...args,
    title: args.title ?? `browser screenshot ${target}`,
  }, options);
  return {
    run: prepared.run,
    prepared: true,
    mode: "implicit",
    auto_finish: true,
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
  run_options = {},
}) {
  if (!Buffer.isBuffer(bytes) || bytes.length === 0) {
    throw new Error("screenshot artifact requires non-empty PNG bytes");
  }
  const dimensions = readPngDimensions(bytes);
  const resolution = await resolveScreenshotRun(args, target, run_options);
  const { run, prepared, mode, auto_finish: autoFinish } = resolution;
  const artifactPath = path.join(run.artifacts_dir, screenshotFileName(target, title));
  try {
    await mkdir(run.artifacts_dir, { recursive: true });
    await writeFile(artifactPath, bytes);
  } catch (error) {
    if (autoFinish) {
      await finishRun({
        workspace_key: run.workspace_key,
        task_id: run.task_id,
        group: run.group,
        run_id: run.run_id,
        status: "failed",
        data: {
          artifact_count: 0,
          artifact_kind: "screenshot",
          error: String(error?.message ?? error),
        },
      }, run_options).catch(() => {});
    }
    throw error;
  }
  const createdAt = nowIso();
  let finalRun = run;
  let terminalized = false;
  if (autoFinish) {
    const finished = await finishRun({
      workspace_key: run.workspace_key,
      task_id: run.task_id,
      group: run.group,
      run_id: run.run_id,
      status: "success",
      data: {
        artifact_count: 1,
        artifact_kind: "screenshot",
      },
    }, run_options);
    if (finished?.ok !== true || !finished.run) {
      throw new Error(`implicit screenshot run could not be finished: ${String(finished?.error ?? "unknown error")}`);
    }
    finalRun = finished.run;
    terminalized = true;
  }
  return {
    run: finalRun,
    run_prepared: prepared,
    run_mode: mode,
    run_terminalized: terminalized,
    run_requires_finish: Boolean(mode === "explicit" && finalRun.status === "running"),
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
