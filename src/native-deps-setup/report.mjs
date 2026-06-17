import process from "node:process";

import { computeReportOk, summarizeCapabilities } from "./capabilities.mjs";
import { maybeInstallDependencies } from "./installers.mjs";
import { createMcpClient } from "./mcp-client.mjs";

async function runNativeDepsSetup({ options, serverPath, platform = process.platform }) {
  const actions = [];
  const client = createMcpClient(serverPath);
  const report = {
    ok: false,
    platform,
    install_requested: options.install,
    install_attempted: false,
    actions,
    before: null,
    after: null,
  };

  try {
    const init = await client.request("initialize", {
      protocolVersion: "2024-11-05",
      capabilities: {},
      clientInfo: {
        name: "native-deps-setup",
        version: "0.1.0",
      },
    });
    if (init.error) {
      throw new Error(`initialize failed: ${JSON.stringify(init.error)}`);
    }
    const beforeCaps = await client.toolCall("browser_native_input", { action: "capabilities" });
    report.before = {
      raw: beforeCaps,
      summary: summarizeCapabilities(beforeCaps),
    };
    const changed = await maybeInstallDependencies(platform, beforeCaps, options, actions);
    report.install_attempted = options.install;
    const afterCaps = changed
      ? await client.toolCall("browser_native_input", { action: "capabilities" })
      : beforeCaps;
    report.after = {
      raw: afterCaps,
      summary: summarizeCapabilities(afterCaps),
    };
    report.ok = computeReportOk(platform, report.after.summary);
    return {
      exit_code: report.ok ? 0 : 2,
      notice_lines: report.ok || options.json || options.quiet
        ? []
        : [
          "native deps not fully ready. See requirements below:",
          ...report.after.summary.requirements.map((item) => `- ${item}`),
        ],
      report,
    };
  } catch (error) {
    report.ok = false;
    report.error = String(error?.message ?? error);
    return {
      exit_code: 1,
      notice_lines: [],
      report,
    };
  } finally {
    await client.close();
  }
}

export {
  runNativeDepsSetup,
};
