import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const repoRoot = resolve(__dirname, "..", "..");
const liveGatePath = resolve(repoRoot, "contracts/browser67-live-gate.mjs");

export {
  liveGatePath,
  repoRoot,
};
