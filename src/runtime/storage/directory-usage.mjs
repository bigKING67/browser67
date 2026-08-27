import { promises as fs } from "node:fs";
import path from "node:path";

async function directorySizeAndNewestMtime(dir) {
  const state = {
    bytes: 0,
    entries: 0,
    files: 0,
    directories: 0,
    unreadable_count: 0,
    newest_mtime_ms: 0,
  };

  async function visit(current) {
    const entries = await fs.readdir(current, { withFileTypes: true }).catch((error) => {
      if (error?.code === "ENOENT" || error?.code === "EACCES") {
        state.unreadable_count += 1;
        return [];
      }
      throw error;
    });
    for (const entry of entries) {
      const entryPath = path.join(current, entry.name);
      const info = await fs.lstat(entryPath).catch((error) => {
        if (error?.code === "ENOENT" || error?.code === "EACCES") {
          state.unreadable_count += 1;
          return null;
        }
        throw error;
      });
      if (!info) continue;
      state.entries += 1;
      state.newest_mtime_ms = Math.max(state.newest_mtime_ms, Number(info.mtimeMs ?? 0));
      if (info.isDirectory()) {
        state.directories += 1;
        await visit(entryPath);
      } else {
        // Directory st_size is platform-specific; track logical payload bytes.
        state.bytes += Number(info.size ?? 0);
        state.files += 1;
      }
    }
  }

  await visit(path.resolve(dir));
  return state;
}

export { directorySizeAndNewestMtime };
