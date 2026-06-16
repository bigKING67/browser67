import { promises as fs } from "node:fs";
import path from "node:path";

function nowIso() {
  return new Date().toISOString();
}

function metadataPathForProfileSource(sourcePath) {
  const filePath = String(sourcePath ?? "").trim();
  if (!filePath) {
    return "";
  }
  return filePath.replace(/\.(env|profile)$/i, ".meta.json");
}

function cleanMetadata(raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return {};
  }
  const stringFields = [
    "profile_id",
    "created_at",
    "updated_at",
    "last_used_at",
    "last_validated_at",
    "last_status",
    "last_reason",
    "last_origin",
    "last_path",
  ];
  return Object.fromEntries(stringFields
    .map((key) => [key, String(raw[key] ?? "").trim()])
    .filter(([, value]) => value));
}

async function readProfileMetadata(sourcePath) {
  const metadataPath = metadataPathForProfileSource(sourcePath);
  if (!metadataPath) {
    return {};
  }
  try {
    const content = await fs.readFile(metadataPath, "utf8");
    return cleanMetadata(JSON.parse(content));
  } catch (error) {
    if (error?.code === "ENOENT") {
      return {};
    }
    return {
      metadata_read_error: String(error?.code ?? error?.message ?? error),
    };
  }
}

async function writeProfileMetadata(sourcePath, updates = {}) {
  const metadataPath = metadataPathForProfileSource(sourcePath);
  if (!metadataPath) {
    return {};
  }
  const previous = await readProfileMetadata(sourcePath);
  const timestamp = nowIso();
  const next = cleanMetadata({
    ...previous,
    ...updates,
    created_at: previous.created_at || updates.created_at || timestamp,
    updated_at: updates.updated_at || timestamp,
  });
  const tmpPath = path.join(
    path.dirname(metadataPath),
    `.${path.basename(metadataPath)}.${process.pid}.${Date.now()}.tmp`,
  );
  const serialized = `${JSON.stringify(next, null, 2)}\n`;
  try {
    await fs.writeFile(tmpPath, serialized, { mode: 0o600 });
    try {
      await fs.chmod(tmpPath, 0o600);
    } catch {
      // Best effort on non-POSIX filesystems.
    }
    await fs.rename(tmpPath, metadataPath);
    try {
      await fs.chmod(metadataPath, 0o600);
    } catch {
      // Best effort on non-POSIX filesystems.
    }
  } catch (error) {
    await fs.rm(tmpPath, { force: true });
    throw error;
  }
  return next;
}

function redactProfileMetadata(metadata) {
  const cleaned = cleanMetadata(metadata);
  return Object.keys(cleaned).length > 0 ? cleaned : undefined;
}

export {
  metadataPathForProfileSource,
  nowIso,
  readProfileMetadata,
  redactProfileMetadata,
  writeProfileMetadata,
};
