import {
  handleAssistCaptcha,
  handlePlanCaptchaAssist,
} from "./captcha-actions.mjs";
import { handleEnsureLogin } from "./ensure-login.mjs";
import {
  handleInspectLoginPage,
  handleListProfiles,
  handleSuggestProfile,
  handleUpsertProfile,
  handleValidateProfile,
} from "./profile-actions.mjs";
import { normalizeAction } from "./shared.mjs";

const SUPPORTED_BROWSER_AUTH_ACTIONS = [
  "list_profiles",
  "validate_profile",
  "inspect_login_page",
  "suggest_profile",
  "upsert_profile",
  "ensure_login",
  "plan_captcha_assist",
  "assist_captcha",
];

const AUTH_ACTION_HANDLERS = {
  list_profiles: handleListProfiles,
  validate_profile: handleValidateProfile,
  inspect_login_page: handleInspectLoginPage,
  suggest_profile: handleSuggestProfile,
  upsert_profile: handleUpsertProfile,
  ensure_login: handleEnsureLogin,
  plan_captcha_assist: handlePlanCaptchaAssist,
  assist_captcha: handleAssistCaptcha,
};

async function handleBrowserAuthOps(args) {
  const action = normalizeAction(args, SUPPORTED_BROWSER_AUTH_ACTIONS);
  return AUTH_ACTION_HANDLERS[action](args);
}

export {
  AUTH_ACTION_HANDLERS,
  SUPPORTED_BROWSER_AUTH_ACTIONS,
  handleBrowserAuthOps,
};
