import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { resolveBrowser67Home } from "../runtime/paths/home.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const srcDir = resolve(__dirname, "..");
const repoRoot = resolve(srcDir, "..");
const runtimeHome = resolveBrowser67Home().path;
const tmwdHubPath = resolve(srcDir, "tmwd-hub.mjs");
const defaultStatePath = resolve(runtimeHome, "runtime", "tmwd-hub-state.json");
const DEFAULT_TMWD_WS_ENDPOINT = "ws://127.0.0.1:18765";
const DEFAULT_TMWD_LINK_ENDPOINT = "http://127.0.0.1:18766/link";

export {
  DEFAULT_TMWD_LINK_ENDPOINT,
  DEFAULT_TMWD_WS_ENDPOINT,
  defaultStatePath,
  repoRoot,
  runtimeHome,
  srcDir,
  tmwdHubPath,
};
