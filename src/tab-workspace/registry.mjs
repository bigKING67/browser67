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

const managedTabs = new Map();
const deletedTabIds = new Set();
const registryPath = resolveRegistryPath();
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
    await fs.mkdir(dirname(lockPath), { recursive: true });
    await fs.mkdir(lockPath);
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
    .forEach((record) => managedTabs.set(record.tab_id, record));
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
      .forEach((record) => merged.set(record.tab_id, record));
    deletedTabIds.forEach((tabId) => merged.delete(tabId));
    Array.from(managedTabs.values()).forEach((record) => {
      if (record.dry_run === true) {
        return;
      }
      if (record.status === "closed") {
        merged.delete(record.tab_id);
        return;
      }
      merged.set(record.tab_id, record);
    });

    await fs.mkdir(dirname(registryPath), { recursive: true });
    const payload = {
      version: 2,
      updated_at: nowIso(),
      managed_tabs: Array.from(merged.values()).map((record) => managedTabPayload(record)),
    };
    const tempPath = `${registryPath}.${process.pid}.tmp`;
    await fs.writeFile(tempPath, `${JSON.stringify(payload, null, 2)}\n`);
    await fs.rename(tempPath, registryPath);

    managedTabs.clear();
    Array.from(merged.values()).forEach((record) => managedTabs.set(record.tab_id, record));
    deletedTabIds.clear();
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
  managedTabs.set(record.tab_id, record);
  await persistRegistry();
  return record;
}

async function getManagedTab(tabId) {
  await refreshRegistryFromDiskIfChanged();
  return managedTabs.get(String(tabId ?? "").trim()) ?? null;
}

async function updateManagedTab(tabId, patch = {}) {
  await refreshRegistryFromDiskIfChanged();
  const normalizedTabId = String(tabId ?? "").trim();
  const existing = managedTabs.get(normalizedTabId);
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
    owner: "tmwd",
    url: parts.normalized_url,
    origin: parts.origin,
    path_scope: String(recordPatch.path_scope ?? recordPatch.pathScope ?? existing.path_scope ?? "").trim()
      || parts.path_scope,
    updated_at: nowIso(),
    last_used_at: touch === false ? existing.last_used_at : nowIso(),
  };
  managedTabs.set(normalizedTabId, next);
  await persistRegistry();
  return next;
}

async function deleteManagedTab(tabId) {
  await refreshRegistryFromDiskIfChanged();
  const normalizedTabId = String(tabId ?? "").trim();
  if (!normalizedTabId) {
    return;
  }
  managedTabs.delete(normalizedTabId);
  deletedTabIds.add(normalizedTabId);
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
