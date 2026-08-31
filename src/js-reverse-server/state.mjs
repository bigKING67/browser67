const DEFAULT_JS_REVERSE_STATE_LIMITS = Object.freeze({
  hooks_per_scope: 128,
  hooks_global: 1_024,
  evidence_per_scope: 512,
  evidence_global: 4_096,
  evidence_bytes_per_scope: 4 * 1024 * 1024,
  evidence_bytes_global: 32 * 1024 * 1024,
  ttl_ms: 24 * 60 * 60 * 1_000,
});

function normalizedScopeValue(raw) {
  return String(raw ?? "").trim() || "default";
}

function resolveJsReverseScope(args = {}) {
  const workspaceKey = normalizedScopeValue(args.workspace_key ?? args.workspaceKey);
  const taskId = normalizedScopeValue(args.task_id ?? args.taskId);
  return {
    workspace_key: workspaceKey,
    task_id: taskId,
    key: JSON.stringify([workspaceKey, taskId]),
  };
}

function cloned(value) {
  return structuredClone(value);
}

function serializedBytes(value) {
  return Buffer.byteLength(JSON.stringify(value), "utf8");
}

function positiveLimit(raw, fallback) {
  const value = Number(raw);
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : fallback;
}

class JsReverseStateStore {
  constructor(options = {}) {
    const configured = options.limits ?? {};
    this.limits = Object.freeze(Object.fromEntries(
      Object.entries(DEFAULT_JS_REVERSE_STATE_LIMITS).map(([name, fallback]) => [
        name,
        positiveLimit(configured[name], fallback),
      ]),
    ));
    this.now = typeof options.now === "function" ? options.now : Date.now;
    this.hooks = new Map();
    this.evidence = [];
    this.sequence = 0;
  }

  #timestamp() {
    return Number(this.now());
  }

  #hookKey(scope, hookId) {
    return `${scope.key}\u0000${String(hookId)}`;
  }

  #pruneExpired() {
    const expiresBefore = this.#timestamp() - this.limits.ttl_ms;
    for (const [key, row] of this.hooks.entries()) {
      if (row.updated_at_ms <= expiresBefore) this.hooks.delete(key);
    }
    this.evidence = this.evidence.filter((row) => row.created_at_ms > expiresBefore);
  }

  #trimHooks(scopeKey) {
    const scoped = [...this.hooks.entries()]
      .filter(([, row]) => row.scope.key === scopeKey)
      .sort((left, right) => left[1].sequence - right[1].sequence);
    while (scoped.length > this.limits.hooks_per_scope) {
      const [key] = scoped.shift();
      this.hooks.delete(key);
    }
    const global = [...this.hooks.entries()]
      .sort((left, right) => left[1].sequence - right[1].sequence);
    while (global.length > this.limits.hooks_global) {
      const [key] = global.shift();
      this.hooks.delete(key);
    }
  }

  #trimEvidenceRows(predicate, maxCount, maxBytes) {
    const matching = () => this.evidence
      .map((row, index) => ({ row, index }))
      .filter(({ row }) => predicate(row));
    let rows = matching();
    let bytes = rows.reduce((total, item) => total + item.row.bytes, 0);
    while (rows.length > maxCount || bytes > maxBytes) {
      const oldest = rows[0];
      bytes -= oldest.row.bytes;
      this.evidence.splice(oldest.index, 1);
      rows = matching();
    }
  }

  #trimEvidence(scopeKey) {
    this.#trimEvidenceRows(
      (row) => row.scope.key === scopeKey,
      this.limits.evidence_per_scope,
      this.limits.evidence_bytes_per_scope,
    );
    this.#trimEvidenceRows(
      () => true,
      this.limits.evidence_global,
      this.limits.evidence_bytes_global,
    );
  }

  setHook(args, hook) {
    this.#pruneExpired();
    const scope = resolveJsReverseScope(args);
    const id = String(hook?.id ?? "").trim();
    if (!id) throw new Error("js-reverse hook id is required");
    const key = this.#hookKey(scope, id);
    const nowMs = this.#timestamp();
    this.hooks.delete(key);
    this.hooks.set(key, {
      scope,
      value: cloned(hook),
      updated_at_ms: nowMs,
      sequence: this.sequence += 1,
    });
    this.#trimHooks(scope.key);
    return this.getHook(args, id);
  }

  getHook(args, hookId) {
    this.#pruneExpired();
    const scope = resolveJsReverseScope(args);
    const row = this.hooks.get(this.#hookKey(scope, hookId));
    return row ? cloned(row.value) : undefined;
  }

  listHooks(args = {}) {
    this.#pruneExpired();
    const scope = resolveJsReverseScope(args);
    return [...this.hooks.values()]
      .filter((row) => row.scope.key === scope.key)
      .sort((left, right) => left.sequence - right.sequence)
      .map((row) => cloned(row.value));
  }

  appendEvidence(args, evidence) {
    this.#pruneExpired();
    const scope = resolveJsReverseScope(args);
    const value = cloned(evidence);
    this.evidence.push({
      scope,
      value,
      bytes: serializedBytes(value),
      created_at_ms: this.#timestamp(),
      sequence: this.sequence += 1,
    });
    this.#trimEvidence(scope.key);
    return cloned(value);
  }

  listEvidence(args = {}) {
    this.#pruneExpired();
    const scope = resolveJsReverseScope(args);
    return this.evidence
      .filter((row) => row.scope.key === scope.key)
      .sort((left, right) => left.sequence - right.sequence)
      .map((row) => cloned(row.value));
  }

  clearScope(args = {}) {
    this.#pruneExpired();
    const scope = resolveJsReverseScope(args);
    let hooksRemoved = 0;
    for (const [key, row] of this.hooks.entries()) {
      if (row.scope.key !== scope.key) continue;
      this.hooks.delete(key);
      hooksRemoved += 1;
    }
    const evidenceBefore = this.evidence.length;
    this.evidence = this.evidence.filter((row) => row.scope.key !== scope.key);
    return {
      scope: { workspace_key: scope.workspace_key, task_id: scope.task_id },
      hooks_removed: hooksRemoved,
      evidence_removed: evidenceBefore - this.evidence.length,
    };
  }

  clearAll() {
    const result = {
      scope: "all",
      hooks_removed: this.hooks.size,
      evidence_removed: this.evidence.length,
    };
    this.hooks.clear();
    this.evidence = [];
    return result;
  }

  dispose() {
    return this.clearAll();
  }

  stats() {
    this.#pruneExpired();
    const scopeKeys = new Set([
      ...[...this.hooks.values()].map((row) => row.scope.key),
      ...this.evidence.map((row) => row.scope.key),
    ]);
    return {
      hooks_count: this.hooks.size,
      evidence_count: this.evidence.length,
      evidence_bytes: this.evidence.reduce((total, row) => total + row.bytes, 0),
      scopes_count: scopeKeys.size,
    };
  }
}

function createJsReverseStateStore(options = {}) {
  return new JsReverseStateStore(options);
}

const jsReverseState = createJsReverseStateStore();

function setServerHook(args, hook) {
  return jsReverseState.setHook(args, hook);
}

function getServerHook(args, hookId) {
  return jsReverseState.getHook(args, hookId);
}

function listServerHooks(args) {
  return jsReverseState.listHooks(args);
}

function appendServerEvidence(args, evidence) {
  return jsReverseState.appendEvidence(args, evidence);
}

function listServerEvidence(args) {
  return jsReverseState.listEvidence(args);
}

function clearJsReverseStateScope(args = {}) {
  const all = String(args.scope ?? "").trim().toLowerCase() === "all"
    || args.all === true
    || args.confirm_all === true;
  return all ? jsReverseState.clearAll() : jsReverseState.clearScope(args);
}

function disposeJsReverseState() {
  return jsReverseState.dispose();
}

export {
  DEFAULT_JS_REVERSE_STATE_LIMITS,
  JsReverseStateStore,
  appendServerEvidence,
  clearJsReverseStateScope,
  createJsReverseStateStore,
  disposeJsReverseState,
  getServerHook,
  listServerEvidence,
  listServerHooks,
  resolveJsReverseScope,
  setServerHook,
};
