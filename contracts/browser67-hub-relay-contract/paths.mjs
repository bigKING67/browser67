import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const repoRoot = resolve(__dirname, "..", "..");
const hubPath = resolve(repoRoot, "src/tmwd-hub.mjs");

export {
  hubPath,
  repoRoot,
};
