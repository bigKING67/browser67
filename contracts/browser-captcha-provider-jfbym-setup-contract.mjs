#!/usr/bin/env node
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import {
  JFBYM_ENV_FILE,
  loadJfbymProviderConfig,
} from "../src/auth/captcha/providers/config.mjs";
import {
  buildJfbymSetupPlan,
  writeJfbymSetup,
} from "../scripts/setup-captcha-provider-jfbym.mjs";

function modeBits(stats) {
  return stats.mode & 0o777;
}

async function run() {
  const tmpDir = await mkdtemp(path.join(os.tmpdir(), "tmwd-jfbym-setup-contract-"));
  const fakeToken = "setup-contract-token-must-not-appear";
  try {
    const missingToken = await writeJfbymSetup({
      config_dir: tmpDir,
      write: true,
      allowed_origins: ["https://dy.feigua.cn"],
    }, {});
    assert.equal(missingToken.ok, false);
    assert.equal(missingToken.status, "blocked");
    assert.equal(missingToken.blockers.some((entry) => entry.reason === "provider_token_env_required"), true);
    assert.equal(JSON.stringify(missingToken).includes(fakeToken), false);

    const missingOrigin = await buildJfbymSetupPlan({
      config_dir: tmpDir,
      write: true,
    }, {
      TMWD_CAPTCHA_PROVIDER_JFBYM_TOKEN: fakeToken,
    });
    assert.equal(missingOrigin.ok, false);
    assert.equal(missingOrigin.blockers.some((entry) => entry.reason === "allowed_origin_required"), true);
    assert.equal(JSON.stringify(missingOrigin).includes(fakeToken), false);

    const written = await writeJfbymSetup({
      config_dir: tmpDir,
      write: true,
      allowed_origins: ["https://dy.feigua.cn/app/#/workbench/index"],
      allowed_kinds: "checkbox,slider,hcaptcha",
      timeout_ms: 55_000,
      min_confidence: 0.7,
    }, {
      TMWD_CAPTCHA_PROVIDER_JFBYM_TOKEN: fakeToken,
    });
    assert.equal(written.ok, true);
    assert.equal(written.status, "written");
    assert.equal(written.token_configured, true);
    assert.equal(written.allowed_origins.includes("https://dy.feigua.cn"), true);
    assert.equal(JSON.stringify(written).includes(fakeToken), false);

    const configPath = path.join(tmpDir, JFBYM_ENV_FILE);
    const fileText = await readFile(configPath, "utf8");
    assert.equal(fileText.includes(fakeToken), true);
    const tmpDirStat = await stat(tmpDir);
    if (process.platform !== "win32") {
      assert.equal(modeBits(tmpDirStat), 0o700);
    } else {
      assert.equal(tmpDirStat.isDirectory(), true);
    }
    const configStat = await stat(configPath);
    if (process.platform !== "win32") {
      assert.equal(modeBits(configStat), 0o600);
    } else {
      assert.equal(configStat.isFile(), true);
    }

    const config = await loadJfbymProviderConfig({ captcha_provider_config_dir: tmpDir });
    assert.equal(config.configured, true);
    assert.equal(config.token_configured, true);
    assert.equal(config.allowed_origins.includes("https://dy.feigua.cn"), true);
    assert.equal(config.allowed_kinds.includes("hcaptcha"), true);
    assert.equal(config.timeout_ms, 55_000);
    assert.equal(config.min_confidence, 0.7);
    assert.equal(JSON.stringify(config).includes(fakeToken), false);

    const overwriteBlocked = await writeJfbymSetup({
      config_dir: tmpDir,
      write: true,
      allowed_origins: ["https://dy.feigua.cn"],
    }, {
      TMWD_CAPTCHA_PROVIDER_JFBYM_TOKEN: "replacement-token-must-not-appear",
    });
    assert.equal(overwriteBlocked.ok, false);
    assert.equal(overwriteBlocked.blockers.some((entry) => entry.reason === "config_exists_overwrite_required"), true);
    assert.equal(JSON.stringify(overwriteBlocked).includes("replacement-token-must-not-appear"), false);

    process.stdout.write(`${JSON.stringify({
      ok: true,
      check: "browser-captcha-provider-jfbym-setup-contract",
      config_file_written: true,
      mode: "0600",
      secrets_redacted: true,
    })}\n`);
  } finally {
    await rm(tmpDir, { recursive: true, force: true });
  }
}

try {
  await run();
} catch (error) {
  process.stderr.write(`browser-captcha-provider-jfbym-setup-contract failed: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
}
