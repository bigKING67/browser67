import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { resolveBrowser67Home } from "../../src/runtime/paths/home.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const repoRoot = resolve(__dirname, "..", "..");
const liveDoctorPath = resolve(
  repoRoot,
  "contracts/browser-structured-mcp-live-doctor.mjs",
);
const liveContractPath = resolve(
  repoRoot,
  "contracts/browser-structured-mcp-live-contract.mjs",
);
const tmwdHubControlPath = resolve(
  repoRoot,
  "src/tmwd-hub-control.mjs",
);
const runtimeHome = resolveBrowser67Home().path;
const DEFAULT_EVENT_LOG_PATH = resolve(
  runtimeHome,
  "runtime",
  "browser-live-gate-events.jsonl",
);

export {
  DEFAULT_EVENT_LOG_PATH,
  liveContractPath,
  liveDoctorPath,
  repoRoot,
  tmwdHubControlPath,
};
