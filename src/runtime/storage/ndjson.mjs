import { open, readFile } from "node:fs/promises";

const DEFAULT_CHUNK_BYTES = 64 * 1024;
const DEFAULT_MAX_SCAN_BYTES = 16 * 1024 * 1024;

function parseNdjsonLine(line, invalidRecord) {
  const normalized = String(line ?? "").trim();
  if (!normalized) return null;
  try {
    return JSON.parse(normalized);
  } catch {
    return typeof invalidRecord === "function"
      ? invalidRecord(normalized)
      : { invalid_json: true, raw: normalized };
  }
}

async function scanNdjsonBackwards(filePath, options = {}) {
  const chunkBytes = Math.max(1_024, Number(options.chunk_bytes ?? DEFAULT_CHUNK_BYTES));
  const maxScanBytes = Math.max(chunkBytes, Number(options.max_scan_bytes ?? DEFAULT_MAX_SCAN_BYTES));
  let handle;
  try {
    handle = await open(filePath, "r");
  } catch (error) {
    if (error?.code === "ENOENT") {
      return { records: [], bytes_scanned: 0, file_bytes: 0, truncated: false };
    }
    throw error;
  }

  try {
    const info = await handle.stat();
    let position = info.size;
    let remainder = "";
    let bytesScanned = 0;
    const records = [];
    let stopped = false;

    while (position > 0 && bytesScanned < maxScanBytes && !stopped) {
      const readSize = Math.min(chunkBytes, position, maxScanBytes - bytesScanned);
      position -= readSize;
      const buffer = Buffer.allocUnsafe(readSize);
      const { bytesRead } = await handle.read(buffer, 0, readSize, position);
      bytesScanned += bytesRead;
      const parts = `${buffer.subarray(0, bytesRead).toString("utf8")}${remainder}`.split("\n");
      remainder = parts.shift() ?? "";
      for (let index = parts.length - 1; index >= 0; index -= 1) {
        const record = parseNdjsonLine(parts[index], options.invalid_record);
        if (!record) continue;
        records.push(record);
        if (typeof options.on_record === "function") {
          const shouldContinue = await options.on_record(record, records.length);
          if (shouldContinue === false) {
            stopped = true;
            break;
          }
        }
      }
    }

    if (!stopped && position === 0 && remainder.trim()) {
      const record = parseNdjsonLine(remainder, options.invalid_record);
      if (record) {
        records.push(record);
        if (typeof options.on_record === "function") {
          await options.on_record(record, records.length);
        }
      }
    }

    return {
      records,
      bytes_scanned: bytesScanned,
      file_bytes: info.size,
      truncated: position > 0 && !stopped,
      stopped,
    };
  } finally {
    await handle.close();
  }
}

async function readNdjsonTail(filePath, limit = 20, options = {}) {
  const normalizedLimit = Math.max(0, Number(limit ?? 20));
  if (normalizedLimit === 0) return [];
  const scan = await scanNdjsonBackwards(filePath, {
    ...options,
    on_record: async (_record, count) => count < normalizedLimit,
  });
  return scan.records.slice(0, normalizedLimit).reverse();
}

async function readNdjsonFile(filePath, options = {}) {
  const raw = await readFile(filePath, "utf8").catch((error) => {
    if (error?.code === "ENOENT") return "";
    throw error;
  });
  return raw
    .split("\n")
    .map((line) => parseNdjsonLine(line, options.invalid_record))
    .filter(Boolean);
}

export {
  DEFAULT_MAX_SCAN_BYTES,
  parseNdjsonLine,
  readNdjsonFile,
  readNdjsonTail,
  scanNdjsonBackwards,
};
