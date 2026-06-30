import { captureBrowserScreenshot } from "../../browser-screenshot/capture.mjs";
import { createToolError } from "../../errors.mjs";

async function handleBrowserScreenshotOps(args = {}) {
  const action = String(args.action ?? "capture").trim() || "capture";
  if (action !== "capture") {
    throw createToolError("INVALID_ARGUMENT", `unknown browser_screenshot_ops action: ${action}`, {
      retryable: false,
      details: { accepted_actions: ["capture"] },
    });
  }
  return captureBrowserScreenshot({
    ...args,
    action,
  });
}

export {
  handleBrowserScreenshotOps,
};
