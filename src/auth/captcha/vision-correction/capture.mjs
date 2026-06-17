import { createHash, randomBytes } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import {
  executeTmwdJsWithFallback,
  resolvePreferredBrowserContext,
} from "../../../tmwd-runtime.mjs";
import {
  finiteNumber,
  roundCoordinate,
} from "../coordinates.mjs";
import { decodePng } from "../png-lite.mjs";
import { CAPTURE_DIR } from "./constants.mjs";

function extractScreenshotData(executed = {}) {
  const raw = executed.raw;
  const value = executed.value;
  return value?.data
    ?? value?.result?.data
    ?? raw?.data?.data
    ?? raw?.result?.data
    ?? raw?.data
    ?? raw?.result;
}

async function captureCdpRegion(args = {}, clip = {}, pageState = {}) {
  const preferred = await resolvePreferredBrowserContext(args ?? {});
  if (preferred.transport !== "tmwd_ws" && preferred.transport !== "tmwd_link") {
    throw new Error(`TMWD region capture requires TMWD transport, got ${preferred.transport}`);
  }
  const scrollX = finiteNumber(pageState.viewport?.scroll_x) ?? 0;
  const scrollY = finiteNumber(pageState.viewport?.scroll_y) ?? 0;
  const cdpClip = {
    ...clip,
    x: roundCoordinate(clip.x + scrollX),
    y: roundCoordinate(clip.y + scrollY),
  };
  const result = await executeTmwdJsWithFallback(args ?? {}, preferred.context, {
    cmd: "cdp",
    method: "Page.captureScreenshot",
    params: {
      format: "png",
      fromSurface: true,
      clip: cdpClip,
    },
  });
  const base64 = extractScreenshotData(result.executed);
  if (typeof base64 !== "string" || base64.length < 16) {
    throw new Error("Page.captureScreenshot did not return PNG data");
  }
  const bytes = Buffer.from(base64, "base64");
  const decoded = decodePng(bytes);
  await mkdir(CAPTURE_DIR, { recursive: true });
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  const fileName = `captcha-region-${Date.now()}-${randomBytes(4).toString("hex")}.png`;
  const artifactPath = path.join(CAPTURE_DIR, fileName);
  const createdAtMs = Date.now();
  await writeFile(artifactPath, bytes);
  return {
    provider_id: "tmwd-cdp",
    method: "Page.captureScreenshot",
    transport: result.context.tmwd_transport === "ws" ? "tmwd_ws" : "tmwd_link",
    transport_attempts: result.transport_attempts,
    artifact: {
      path: artifactPath,
      sha256,
      mime_type: "image/png",
      bytes: bytes.length,
      width: decoded.width,
      height: decoded.height,
      clip,
      cdp_clip: cdpClip,
      fullscreen: false,
      ttl_ms: 600_000,
      created_at: new Date(createdAtMs).toISOString(),
      expires_at: new Date(createdAtMs + 600_000).toISOString(),
    },
    image: decoded,
  };
}

export {
  captureCdpRegion,
};
