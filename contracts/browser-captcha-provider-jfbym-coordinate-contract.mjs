#!/usr/bin/env node
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import {
  JFBYM_ENV_FILE,
} from "../src/auth/captcha/providers/config.mjs";
import {
  materializeJfbymCoordinateResult,
  parseJfbymCoordinateResponse,
  solveJfbymCoordinateChallenge,
} from "../src/auth/captcha/providers/jfbym-coordinate.mjs";

const ENV_KEYS = [
  "TMWD_CAPTCHA_PROVIDER_CONFIG_DIR",
  "TMWD_CAPTCHA_PROVIDER_JFBYM_ENABLED",
  "TMWD_CAPTCHA_PROVIDER_JFBYM_BASE_URL",
  "TMWD_CAPTCHA_PROVIDER_JFBYM_TOKEN",
  "TMWD_CAPTCHA_PROVIDER_JFBYM_TIMEOUT_MS",
  "TMWD_CAPTCHA_PROVIDER_JFBYM_MAX_ATTEMPTS",
  "TMWD_CAPTCHA_PROVIDER_JFBYM_MIN_CONFIDENCE",
  "TMWD_CAPTCHA_PROVIDER_JFBYM_ALLOWED_ORIGINS",
  "TMWD_CAPTCHA_PROVIDER_JFBYM_ALLOWED_KINDS",
  "TMWD_CAPTCHA_PROVIDER_JFBYM_COORDINATE_SOLVER",
  "TMWD_CAPTCHA_PROVIDER_JFBYM_PROTOCOL_SOLVER",
  "TMWD_CAPTCHA_PROVIDER_JFBYM_SLIDER_RESULT_MODE",
  "TMWD_CAPTCHA_PROVIDER_JFBYM_TYPE_CHECKBOX",
  "TMWD_CAPTCHA_PROVIDER_JFBYM_TYPE_SLIDER",
  "TMWD_CAPTCHA_PROVIDER_JFBYM_TYPE_HCAPTCHA",
];

function snapshotEnv() {
  return Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]));
}

function restoreEnv(snapshot) {
  for (const key of ENV_KEYS) {
    if (snapshot[key] === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = snapshot[key];
    }
  }
}

function clearEnv() {
  for (const key of ENV_KEYS) {
    delete process.env[key];
  }
}

function fixtureArtifact(filePath) {
  return {
    path: filePath,
    sha256: "fixture-sha256",
    mime_type: "image/png",
    bytes: 12,
    width: 100,
    height: 50,
    clip: {
      x: 10,
      y: 20,
      width: 200,
      height: 100,
      scale: 1,
      coordinate_system: "viewport_css_pixels",
    },
    fullscreen: false,
  };
}

function fixtureViewport() {
  return {
    inner_width: 1200,
    inner_height: 800,
    outer_width: 1200,
    outer_height: 800,
    screen_x: 100,
    screen_y: 200,
    visual_viewport: {
      offset_left: 0,
      offset_top: 0,
      scale: 1,
    },
  };
}

function checkboxPlan(filePath, origin = "https://dy.feigua.cn") {
  return {
    origin,
    captcha_kind: "hcaptcha",
    assist_target: "checkbox",
    viewport: fixtureViewport(),
    coordinate_transform: {
      vision_correction: {
        artifact: fixtureArtifact(filePath),
      },
    },
  };
}

function sliderPlan(filePath) {
  return {
    origin: "https://dy.feigua.cn",
    captcha_kind: "slider",
    assist_target: "slider",
    viewport: fixtureViewport(),
    slider_drag_hint: {
      from_client: {
        x: 20,
        y: 50,
      },
    },
    coordinate_transform: {
      vision_correction: {
        artifact: fixtureArtifact(filePath),
      },
    },
  };
}

async function writeProviderConfig(configDir, fakeToken) {
  await writeFile(
    path.join(configDir, JFBYM_ENV_FILE),
    [
      "TMWD_CAPTCHA_PROVIDER_JFBYM_ENABLED=1",
      `TMWD_CAPTCHA_PROVIDER_JFBYM_TOKEN=${fakeToken}`,
      "TMWD_CAPTCHA_PROVIDER_JFBYM_ALLOWED_ORIGINS=https://dy.feigua.cn",
      "TMWD_CAPTCHA_PROVIDER_JFBYM_ALLOWED_KINDS=checkbox,slider,hcaptcha",
      "TMWD_CAPTCHA_PROVIDER_JFBYM_COORDINATE_SOLVER=1",
      "TMWD_CAPTCHA_PROVIDER_JFBYM_PROTOCOL_SOLVER=0",
      "TMWD_CAPTCHA_PROVIDER_JFBYM_MIN_CONFIDENCE=0.65",
      "TMWD_CAPTCHA_PROVIDER_JFBYM_TYPE_HCAPTCHA=30009",
      "TMWD_CAPTCHA_PROVIDER_JFBYM_TYPE_SLIDER=20110",
      "",
    ].join("\n"),
    { mode: 0o600 },
  );
}

async function run() {
  const previousEnv = snapshotEnv();
  const tmpDir = await mkdtemp(path.join(os.tmpdir(), "tmwd-jfbym-coordinate-contract-"));
  const fakeToken = "coordinate-contract-token-must-not-appear";
  try {
    clearEnv();
    const imagePath = path.join(tmpDir, "region.png");
    await writeFile(imagePath, Buffer.from("not-a-real-png"));
    await writeProviderConfig(tmpDir, fakeToken);

    const parsedCheckbox = parseJfbymCoordinateResponse({
      code: 10000,
      msg: "ok",
      data: { data: "25,10" },
      confidence: 0.91,
    }, {
      captcha_kind: "hcaptcha",
      min_confidence: 0.65,
    });
    assert.equal(parsedCheckbox.ok, true);
    assert.equal(parsedCheckbox.parsed_kind, "checkbox");

    const materializedCheckbox = materializeJfbymCoordinateResult(parsedCheckbox, {
      plan: checkboxPlan(imagePath),
      artifact: fixtureArtifact(imagePath),
    });
    assert.equal(materializedCheckbox.ok, true);
    assert.equal(Math.round(materializedCheckbox.screen_coordinates.x), 160);
    assert.equal(Math.round(materializedCheckbox.screen_coordinates.y), 240);
    assert.equal(JSON.stringify(materializedCheckbox).includes(fakeToken), false);

    const parsedSlider = parseJfbymCoordinateResponse({
      code: 10000,
      data: { data: "75,24" },
    }, {
      captcha_kind: "slider",
      min_confidence: 0.65,
    });
    const materializedSlider = materializeJfbymCoordinateResult(parsedSlider, {
      plan: sliderPlan(imagePath),
      artifact: fixtureArtifact(imagePath),
      slider_result_mode: "target_x",
    });
    assert.equal(materializedSlider.ok, true);
    assert.equal(Math.round(materializedSlider.screen_coordinates.x), 120);
    assert.equal(Math.round(materializedSlider.screen_coordinates.to_x), 260);
    assert.equal(Math.round(materializedSlider.screen_coordinates.to_y), 250);

    const lowConfidence = parseJfbymCoordinateResponse({
      code: 10000,
      data: { data: "25,10" },
      confidence: 0.2,
    }, {
      captcha_kind: "hcaptcha",
      min_confidence: 0.65,
    });
    assert.equal(lowConfidence.ok, false);
    assert.equal(lowConfidence.reason, "provider_coordinates_confidence_too_low");

    const malformed = parseJfbymCoordinateResponse({
      code: 10000,
      data: { data: "no coordinate" },
    }, {
      captcha_kind: "hcaptcha",
      min_confidence: 0.65,
    });
    assert.equal(malformed.ok, false);
    assert.equal(malformed.reason, "provider_coordinates_unavailable");

    const solved = await solveJfbymCoordinateChallenge({
      args: { captcha_provider_config_dir: tmpDir },
      plan: checkboxPlan(imagePath),
      provider_response: {
        code: 10000,
        data: { data: "25,10" },
      },
    });
    assert.equal(solved.ok, true);
    assert.equal(solved.status, "success");
    assert.equal(solved.provider_type_id, "30009");
    assert.equal(solved.request_shape.has_image_base64, true);
    assert.equal(JSON.stringify(solved).includes(fakeToken), false);
    assert.equal(JSON.stringify(solved).includes("bm90LWEtcmVhbC1wbmc"), false);

    const originBlocked = await solveJfbymCoordinateChallenge({
      args: { captcha_provider_config_dir: tmpDir },
      plan: checkboxPlan(imagePath, "https://unknown.example"),
      provider_response: {
        code: 10000,
        data: { data: "25,10" },
      },
    });
    assert.equal(originBlocked.ok, false);
    assert.equal(originBlocked.reason, "provider_coordinate_origin_not_allowlisted");

    const noArtifact = await solveJfbymCoordinateChallenge({
      args: { captcha_provider_config_dir: tmpDir },
      plan: {
        ...checkboxPlan(imagePath),
        coordinate_transform: {},
      },
      provider_response: {
        code: 10000,
        data: { data: "25,10" },
      },
    });
    assert.equal(noArtifact.ok, false);
    assert.equal(noArtifact.reason, "provider_coordinate_artifact_required");

    process.stdout.write(`${JSON.stringify({
      ok: true,
      check: "browser-captcha-provider-jfbym-coordinate-contract",
      checkbox_screen_x: Math.round(materializedCheckbox.screen_coordinates.x),
      slider_to_x: Math.round(materializedSlider.screen_coordinates.to_x),
      secrets_redacted: true,
    })}\n`);
  } finally {
    restoreEnv(previousEnv);
    await rm(tmpDir, { recursive: true, force: true });
  }
}

try {
  await run();
} catch (error) {
  process.stderr.write(`browser-captcha-provider-jfbym-coordinate-contract failed: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
}
