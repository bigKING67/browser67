import path from "node:path";
import { fileURLToPath } from "node:url";

function resolveServerPath(entryImportMetaUrl) {
  const scriptPath = fileURLToPath(entryImportMetaUrl);
  return path.resolve(path.dirname(scriptPath), "server.mjs");
}

export {
  resolveServerPath,
};
