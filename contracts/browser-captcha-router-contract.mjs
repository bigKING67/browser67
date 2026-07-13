#!/usr/bin/env node
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { buildCaptchaRouterPlan } from "../src/auth/captcha/router.mjs";
import { JFBYM_ENV_FILE } from "../src/auth/captcha/providers/config.mjs";

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
  "TMWD_CAPTCHA_PROVIDER_JFBYM_TYPE_IMAGE_CLICK",
  "TMWD_CAPTCHA_PROVIDER_JFBYM_TYPE_ROTATE",
  "TMWD_CAPTCHA_PROVIDER_JFBYM_TYPE_HCAPTCHA",
  "TMWD_CAPTCHA_PROVIDER_JFBYM_TYPE_RECAPTCHA",
  "TMWD_CAPTCHA_PROVIDER_JFBYM_TYPE_TURNSTILE",
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

function hcaptchaPage(origin = "https://dy.feigua.cn") {
  return {
    origin,
    captcha_kind: "hcaptcha",
    target: {
      role: "checkbox",
      rect: { left: 10, top: 20, right: 310, bottom: 98, width: 300, height: 78 },
    },
  };
}

function hcaptchaPlan() {
  return {
    captcha_kind: "hcaptcha",
    assist_target: "checkbox",
    coordinate_transform: {
      can_use_with_explicit_confirmation: true,
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
      "TMWD_CAPTCHA_PROVIDER_JFBYM_ALLOWED_KINDS=checkbox,slider,hcaptcha,recaptcha,turnstile",
      "TMWD_CAPTCHA_PROVIDER_JFBYM_COORDINATE_SOLVER=1",
      "TMWD_CAPTCHA_PROVIDER_JFBYM_PROTOCOL_SOLVER=1",
      "TMWD_CAPTCHA_PROVIDER_JFBYM_TYPE_HCAPTCHA=30009",
      "",
    ].join("\n"),
    { mode: 0o600 },
  );
}

async function run() {
  const previousEnv = snapshotEnv();
  const tmpDir = await mkdtemp(path.join(os.tmpdir(), "tmwd-captcha-router-contract-"));
  const fakeToken = "router-contract-token-must-not-appear";
  try {
    clearEnv();

    const defaultRoute = await buildCaptchaRouterPlan({
      args: { captcha_provider_config_dir: tmpDir },
      pageState: hcaptchaPage(),
      plan: hcaptchaPlan(),
    });
    assert.equal(defaultRoute.policy.strategy_id, "captcha_router_v2");
    assert.equal(defaultRoute.policy.policy_id, "hybrid_policy_v1");
    assert.equal(defaultRoute.policy.protocol_solver_default_enabled, false);
    assert.equal(defaultRoute.policy.protocol_solver_apply_supported, false);
    assert.equal(defaultRoute.policy.coordinate_solver_enabled, true);
    assert.equal(defaultRoute.router.selected_route.route_type, "physical_coordinate");
    assert.equal(defaultRoute.router.protocol_block_reason, "protocol_solver_not_requested");
    assert.equal(JSON.stringify(defaultRoute).includes(fakeToken), false);

    await writeProviderConfig(tmpDir, fakeToken);

    const protocolNoConfirm = await buildCaptchaRouterPlan({
      args: {
        captcha_provider_config_dir: tmpDir,
        captcha_solver_mode: "protocol_allowed",
      },
      pageState: hcaptchaPage(),
      plan: hcaptchaPlan(),
    });
    assert.equal(protocolNoConfirm.router.selected_route.route_type, "physical_coordinate");
    assert.equal(protocolNoConfirm.router.protocol_block_reason, "confirm_protocol_solver_required");

    const providerCoordinate = await buildCaptchaRouterPlan({
      args: {
        captcha_provider_config_dir: tmpDir,
        captcha_locator_provider: "jfbym",
      },
      pageState: hcaptchaPage(),
      plan: hcaptchaPlan(),
    });
    assert.equal(providerCoordinate.router.selected_route.route_type, "physical_coordinate");
    assert.equal(providerCoordinate.router.selected_route.solver_provider, "jfbym");
    assert.equal(providerCoordinate.router.selected_route.provider_mode, "coordinate");
    assert.equal(providerCoordinate.router.provider_coordinate_block_reason, "");

    const protocolAllowed = await buildCaptchaRouterPlan({
      args: {
        captcha_provider_config_dir: tmpDir,
        captcha_solver_mode: "protocol_allowed",
        confirm_protocol_solver: true,
      },
      pageState: hcaptchaPage(),
      plan: hcaptchaPlan(),
    });
    assert.equal(protocolAllowed.router.selected_route.route_type, "protocol_solver");
    assert.equal(protocolAllowed.router.selected_route.solver_provider, "jfbym");
    assert.equal(protocolAllowed.router.selected_route.execution_allowed, false);
    assert.equal(protocolAllowed.policy.protocol_solver_apply_supported, false);
    assert.equal(protocolAllowed.router.protocol_block_reason, "");
    assert.equal(JSON.stringify(protocolAllowed).includes(fakeToken), false);

    const coordinateOnly = await buildCaptchaRouterPlan({
      args: {
        captcha_provider_config_dir: tmpDir,
        captcha_solver_mode: "coordinate_only",
        confirm_protocol_solver: true,
      },
      pageState: hcaptchaPage(),
      plan: hcaptchaPlan(),
    });
    assert.equal(coordinateOnly.router.selected_route.route_type, "physical_coordinate");
    assert.equal(coordinateOnly.router.protocol_block_reason, "protocol_solver_not_requested");

    const unknownOrigin = await buildCaptchaRouterPlan({
      args: {
        captcha_provider_config_dir: tmpDir,
        captcha_solver_mode: "protocol_allowed",
        confirm_protocol_solver: true,
      },
      pageState: hcaptchaPage("https://unknown.example"),
      plan: hcaptchaPlan(),
    });
    assert.equal(unknownOrigin.router.selected_route.route_type, "physical_coordinate");
    assert.equal(unknownOrigin.router.protocol_block_reason, "captcha_provider_jfbym_origin_not_allowlisted");

    const manualOnly = await buildCaptchaRouterPlan({
      args: {
        captcha_provider_config_dir: tmpDir,
        captcha_solver_mode: "manual_only",
      },
      pageState: hcaptchaPage(),
      plan: hcaptchaPlan(),
    });
    assert.equal(manualOnly.router.selected_route.route_type, "manual_handoff");
    assert.equal(manualOnly.router.selected_route.reason, "captcha_solver_mode_manual_only");

    const degraded = await buildCaptchaRouterPlan({
      args: { captcha_provider_config_dir: tmpDir },
      pageState: {
        origin: "https://dy.feigua.cn",
        captcha_kind: "hcaptcha",
        target: {
          role: "unknown",
          frame_access: "cross_origin_uninspectable",
          degraded_mode: true,
          inaccessible_frame_reason: "cross_origin_frame_uninspectable",
        },
      },
      plan: {
        captcha_kind: "hcaptcha",
        assist_target: "unknown",
        degraded_mode: true,
        degraded_reason: "cross_origin_frame_uninspectable",
      },
    });
    assert.equal(degraded.router.selected_route.route_type, "manual_handoff");
    assert.equal(degraded.router.selected_route.manual_handoff_required, true);

    process.stdout.write(`${JSON.stringify({
      ok: true,
      check: "browser-captcha-router-contract",
      default_route: defaultRoute.router.selected_route.route_type,
      protocol_route: protocolAllowed.router.selected_route.route_type,
      manual_route: degraded.router.selected_route.route_type,
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
  process.stderr.write(`browser-captcha-router-contract failed: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
}
