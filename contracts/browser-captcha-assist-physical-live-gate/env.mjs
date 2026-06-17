const ENABLED_VALUES = new Set(["1", "true", "yes", "on"]);
const DISABLED_VALUES = new Set(["0", "false", "no", "off"]);

function normalizedEnvValue(value) {
  return String(value ?? "").trim().toLowerCase();
}

function envEnabled(env, name) {
  return ENABLED_VALUES.has(normalizedEnvValue(env?.[name]));
}

function envDisabled(env, name) {
  return DISABLED_VALUES.has(normalizedEnvValue(env?.[name]));
}

function parsePhysicalGateEnv(env = {}) {
  return {
    physical_enabled: envEnabled(env, "TMWD_CAPTCHA_ASSIST_PHYSICAL"),
    confirm_enabled: envEnabled(env, "TMWD_CAPTCHA_ASSIST_CONFIRM"),
    require_physical: envEnabled(env, "TMWD_CAPTCHA_ASSIST_REQUIRE_PHYSICAL"),
    require_proof: envEnabled(env, "TMWD_CAPTCHA_ASSIST_REQUIRE_PROOF"),
    write_proof_disabled: envDisabled(env, "TMWD_CAPTCHA_ASSIST_WRITE_PROOF"),
  };
}

export {
  envDisabled,
  envEnabled,
  parsePhysicalGateEnv,
};
