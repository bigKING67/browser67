import { randomUUID } from "node:crypto";
import { mkdir, rename, unlink, writeFile } from "node:fs/promises";
import path from "node:path";

/**
 * @param {string} filePath
 * @param {string | Uint8Array} content
 * @param {import("node:fs").WriteFileOptions} [options]
 */
async function atomicWriteFile(filePath, content, options = "utf8") {
  const resolved = path.resolve(filePath);
  const tempPath = `${resolved}.${process.pid}.${randomUUID().slice(0, 8)}.tmp`;
  await mkdir(path.dirname(resolved), { recursive: true });
  try {
    await writeFile(tempPath, content, options);
    await rename(tempPath, resolved);
  } catch (error) {
    await unlink(tempPath).catch(() => {});
    throw error;
  }
}

async function atomicWriteJson(filePath, payload) {
  await atomicWriteFile(filePath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
}

export {
  atomicWriteFile,
  atomicWriteJson,
};
