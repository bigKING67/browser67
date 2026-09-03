import { promises as fs } from "node:fs";
import { dirname } from "node:path";

import { nowIso } from "../runtime/identity.mjs";
import {
  REGISTRY_LOCK_STALE_MS,
  REGISTRY_LOCK_TIMEOUT_MS,
} from "./constants.mjs";
import {
  buildManagedRecord,
  managedTabPayload,
  planManagedTab,
} from "./records.mjs";
import {
  parseUrlParts,
  resolveRegistryPath,
} from "./policy.mjs";
import {
  browserTabKey,
  normalizeBrowserInstanceId,
  normalizeBrowserTabId,
} from "./identity.mjs";

const managedTabs = new Map();
const deletedTabKeys = new Set();
const registryPath = resolveRegistryPath();
const registryPathIsExplicit = Boolean(
  String(process.env.BROWSER_STRUCTURED_TAB_REGISTRY_PATH ?? "").trim(),
);
let registryLoaded = false;
let registryLoadPromise = null;
let registryDiskFingerprint = "";

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function acquireRegistryLock() {
  const lockPath = `${registryPath}.lock`;
  return attemptRegistryLock(lockPath, Date.now());
}

async function attemptRegistryLock(lockPath, startedAt) {
  try {
    await ensureRegistryParent();
    await fs.mkdir(lockPath, { mode: 0o700 });
    return { lockPath };
  } catch (error) {
    if (error?.code !== "EEXIST") {
      throw error;
    }
    const stale = await registryLockIsStale(lockPath);
    if (stale) {
      try {
        await fs.rmdir(lockPath);
        return attemptRegistryLock(lockPath, startedAt);
      } catch {
        // Another process may have refreshed or removed the lock.
      }
    }
    if (Date.now() - startedAt > REGISTRY_LOCK_TIMEOUT_MS) {
      throw new Error(`managed tab registry lock timeout: ${lockPath}`);
    }
    await sleep(50);
    return attemptRegistryLock(lockPath, startedAt);
  }
}

async function ensureRegistryParent() {
  const parent = dirname(registryPath);
  await fs.mkdir(parent, { recursive: true, mode: 0o700 });
  if (!registryPathIsExplicit) await fs.chmod(parent, 0o700);
  return parent;
}

async function writeRegistryPayload(payload) {
  await ensureRegistryParent();
  const tempPath = `${registryPath}.${process.pid}.tmp`;
  try {
    await fs.writeFile(tempPath, `${JSON.stringify(payload, null, 2)}\n`, {
      encoding: "utf8",
      mode: 0o600,
    });
    await fs.chmod(tempPath, 0o600);
    await fs.rename(tempPath, registryPath);
    await fs.chmod(registryPath, 0o600);
  } catch (error) {
    await fs.unlink(tempPath).catch(() => {});
    throw error;
  }
}

async function registryLockIsStale(lockPath) {
  try {
    const stat = await fs.stat(lockPath);
    return Date.now() - stat.mtimeMs > REGISTRY_LOCK_STALE_MS;
  } catch {
    return true;
  }
}

async function releaseRegistryLock(lock) {
  if (!lock?.lockPath) {
    return;
  }
  try {
    await fs.rmdir(lock.lockPath);
  } catch {
    // Best effort: a stale-lock cleanup may have already removed it.
  }
}

async function registryFingerprintFromDisk() {
  try {
    const stat = await fs.stat(registryPath, { bigint: true });
    const mtime = stat.mtimeNs ?? stat.mtimeMs;
    return `${String(mtime)}:${String(stat.size)}`;
  } catch (error) {
    if (error?.code === "ENOENT") {
      return "missing";
    }
    throw error;
  }
}

function replaceManagedTabs(records) {
  managedTabs.clear();
  records
    .filter((record) => record.dry_run !== true && record.status !== "closed")
    .forEach((record) => managedTabs.set(browserTabKey(record), record));
}

function managedTabLookupKey(tabId, browserInstanceId = "") {
  const raw = normalizeBrowserTabId(tabId);
  if (!raw) return "";
  if (managedTabs.has(raw)) return raw;
  const normalizedInstanceId = normalizeBrowserInstanceId(browserInstanceId);
  if (normalizedInstanceId) return browserTabKey(raw, normalizedInstanceId);
  const matchingKeys = [...managedTabs.entries()]
    .filter(([, record]) => record.tab_id === raw)
    .map(([key]) => key);
  return matchingKeys.length === 1 ? matchingKeys[0] : "";
}

async function readRegistryRecordsFromDisk() {
  let parsed;
  try {
    parsed = JSON.parse(await fs.readFile(registryPath, "utf8"));
  } catch {
    return [];
  }
  return Array.isArray(parsed?.managed_tabs)
    ? parsed.managed_tabs.map((row) => buildManagedRecord(row))
    : [];
}

async function loadRegistry() {
  if (registryLoaded) {
    return;
  }
  if (!registryLoadPromise) {
    registryLoadPromise = (async () => {
      const records = await readRegistryRecordsFromDisk();
      replaceManagedTabs(records);
      registryDiskFingerprint = await registryFingerprintFromDisk();
      registryLoaded = true;
    })();
  }
  try {
    await registryLoadPromise;
  } catch (error) {
    registryLoadPromise = null;
    throw error;
  }
}

async function refreshRegistryFromDiskIfChanged() {
  await loadRegistry();
  const fingerprint = await registryFingerprintFromDisk();
  if (fingerprint === registryDiskFingerprint) {
    return;
  }
  const records = await readRegistryRecordsFromDisk();
  replaceManagedTabs(records);
  registryDiskFingerprint = await registryFingerprintFromDisk();
}

async function persistRegistry() {
  await loadRegistry();
  const lock = await acquireRegistryLock();
  try {
    const merged = new Map();
    const diskRecords = await readRegistryRecordsFromDisk();
    diskRecords
      .filter((record) => record.dry_run !== true && record.status !== "closed")
      .forEach((record) => merged.set(browserTabKey(record), record));
    deletedTabKeys.forEach((key) => merged.delete(key));
    Array.from(managedTabs.values()).forEach((record) => {
      if (record.dry_run === true) {
        return;
      }
      if (record.status === "closed") {
        merged.delete(browserTabKey(record));
        return;
      }
      merged.set(browserTabKey(record), record);
    });

    const payload = {
      version: 3,
      updated_at: nowIso(),
      managed_tabs: Array.from(merged.values()).map((record) => managedTabPayload(record)),
    };
    await writeRegistryPayload(payload);

    managedTabs.clear();
    Array.from(merged.values()).forEach((record) => managedTabs.set(browserTabKey(record), record));
    deletedTabKeys.clear();
    registryDiskFingerprint = await registryFingerprintFromDisk();
  } finally {
    await releaseRegistryLock(lock);
  }
}

async function recordManagedTab(input) {
  await refreshRegistryFromDiskIfChanged();
  if (input?.dry_run === true) {
    return planManagedTab(input);
  }
  const record = buildManagedRecord(input);
  managedTabs.set(browserTabKey(record), record);
  await persistRegistry();
  return record;
}

async function getManagedTab(tabId, browserInstanceId = "") {
  await refreshRegistryFromDiskIfChanged();
  const key = managedTabLookupKey(tabId, browserInstanceId);
  return key ? managedTabs.get(key) ?? null : null;
}

async function updateManagedTab(tabId, patch = {}, browserInstanceId = "") {
  await refreshRegistryFromDiskIfChanged();
  const key = managedTabLookupKey(tabId, browserInstanceId || patch.browser_instance_id);
  const existing = key ? managedTabs.get(key) : null;
  if (!existing) {
    return null;
  }
  const { touch, ...recordPatch } = /** @type {Record<string, any>} */ (patch);
  const nextUrl = Object.prototype.hasOwnProperty.call(recordPatch, "url")
    ? String(recordPatch.url ?? "").trim()
    : existing.url;
  const parts = parseUrlParts(nextUrl || existing.url);
  const next = {
    ...existing,
    ...recordPatch,
    tab_id: existing.tab_id,
    browser_instance_id: existing.browser_instance_id,
    browser_instance_identity: existing.browser_instance_identity,
    session_key: existing.session_key,
    owner: "tmwd",
    url: parts.normalized_url,
    origin: parts.origin,
    path_scope: String(recordPatch.path_scope ?? recordPatch.pathScope ?? existing.path_scope ?? "").trim()
      || parts.path_scope,
    updated_at: nowIso(),
    last_used_at: touch === false ? existing.last_used_at : nowIso(),
  };
  managedTabs.set(key, next);
  await persistRegistry();
  return next;
}

async function deleteManagedTab(tabId, browserInstanceId = "") {
  await refreshRegistryFromDiskIfChanged();
  const key = managedTabLookupKey(tabId, browserInstanceId);
  if (!key) {
    return;
  }
  managedTabs.delete(key);
  deletedTabKeys.add(key);
  await persistRegistry();
}

async function listManagedTabRecords(options = {}) {
  await refreshRegistryFromDiskIfChanged();
  const includeClosed = options.include_closed === true;
  const rows = Array.from(managedTabs.values()).filter((record) => {
    if (!includeClosed && record.status === "closed") {
      return false;
    }
    if (options.task_id && record.task_id !== options.task_id) {
      return false;
    }
    if (options.workspace_key && record.workspace_key !== options.workspace_key) {
      return false;
    }
    if (options.browser_instance_id && record.browser_instance_id !== options.browser_instance_id) {
      return false;
    }
    return true;
  });
  rows.sort((left, right) => String(right.last_used_at).localeCompare(String(left.last_used_at)));
  return rows;
}

export {
  deleteManagedTab,
  getManagedTab,
  listManagedTabRecords,
  recordManagedTab,
  updateManagedTab,
};
