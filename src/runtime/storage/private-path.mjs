import {
  appendFileSync,
  chmodSync,
  mkdirSync,
} from "node:fs";
import { appendFile, chmod, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

const PRIVATE_DIRECTORY_MODE = 0o700;
const PRIVATE_FILE_MODE = 0o600;
const PRIVATE_PROCESS_UMASK = 0o077;

function applyPrivateProcessUmask() {
  if (process.platform === "win32") {
    return { applied: false, previous: null, current: null };
  }
  const previous = process.umask(PRIVATE_PROCESS_UMASK);
  return { applied: true, previous, current: PRIVATE_PROCESS_UMASK };
}

async function ensurePrivateDirectory(directoryPath) {
  await mkdir(directoryPath, { recursive: true, mode: PRIVATE_DIRECTORY_MODE });
  await chmod(directoryPath, PRIVATE_DIRECTORY_MODE);
  return directoryPath;
}

async function appendPrivateFile(filePath, content, options = {}) {
  await ensurePrivateDirectory(path.dirname(filePath));
  const writeOptions = typeof options === "string" ? { encoding: options } : options;
  await appendFile(filePath, content, {
    ...writeOptions,
    mode: PRIVATE_FILE_MODE,
  });
  await chmod(filePath, PRIVATE_FILE_MODE);
}

async function writePrivateFile(filePath, content, options = {}) {
  await ensurePrivateDirectory(path.dirname(filePath));
  const writeOptions = typeof options === "string" ? { encoding: options } : options;
  await writeFile(filePath, content, {
    ...writeOptions,
    mode: PRIVATE_FILE_MODE,
  });
  await chmod(filePath, PRIVATE_FILE_MODE);
}

function ensurePrivateDirectorySync(directoryPath) {
  mkdirSync(directoryPath, { recursive: true, mode: PRIVATE_DIRECTORY_MODE });
  chmodSync(directoryPath, PRIVATE_DIRECTORY_MODE);
  return directoryPath;
}

function appendPrivateFileSync(filePath, content, options = {}) {
  ensurePrivateDirectorySync(path.dirname(filePath));
  const writeOptions = typeof options === "string" ? { encoding: options } : options;
  appendFileSync(filePath, content, {
    ...writeOptions,
    mode: PRIVATE_FILE_MODE,
  });
  chmodSync(filePath, PRIVATE_FILE_MODE);
}

export {
  PRIVATE_DIRECTORY_MODE,
  PRIVATE_FILE_MODE,
  PRIVATE_PROCESS_UMASK,
  applyPrivateProcessUmask,
  appendPrivateFile,
  appendPrivateFileSync,
  ensurePrivateDirectory,
  ensurePrivateDirectorySync,
  writePrivateFile,
};
