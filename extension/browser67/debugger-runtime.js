(() => {
  const debuggerQueues = new Map();
  let leaseSequence = 0;

  function boundedInteger(raw, fallback, min, max) {
    const value = Number(raw);
    if (!Number.isFinite(value)) return fallback;
    return Math.max(min, Math.min(max, Math.floor(value)));
  }

  function createDebuggerDeadline(rawTimeoutMs) {
    const timeoutMs = boundedInteger(rawTimeoutMs, 20_000, 25, 120_000);
    const startedAtMs = Date.now();
    const deadlineAtMs = startedAtMs + timeoutMs;
    const cleanupReserveMs = Math.min(1_500, Math.max(25, Math.floor(timeoutMs / 4)));
    const detachReserveMs = Math.min(250, Math.max(6, Math.floor(cleanupReserveMs / 4)));

    function snapshot(phase, extra = {}) {
      return {
        timeout_ms: timeoutMs,
        elapsed_ms: Math.max(0, Date.now() - startedAtMs),
        remaining_ms: Math.max(0, deadlineAtMs - Date.now()),
        deadline_at: new Date(deadlineAtMs).toISOString(),
        failed_phase: phase,
        ...extra,
      };
    }

    function timeoutError(phase, extra = {}) {
      return Object.assign(new Error(`debugger operation timed out during ${phase}`), {
        code: "TIMEOUT",
        details: {
          timeout_kind: "extension_debugger_deadline",
          ...snapshot(phase, extra),
        },
      });
    }

    function remaining(phase, reserveMs = 0, extra = {}) {
      const value = Math.floor(deadlineAtMs - Date.now() - Math.max(0, reserveMs));
      if (value < 1) throw timeoutError(phase, extra);
      return value;
    }

    async function run(operation, phase, options = {}) {
      const waitMs = remaining(phase, options.reserve_ms, options.details);
      let timer = null;
      try {
        return await Promise.race([
          Promise.resolve().then(operation),
          new Promise((_, reject) => {
            timer = setTimeout(
              () => reject(timeoutError(phase, options.details)),
              waitMs,
            );
          }),
        ]);
      } finally {
        if (timer !== null) clearTimeout(timer);
      }
    }

    return {
      cleanup_reserve_ms: cleanupReserveMs,
      detach_reserve_ms: detachReserveMs,
      run,
      snapshot,
      timeout_ms: timeoutMs,
    };
  }

  function clipConsoleText(raw, maxChars) {
    const value = String(raw ?? "");
    if (value.length <= maxChars) return value;
    return `${value.slice(0, Math.max(0, maxChars - 1))}…`;
  }

  function consoleTimestampMs(raw) {
    const value = Number(raw);
    if (!Number.isFinite(value) || value <= 0) return Date.now();
    return value < 100_000_000_000 ? Math.round(value * 1_000) : Math.round(value);
  }

  function remoteArgumentText(argument = {}) {
    if (Object.prototype.hasOwnProperty.call(argument, "value")) {
      if (typeof argument.value === "string") return clipConsoleText(argument.value, 512);
      try {
        return clipConsoleText(JSON.stringify(argument.value), 512);
      } catch {
        return clipConsoleText(String(argument.value), 512);
      }
    }
    if (argument.unserializableValue !== undefined) {
      return clipConsoleText(argument.unserializableValue, 512);
    }
    if (argument.description !== undefined) {
      return clipConsoleText(argument.description, 512);
    }
    return clipConsoleText(argument.type || "undefined", 512);
  }

  function compactStackTrace(stackTrace, includeStackTrace) {
    if (!includeStackTrace) return undefined;
    const callFrames = Array.isArray(stackTrace?.callFrames) ? stackTrace.callFrames : [];
    return callFrames.slice(0, 8).map((frame) => ({
      function_name: clipConsoleText(frame?.functionName || "", 256),
      url: clipConsoleText(frame?.url || "", 512),
      line_number: Number(frame?.lineNumber || 0),
      column_number: Number(frame?.columnNumber || 0),
    }));
  }

  function runtimeConsoleEntry(params = {}, options = {}) {
    const argumentPreview = (Array.isArray(params.args) ? params.args : [])
      .slice(0, 20)
      .map(remoteArgumentText);
    return {
      source: "runtime_console",
      level: String(params.type || "log"),
      text: clipConsoleText(argumentPreview.join(" "), 8_000),
      argument_count: Array.isArray(params.args) ? params.args.length : 0,
      argument_preview: argumentPreview,
      execution_context_id: Number(params.executionContextId || 0) || undefined,
      timestamp_ms: consoleTimestampMs(params.timestamp),
      stack_trace: compactStackTrace(params.stackTrace, options.include_stack_trace),
    };
  }

  function runtimeExceptionEntry(params = {}, options = {}) {
    const details = params.exceptionDetails || {};
    const exceptionText = details.exception?.description
      || details.exception?.value
      || details.text
      || "Uncaught exception";
    return {
      source: "runtime_exception",
      level: "error",
      text: clipConsoleText(exceptionText, 8_000),
      exception_id: Number(details.exceptionId || 0) || undefined,
      execution_context_id: Number(details.executionContextId || 0) || undefined,
      timestamp_ms: consoleTimestampMs(details.timestamp),
      stack_trace: compactStackTrace(details.stackTrace, options.include_stack_trace),
    };
  }

  function logDomainEntry(params = {}, options = {}) {
    const entry = params.entry || {};
    return {
      source: `log_${String(entry.source || "other")}`,
      level: String(entry.level || "info"),
      text: clipConsoleText(entry.text || "", 8_000),
      timestamp_ms: consoleTimestampMs(entry.timestamp),
      url: options.include_stack_trace ? clipConsoleText(entry.url || "", 512) : undefined,
      line_number: options.include_stack_trace ? Number(entry.lineNumber || 0) : undefined,
      stack_trace: compactStackTrace(entry.stackTrace, options.include_stack_trace),
    };
  }

  function measuredEntry(entry) {
    const measured = { ...entry, entry_chars: 0 };
    for (let index = 0; index < 3; index += 1) {
      measured.entry_chars = JSON.stringify(measured).length;
    }
    return { entry: measured, chars: JSON.stringify(measured).length };
  }

  function fitConsoleEntry(entry, remainingChars) {
    const full = measuredEntry(entry);
    if (full.chars <= remainingChars) return full;
    const minimal = {
      source: entry.source,
      level: entry.level,
      text: "",
      timestamp_ms: entry.timestamp_ms,
      truncated: true,
    };
    let low = 0;
    let high = String(entry.text || "").length;
    let best = null;
    while (low <= high) {
      const middle = Math.floor((low + high) / 2);
      const candidate = measuredEntry({
        ...minimal,
        text: clipConsoleText(entry.text || "", middle),
      });
      if (candidate.chars <= remainingChars) {
        best = candidate;
        low = middle + 1;
      } else {
        high = middle - 1;
      }
    }
    return best;
  }

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

  async function acquireDebuggerQueue(tabId, operation, deadline = null) {
    const previous = debuggerQueues.get(tabId) || Promise.resolve();
    let releaseGate;
    const gate = new Promise((resolve) => { releaseGate = resolve; });
    const tail = previous.catch(() => {}).then(() => gate);
    debuggerQueues.set(tabId, tail);
    const queuedAt = Date.now();
    try {
      if (deadline) {
        await deadline.run(
          () => previous.catch(() => {}),
          "debugger_queue_wait",
          {
            reserve_ms: deadline.cleanup_reserve_ms,
            details: { operation, tab_id: tabId },
          },
        );
      } else {
        await previous.catch(() => {});
      }
    } catch (error) {
      releaseGate();
      tail.finally(() => {
        if (debuggerQueues.get(tabId) === tail) debuggerQueues.delete(tabId);
      });
      throw error;
    }
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

  async function withDebuggerQueues(tabIds, operation, deadline, callback) {
    if (typeof deadline === "function") {
      callback = deadline;
      deadline = null;
    }
    const normalized = [...new Set(tabIds)].sort((left, right) => left - right);
    const leases = [];
    try {
      for (const tabId of normalized) {
        leases.push(await acquireDebuggerQueue(tabId, operation, deadline));
      }
      return await callback(leases.map((lease) => lease.receipt));
    } finally {
      for (const lease of leases.reverse()) lease.release();
    }
  }

  async function attachDebugger(tabId, operation, deadline = null, reserveMs = 0) {
    try {
      const attach = () => chrome.debugger.attach({ tabId }, "1.3");
      if (deadline) {
        await deadline.run(attach, "debugger_attach", {
          reserve_ms: reserveMs,
          details: { operation, tab_id: tabId },
        });
      } else {
        await attach();
      }
    } catch (error) {
      if (error?.code === "TIMEOUT") throw error;
      throw debuggerError(error, tabId, operation);
    }
  }

  async function detachDebugger(tabId, deadline = null, reserveMs = 0) {
    if (tabId === null) return { detached: false, reason: "not_attached" };
    try {
      const detach = () => chrome.debugger.detach({ tabId });
      if (deadline) {
        await deadline.run(detach, "debugger_detach", {
          reserve_ms: reserveMs,
          details: { tab_id: tabId },
        });
      } else {
        await detach();
      }
      return { detached: true, reason: "released" };
    } catch (error) {
      // A closed tab or service-worker detach is already a terminal release.
      return {
        detached: false,
        reason: "already_terminal_or_unavailable",
        error: String(error?.message || error),
      };
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
    const deadline = createDebuggerDeadline(message.timeoutMs ?? message.timeout_ms);
    return withDebuggerQueues(tabIds, "batch", deadline, async (leaseReceipts) => {
      const results = [];
      const metricsOverrides = new Set();
      const cleanup = [];
      let attachedTabId = null;
      let debuggerDetach = { detached: false, reason: "not_attached" };
      let debuggerReleaseVerified = true;
      let outcome;
      let timedOut = false;

      async function switchDebugger(tabId, cleanupMode = false) {
        if (attachedTabId === tabId) return;
        const switchedDetach = await detachDebugger(
          attachedTabId,
          deadline,
          cleanupMode ? deadline.detach_reserve_ms : deadline.cleanup_reserve_ms,
        );
        if (
          attachedTabId !== null
          && switchedDetach.detached !== true
          && switchedDetach.reason !== "not_attached"
        ) {
          debuggerReleaseVerified = false;
        }
        attachedTabId = null;
        await attachDebugger(
          tabId,
          "batch",
          deadline,
          cleanupMode ? deadline.detach_reserve_ms : deadline.cleanup_reserve_ms,
        );
        attachedTabId = tabId;
      }

      try {
        for (const rawCommand of message.commands) {
          const commandIndex = results.length;
          const command = globalThis.browser67ResolveBatchReferences(
            rawCommand,
            results,
            { command_index: commandIndex },
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
          await switchDebugger(tabId, false);
          const response = await deadline.run(
            () => chrome.debugger.sendCommand(
              { tabId },
              command.method,
              command.params || {},
            ),
            "debugger_batch_command",
            {
              reserve_ms: deadline.cleanup_reserve_ms,
              details: {
                command_index: commandIndex,
                method: String(command.method || ""),
                tab_id: tabId,
              },
            },
          );
          results.push(response);
          if (command.method === "Emulation.setDeviceMetricsOverride") metricsOverrides.add(tabId);
          if (command.method === "Emulation.clearDeviceMetricsOverride") metricsOverrides.delete(tabId);
        }
        outcome = { ok: true, results };
      } catch (error) {
        const normalized = error?.code ? error : debuggerError(error, attachedTabId, "batch");
        timedOut = normalized?.code === "TIMEOUT";
        outcome = {
          ok: false,
          error: String(normalized.message || normalized),
          errorCode: String(normalized.code || "DEBUGGER_OPERATION_FAILED"),
          errorDetails: normalized.details,
          results,
        };
      } finally {
        const cleanupTabIds = [
          ...(attachedTabId !== null && metricsOverrides.has(attachedTabId) ? [attachedTabId] : []),
          ...[...metricsOverrides].filter((tabId) => tabId !== attachedTabId),
        ];
        for (const tabId of cleanupTabIds) {
          try {
            await switchDebugger(tabId, true);
            await deadline.run(
              () => chrome.debugger.sendCommand(
                { tabId },
                "Emulation.clearDeviceMetricsOverride",
                {},
              ),
              "viewport_override_cleanup",
              {
                reserve_ms: deadline.detach_reserve_ms,
                details: { method: "Emulation.clearDeviceMetricsOverride", tab_id: tabId },
              },
            );
            cleanup.push({ tab_id: tabId, cleared: true });
          } catch (error) {
            cleanup.push({ tab_id: tabId, cleared: false, error: String(error?.message || error) });
          }
        }
        if (attachedTabId !== null) {
          debuggerDetach = await detachDebugger(attachedTabId, deadline);
          if (debuggerDetach.detached !== true) debuggerReleaseVerified = false;
          if (timedOut) {
            cleanup.push({
              tab_id: attachedTabId,
              cancelled_inflight: debuggerDetach.detached === true,
              detach: debuggerDetach,
            });
          }
          attachedTabId = null;
        }
      }

      const cleanupFailed = cleanup.some((entry) => (
        Object.prototype.hasOwnProperty.call(entry, "cleared") && entry.cleared !== true
      ));
      if (cleanupFailed && outcome.ok === true) {
        outcome = {
          ok: false,
          error: "debugger batch completed but viewport override cleanup failed",
          errorCode: "VIEWPORT_CLEANUP_FAILED",
          errorDetails: { cleanup },
          results,
        };
      } else if (!debuggerReleaseVerified && outcome.ok === true) {
        outcome = {
          ok: false,
          error: "debugger batch completed but debugger release is unverified",
          errorCode: "DEBUGGER_RELEASE_UNVERIFIED",
          errorDetails: { cleanup, debugger_detach: debuggerDetach },
          results,
        };
      } else if (cleanup.length > 0) {
        outcome.errorDetails = { ...(outcome.errorDetails || {}), cleanup };
      }
      outcome.debuggerLease = {
        serialized: true,
        leases: leaseReceipts,
        timeout: deadline.snapshot(outcome.ok === true ? "completed" : "failed"),
      };
      outcome.debuggerCleanup = {
        debugger_detach: debuggerDetach,
        debugger_released: debuggerReleaseVerified,
        viewport_overrides: cleanup,
      };
      return outcome;
    });
  }

  async function browser67HandleDebuggerCommand(message, sender, helpers = {}) {
    const normalizeTabId = helpers.normalizeNumericTabId;
    const tabId = normalizeTabId(message.tabId ?? sender?.tab?.id);
    if (tabId === null) {
      return { ok: false, error: "invalid or missing numeric tabId", errorCode: "INVALID_ARGUMENT" };
    }
    const operation = String(message.method || "cdp");
    const deadline = createDebuggerDeadline(message.timeoutMs ?? message.timeout_ms);
    return withDebuggerQueues([tabId], operation, deadline, async (leaseReceipts) => {
      let attached = false;
      let detached = { detached: false, reason: "not_attached" };
      let outcome;
      try {
        await attachDebugger(tabId, operation, deadline, deadline.cleanup_reserve_ms);
        attached = true;
        const result = await deadline.run(
          () => chrome.debugger.sendCommand({ tabId }, message.method, message.params || {}),
          "debugger_command",
          {
            reserve_ms: deadline.cleanup_reserve_ms,
            details: { method: operation, tab_id: tabId },
          },
        );
        outcome = {
          ok: true,
          data: result,
          debuggerLease: { serialized: true, leases: leaseReceipts },
        };
      } catch (error) {
        const normalized = error?.code ? error : debuggerError(error, tabId, String(message.method || "cdp"));
        outcome = {
          ok: false,
          error: String(normalized.message || normalized),
          errorCode: String(normalized.code || "DEBUGGER_OPERATION_FAILED"),
          errorDetails: normalized.details,
          debuggerLease: { serialized: true, leases: leaseReceipts },
        };
      } finally {
        if (attached) detached = await detachDebugger(tabId, deadline);
      }
      const debuggerReleased = detached.detached === true || detached.reason === "not_attached";
      if (outcome.ok === true && !debuggerReleased) {
        outcome = {
          ok: false,
          error: "debugger command completed but debugger release is unverified",
          errorCode: "DEBUGGER_RELEASE_UNVERIFIED",
          errorDetails: { debugger_detach: detached },
          debuggerLease: outcome.debuggerLease,
        };
      }
      outcome.debuggerCleanup = {
        debugger_detach: detached,
        debugger_released: debuggerReleased,
      };
      return outcome;
    });
  }

  async function browser67HandleConsoleObservation(message, sender, helpers = {}) {
    const normalizeTabId = helpers.normalizeNumericTabId;
    const tabId = normalizeTabId(message.tabId ?? sender?.tab?.id);
    if (tabId === null) {
      return { ok: false, error: "invalid or missing numeric tabId", errorCode: "INVALID_ARGUMENT" };
    }
    if (
      !chrome.debugger.onEvent
      || typeof chrome.debugger.onEvent.addListener !== "function"
      || typeof chrome.debugger.onEvent.removeListener !== "function"
    ) {
      return {
        ok: false,
        error: "chrome.debugger.onEvent is unavailable",
        errorCode: "CONSOLE_OBSERVATION_UNAVAILABLE",
      };
    }

    const options = {
      duration_ms: boundedInteger(message.durationMs, 1_000, 50, 30_000),
      max_entries: boundedInteger(message.maxEntries, 100, 1, 500),
      max_total_chars: boundedInteger(message.maxTotalChars, 100_000, 1_000, 300_000),
      include_log_entries: message.includeLogEntries !== false,
      include_stack_trace: message.includeStackTrace === true,
    };

    return withDebuggerQueues([tabId], "console.observe", async (leaseReceipts) => {
      const entries = [];
      const sourceCounts = {};
      const levelCounts = {};
      const cleanupErrors = [];
      let attached = false;
      let runtimeEnabled = false;
      let logEnabled = false;
      let totalChars = 0;
      let droppedEntries = 0;
      let stopReason = "";
      let detachReason = "";
      let observationStartedAt = 0;
      let resolveObservation;
      let timer = null;
      const observationDone = new Promise((resolve) => { resolveObservation = resolve; });

      function finish(reason) {
        if (stopReason) return;
        stopReason = reason;
        resolveObservation();
      }

      function appendEntry(entry) {
        if (stopReason) return;
        if (entries.length >= options.max_entries) {
          droppedEntries += 1;
          finish("max_entries");
          return;
        }
        const fitted = fitConsoleEntry(entry, options.max_total_chars - totalChars);
        if (!fitted) {
          droppedEntries += 1;
          finish("max_total_chars");
          return;
        }
        entries.push(fitted.entry);
        totalChars += fitted.chars;
        sourceCounts[fitted.entry.source] = Number(sourceCounts[fitted.entry.source] || 0) + 1;
        levelCounts[fitted.entry.level] = Number(levelCounts[fitted.entry.level] || 0) + 1;
        if (entries.length >= options.max_entries) finish("max_entries");
        else if (totalChars >= options.max_total_chars) finish("max_total_chars");
      }

      const onEvent = (source, method, params) => {
        if (Number(source?.tabId) !== tabId) return;
        if (method === "Runtime.consoleAPICalled") {
          appendEntry(runtimeConsoleEntry(params, options));
          return;
        }
        if (method === "Runtime.exceptionThrown") {
          appendEntry(runtimeExceptionEntry(params, options));
          return;
        }
        if (method === "Log.entryAdded" && options.include_log_entries) {
          appendEntry(logDomainEntry(params, options));
        }
      };
      const onDetach = (source, reason) => {
        if (Number(source?.tabId) !== tabId) return;
        attached = false;
        detachReason = String(reason || "debugger_detached");
        finish("target_detached");
      };

      let failure = null;
      let detached = { detached: false, reason: "not_attached" };
      const setupStartedAt = Date.now();
      try {
        chrome.debugger.onEvent.addListener(onEvent);
        if (chrome.debugger.onDetach?.addListener) chrome.debugger.onDetach.addListener(onDetach);
        await attachDebugger(tabId, "console.observe");
        attached = true;
        await chrome.debugger.sendCommand({ tabId }, "Runtime.enable", {});
        runtimeEnabled = true;
        if (options.include_log_entries) {
          await chrome.debugger.sendCommand({ tabId }, "Log.enable", {});
          logEnabled = true;
        }
        observationStartedAt = Date.now();
        timer = setTimeout(() => finish("duration_elapsed"), options.duration_ms);
        await observationDone;
      } catch (error) {
        failure = error?.code ? error : debuggerError(error, tabId, "console.observe");
      } finally {
        if (timer !== null) clearTimeout(timer);
        chrome.debugger.onEvent.removeListener(onEvent);
        if (chrome.debugger.onDetach?.removeListener) chrome.debugger.onDetach.removeListener(onDetach);
        if (attached && logEnabled) {
          try {
            await chrome.debugger.sendCommand({ tabId }, "Log.disable", {});
          } catch (error) {
            cleanupErrors.push({ operation: "Log.disable", error: String(error?.message || error) });
          }
        }
        if (attached && runtimeEnabled) {
          try {
            await chrome.debugger.sendCommand({ tabId }, "Runtime.disable", {});
          } catch (error) {
            cleanupErrors.push({ operation: "Runtime.disable", error: String(error?.message || error) });
          }
        }
        if (attached) detached = await detachDebugger(tabId);
      }

      const endedAt = Date.now();
      const debuggerLease = { serialized: true, leases: leaseReceipts };
      const debuggerReleased = detached.detached === true || stopReason === "target_detached";
      if (!failure && !debuggerReleased) {
        failure = Object.assign(new Error("console observation debugger release is unverified"), {
          code: "DEBUGGER_RELEASE_UNVERIFIED",
          details: { debugger_detach: detached, stop_reason: stopReason || "completed" },
        });
      }
      if (failure) {
        return {
          ok: false,
          error: String(failure.message || failure),
          errorCode: String(failure.code || "DEBUGGER_OPERATION_FAILED"),
          errorDetails: {
            ...(failure.details || {}),
            cleanup_errors: cleanupErrors,
            listeners_removed: true,
            debugger_released: debuggerReleased,
            debugger_detach: detached,
          },
          debuggerLease,
        };
      }

      return {
        ok: true,
        data: {
          schema: "browser67.console-observation.v1",
          status: "success",
          tab_id: String(tabId),
          started_at: new Date(observationStartedAt || setupStartedAt).toISOString(),
          ended_at: new Date(endedAt).toISOString(),
          setup_ms: Math.max(0, (observationStartedAt || endedAt) - setupStartedAt),
          observed_ms: Math.max(0, endedAt - (observationStartedAt || endedAt)),
          requested_duration_ms: options.duration_ms,
          stop_reason: stopReason || "completed",
          detach_reason: detachReason || undefined,
          entries,
          entry_count: entries.length,
          dropped_entries: droppedEntries,
          total_chars: totalChars,
          source_counts: sourceCounts,
          level_counts: levelCounts,
          limits: {
            max_entries: options.max_entries,
            max_total_chars: options.max_total_chars,
          },
          coverage: {
            runtime_console: "from_Runtime.enable",
            runtime_exception: "from_Runtime.enable",
            log_entries: options.include_log_entries
              ? "Log.enable_may_include_buffered_entries"
              : "disabled",
          },
          persistent_debugger: false,
          cleanup: {
            listeners_removed: true,
            debugger_released: debuggerReleased,
            debugger_detach: detached,
            errors: cleanupErrors,
          },
          debugger_lease: debuggerLease,
        },
      };
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
  globalThis.browser67HandleConsoleObservation = browser67HandleConsoleObservation;
  globalThis.browser67DebuggerStatus = browser67DebuggerStatus;
})();
