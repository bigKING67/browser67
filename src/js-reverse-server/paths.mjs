import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, "..", "..");
const runtimeRoot = resolve(repoRoot, "runtime/js-reverse");

export {
  repoRoot,
  runtimeRoot,
};
