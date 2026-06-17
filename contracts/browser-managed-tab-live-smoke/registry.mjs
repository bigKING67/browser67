import { readFile } from "node:fs/promises";

async function readRegistryRemaining(registryPath) {
  try {
    const registry = JSON.parse(await readFile(registryPath, "utf8"));
    return Array.isArray(registry?.managed_tabs) ? registry.managed_tabs.length : 0;
  } catch {
    return 0;
  }
}

export {
  readRegistryRemaining,
};
