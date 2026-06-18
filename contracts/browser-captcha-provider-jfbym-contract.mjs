#!/usr/bin/env node
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import {
  JFBYM_ENV_FILE,
  kindAllowed,
  loadJfbymProviderConfig,
  originAllowed,
} from "../src/auth/captcha/providers/config.mjs";
import { buildJfbymProviderStatus } from "../src/auth/captcha/providers/jfbym.mjs";

const JFBYM_ENV_KEYS = [
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
  "TMWD_CAPTCHA_PROVIDER_JFBYM_TYPE_IMAGE_CLICK",
  "TMWD_CAPTCHA_PROVIDER_JFBYM_TYPE_ROTATE",
  "TMWD_CAPTCHA_PROVIDER_JFBYM_TYPE_HCAPTCHA",
  "TMWD_CAPTCHA_PROVIDER_JFBYM_TYPE_RECAPTCHA",
  "TMWD_CAPTCHA_PROVIDER_JFBYM_TYPE_TURNSTILE",
];

function snapshotEnv() {
  return Object.fromEntries(JFBYM_ENV_KEYS.map((key) => [key, process.env[key]]));
}

function restoreEnv(snapshot) {
  for (const key of JFBYM_ENV_KEYS) {
    if (snapshot[key] === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = snapshot[key];
    }
  }
}

function clearEnv() {
  for (const key of JFBYM_ENV_KEYS) {
    delete process.env[key];
  }
}

async function run() {
  const previousEnv = snapshotEnv();
  const tmpDir = await mkdtemp(path.join(os.tmpdir(), "tmwd-jfbym-provider-contract-"));
  const fakeToken = "contract-token-must-not-appear";
  try {
    clearEnv();
    const missing = await loadJfbymProviderConfig({ captcha_provider_config_dir: tmpDir });
    assert.equal(missing.config_file_present, false);
    assert.equal(missing.configured, false);
    assert.equal(missing.token_configured, false);
    assert.equal(JSON.stringify(missing).includes(fakeToken), false);

    await writeFile(
      path.join(tmpDir, JFBYM_ENV_FILE),
      [
        "TMWD_CAPTCHA_PROVIDER_JFBYM_ENABLED=1",
        "TMWD_CAPTCHA_PROVIDER_JFBYM_BASE_URL=https://api.jfbym.com/api/YmServer/customApi",
        `TMWD_CAPTCHA_PROVIDER_JFBYM_TOKEN=${fakeToken}`,
        "TMWD_CAPTCHA_PROVIDER_JFBYM_TIMEOUT_MS=55000",
        "TMWD_CAPTCHA_PROVIDER_JFBYM_MAX_ATTEMPTS=1",
        "TMWD_CAPTCHA_PROVIDER_JFBYM_MIN_CONFIDENCE=0.7",
        "TMWD_CAPTCHA_PROVIDER_JFBYM_ALLOWED_ORIGINS=https://dy.feigua.cn,https://example.test/login",
        "TMWD_CAPTCHA_PROVIDER_JFBYM_ALLOWED_KINDS=checkbox,slider,hcaptcha,recaptcha,turnstile",
        "TMWD_CAPTCHA_PROVIDER_JFBYM_COORDINATE_SOLVER=1",
        "TMWD_CAPTCHA_PROVIDER_JFBYM_PROTOCOL_SOLVER=1",
        "TMWD_CAPTCHA_PROVIDER_JFBYM_TYPE_SLIDER=20110",
        "TMWD_CAPTCHA_PROVIDER_JFBYM_TYPE_HCAPTCHA=30009",
        "TMWD_CAPTCHA_PROVIDER_JFBYM_SLIDER_RESULT_MODE=target_x",
        "",
      ].join("\n"),
      { mode: 0o600 },
    );

    const configured = await loadJfbymProviderConfig({ captcha_provider_config_dir: tmpDir });
    assert.equal(configured.config_file_present, true);
    assert.equal(configured.configured, true);
    assert.equal(configured.token_configured, true);
    assert.equal(configured.protocol_solver_enabled, true);
    assert.equal(configured.coordinate_solver_enabled, true);
    assert.equal(configured.timeout_ms, 55_000);
    assert.equal(configured.max_attempts, 1);
    assert.equal(configured.min_confidence, 0.7);
    assert.equal(configured.coordinate_type_ids.slider, "20110");
    assert.equal(configured.coordinate_type_ids.hcaptcha, "30009");
    assert.equal(configured.slider_result_mode, "target_x");
    assert.equal(originAllowed(configured, "https://dy.feigua.cn/app/#/workbench/index"), true);
    assert.equal(originAllowed(configured, "https://unknown.example"), false);
    assert.equal(kindAllowed(configured, "hcaptcha"), true);
    assert.equal(kindAllowed(configured, "rotate"), false);
    assert.equal(JSON.stringify(configured).includes(fakeToken), false);

    const status = await buildJfbymProviderStatus(
      { captcha_provider_config_dir: tmpDir },
      { origin: "https://dy.feigua.cn", captcha_kind: "hcaptcha" },
    );
    assert.equal(status.status, "configured");
    assert.equal(status.protocol_mode.available, true);
    assert.equal(status.protocol_mode.allowed_origin, true);
    assert.equal(status.protocol_mode.allowed_kind, true);
    assert.equal(status.coordinate_mode.configured, true);
    assert.equal(status.coordinate_mode.available, true);
    assert.equal(status.coordinate_mode.allowed_origin, true);
    assert.equal(status.secrets_redacted, true);
    assert.equal(JSON.stringify(status).includes(fakeToken), false);

    process.stdout.write(`${JSON.stringify({
      ok: true,
      check: "browser-captcha-provider-jfbym-contract",
      configured: status.configured,
      protocol_available_for_allowlisted_origin: status.protocol_mode.available,
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
  process.stderr.write(`browser-captcha-provider-jfbym-contract failed: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
}
