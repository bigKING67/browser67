import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

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
const runtimeHome = resolve(
  process.env.TMWD_BROWSER_MCP_HOME
    || process.env.TMWD_HOME
    || `${process.env.HOME || process.cwd()}/.tmwd-browser-mcp`,
);
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
