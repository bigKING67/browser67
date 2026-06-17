import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const repoRoot = resolve(__dirname, "..", "..");
const jsReverseServerPath = resolve(repoRoot, "src/js-reverse-server.mjs");

export {
  jsReverseServerPath,
  repoRoot,
};
