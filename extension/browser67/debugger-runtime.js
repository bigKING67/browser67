(() => {
  const debuggerQueues = new Map();
  let leaseSequence = 0;

  function debuggerError(error, tabId, operation) {
    const message = String(error?.message || error || "debugger operation failed");
    const busy = /another debugger|already attached|debugger is attached/i.test(message);
    const wrapped = new Error(message);
    wrapped.code = busy ? "DEBUGGER_BUSY" : String(error?.code || "DEBUGGER_OPERATION_FAILED");
    wrapped.details = {
      tab_id: tabId,
      operation,
      external_owner_possible: busy,
    };
    return wrapped;
  }

  async function acquireDebuggerQueue(tabId, operation) {
    const previous = debuggerQueues.get(tabId) || Promise.resolve();
    let releaseGate;
    const gate = new Promise((resolve) => { releaseGate = resolve; });
    const tail = previous.catch(() => {}).then(() => gate);
    debuggerQueues.set(tabId, tail);
    const queuedAt = Date.now();
    await previous.catch(() => {});
    const acquiredAt = Date.now();
    const leaseId = `debugger-${String(++leaseSequence)}`;
    let released = false;
    return {
      receipt: {
        lease_id: leaseId,
        tab_id: tabId,
        operation,
        queued_ms: acquiredAt - queuedAt,
        acquired_at: new Date(acquiredAt).toISOString(),
      },
      release() {
        if (released) return;
        released = true;
        releaseGate();
        if (debuggerQueues.get(tabId) === tail) debuggerQueues.delete(tabId);
      },
    };
  }

  async function withDebuggerQueues(tabIds, operation, callback) {
    const normalized = [...new Set(tabIds)].sort((left, right) => left - right);
    const leases = [];
    try {
      for (const tabId of normalized) {
        leases.push(await acquireDebuggerQueue(tabId, operation));
      }
      return await callback(leases.map((lease) => lease.receipt));
    } finally {
      for (const lease of leases.reverse()) lease.release();
    }
  }

  async function attachDebugger(tabId, operation) {
    try {
      await chrome.debugger.attach({ tabId }, "1.3");
    } catch (error) {
      throw debuggerError(error, tabId, operation);
    }
  }

  async function detachDebugger(tabId) {
    if (tabId === null) return;
    try {
      await chrome.debugger.detach({ tabId });
    } catch {
      // A closed tab or service-worker detach is already a terminal release.
    }
  }

  function batchCdpTabIds(message, sender, normalizeTabId) {
    if (!Array.isArray(message?.commands)) {
      throw Object.assign(new Error("batch commands must be an array"), { code: "INVALID_ARGUMENT" });
    }
    const ids = [];
    for (const command of message.commands) {
      if (command?.cmd !== "cdp") continue;
      const tabId = normalizeTabId(command.tabId ?? message.tabId ?? sender?.tab?.id);
      if (tabId === null) {
        throw Object.assign(new Error("invalid or missing numeric tabId"), { code: "INVALID_ARGUMENT" });
      }
      ids.push(tabId);
    }
    return ids;
  }

  async function browser67HandleDebuggerBatch(message, sender, helpers = {}) {
    const normalizeTabId = helpers.normalizeNumericTabId;
    const handleCookies = helpers.handleCookies;
    const handleTabs = helpers.handleTabs;
    let tabIds;
    try {
      tabIds = batchCdpTabIds(message, sender, normalizeTabId);
    } catch (error) {
      return {
        ok: false,
        error: String(error?.message || error),
        errorCode: String(error?.code || "INVALID_ARGUMENT"),
        results: [],
      };
    }
    return withDebuggerQueues(tabIds, "batch", async (leaseReceipts) => {
      const results = [];
      const metricsOverrides = new Set();
      const cleanup = [];
      let attachedTabId = null;
      let outcome;

      async function switchDebugger(tabId) {
        if (attachedTabId === tabId) return;
        await detachDebugger(attachedTabId);
        attachedTabId = null;
        await attachDebugger(tabId, "batch");
        attachedTabId = tabId;
      }

      try {
        for (const rawCommand of message.commands) {
          const command = globalThis.browser67ResolveBatchReferences(
            rawCommand,
            results,
            { command_index: results.length },
          );
          if (command.tabId === undefined && message.tabId !== undefined) command.tabId = message.tabId;
          if (command.cmd === "cookies") {
            results.push(await handleCookies(command, sender));
            continue;
          }
          if (command.cmd === "tabs") {
            results.push(await handleTabs(command));
            continue;
          }
          if (command.cmd !== "cdp") {
            results.push({ ok: false, error: `unknown cmd: ${String(command.cmd)}` });
            continue;
          }
          const tabId = normalizeTabId(command.tabId ?? message.tabId ?? sender?.tab?.id);
          if (tabId === null) {
            throw Object.assign(new Error("invalid or missing numeric tabId"), { code: "INVALID_ARGUMENT" });
          }
          await switchDebugger(tabId);
          const response = await chrome.debugger.sendCommand(
            { tabId },
            command.method,
            command.params || {},
          );
          results.push(response);
          if (command.method === "Emulation.setDeviceMetricsOverride") metricsOverrides.add(tabId);
          if (command.method === "Emulation.clearDeviceMetricsOverride") metricsOverrides.delete(tabId);
        }
        outcome = { ok: true, results };
      } catch (error) {
        const normalized = error?.code ? error : debuggerError(error, attachedTabId, "batch");
        outcome = {
          ok: false,
          error: String(normalized.message || normalized),
          errorCode: String(normalized.code || "DEBUGGER_OPERATION_FAILED"),
          errorDetails: normalized.details,
          results,
        };
      } finally {
        for (const tabId of [...metricsOverrides]) {
          try {
            await switchDebugger(tabId);
            await chrome.debugger.sendCommand({ tabId }, "Emulation.clearDeviceMetricsOverride", {});
            cleanup.push({ tab_id: tabId, cleared: true });
          } catch (error) {
            cleanup.push({ tab_id: tabId, cleared: false, error: String(error?.message || error) });
          }
        }
        await detachDebugger(attachedTabId);
      }

      const cleanupFailed = cleanup.some((entry) => entry.cleared !== true);
      if (cleanupFailed && outcome.ok === true) {
        outcome = {
          ok: false,
          error: "debugger batch completed but viewport override cleanup failed",
          errorCode: "VIEWPORT_CLEANUP_FAILED",
          errorDetails: { cleanup },
          results,
        };
      } else if (cleanup.length > 0) {
        outcome.errorDetails = { ...(outcome.errorDetails || {}), cleanup };
      }
      outcome.debuggerLease = { serialized: true, leases: leaseReceipts };
      return outcome;
    });
  }

  async function browser67HandleDebuggerCommand(message, sender, helpers = {}) {
    const normalizeTabId = helpers.normalizeNumericTabId;
    const tabId = normalizeTabId(message.tabId ?? sender?.tab?.id);
    if (tabId === null) {
      return { ok: false, error: "invalid or missing numeric tabId", errorCode: "INVALID_ARGUMENT" };
    }
    return withDebuggerQueues([tabId], String(message.method || "cdp"), async (leaseReceipts) => {
      let attached = false;
      try {
        await attachDebugger(tabId, String(message.method || "cdp"));
        attached = true;
        const result = await chrome.debugger.sendCommand({ tabId }, message.method, message.params || {});
        return {
          ok: true,
          data: result,
          debuggerLease: { serialized: true, leases: leaseReceipts },
        };
      } catch (error) {
        const normalized = error?.code ? error : debuggerError(error, tabId, String(message.method || "cdp"));
        return {
          ok: false,
          error: String(normalized.message || normalized),
          errorCode: String(normalized.code || "DEBUGGER_OPERATION_FAILED"),
          errorDetails: normalized.details,
          debuggerLease: { serialized: true, leases: leaseReceipts },
        };
      } finally {
        if (attached) await detachDebugger(tabId);
      }
    });
  }

  function browser67DebuggerStatus() {
    return {
      serialized: true,
      queued_tab_count: debuggerQueues.size,
      queued_tab_ids: [...debuggerQueues.keys()],
      ui_scope: "browser_profile",
      same_profile_user_window_indicator_possible: true,
      isolation_requires_separate_browser_instance: true,
    };
  }

  globalThis.browser67HandleDebuggerBatch = browser67HandleDebuggerBatch;
  globalThis.browser67HandleDebuggerCommand = browser67HandleDebuggerCommand;
  globalThis.browser67DebuggerStatus = browser67DebuggerStatus;
})();
