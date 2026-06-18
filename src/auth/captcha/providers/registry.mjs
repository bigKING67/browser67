import { buildJfbymProviderStatus } from "./jfbym.mjs";

async function resolveCaptchaProviderRegistry(args = {}, pageState = {}) {
  const jfbym = await buildJfbymProviderStatus(args, pageState);
  return {
    providers: [jfbym],
    by_id: {
      jfbym,
    },
    secrets_redacted: true,
  };
}

export {
  resolveCaptchaProviderRegistry,
};
