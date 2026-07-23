function batchReferenceError(code, message, details = {}) {
  return Object.assign(new Error(message), {
    name: "BatchReferenceError",
    code,
    details,
  });
}

function resolveBatchPath(input, path, reference) {
  if (!path) return input;
  let current = input;
  for (const token of path.split(".")) {
    if (current === null || current === undefined) {
      throw batchReferenceError("BATCH_REFERENCE_PATH_UNRESOLVED", `batch reference path is unresolved: ${reference}`, { reference, token });
    }
    if (Array.isArray(current) && /^\d+$/.test(token)) {
      const index = Number(token);
      if (index >= current.length) {
        throw batchReferenceError("BATCH_REFERENCE_PATH_UNRESOLVED", `batch reference array index is unavailable: ${reference}`, { reference, token });
      }
      current = current[index];
      continue;
    }
    if ((typeof current !== "object" && typeof current !== "function") || !Object.hasOwn(current, token)) {
      throw batchReferenceError("BATCH_REFERENCE_PATH_UNRESOLVED", `batch reference key is unavailable: ${reference}`, { reference, token });
    }
    current = current[token];
  }
  return current;
}

function resolveReferenceString(value, results, commandIndex) {
  const matched = /^\$(\d+)(?:\.(.+))?$/.exec(value);
  if (!matched) return { matched: false, value };
  const resultIndex = Number(matched[1]);
  if (!Number.isInteger(resultIndex) || resultIndex < 0 || resultIndex >= results.length) {
    throw batchReferenceError("BATCH_REFERENCE_INDEX_UNAVAILABLE", `batch reference index is unavailable: ${value}`, {
      command_index: commandIndex,
      reference: value,
      result_index: resultIndex,
      available_results: results.length,
    });
  }
  return { matched: true, value: resolveBatchPath(results[resultIndex], matched[2] || "", value) };
}

function resolveBatchReferences(value, results, options = {}, seen = new WeakSet()) {
  const commandIndex = Number(options.command_index ?? results.length);
  if (typeof value === "string") {
    const resolved = resolveReferenceString(value, results, commandIndex);
    return resolved.matched ? resolveBatchReferences(resolved.value, results, options, seen) : value;
  }
  if (value === null || typeof value === "boolean" || typeof value === "number") return value;
  if (typeof value === "bigint" || value === undefined || typeof value === "function" || typeof value === "symbol") {
    throw batchReferenceError("BATCH_REFERENCE_UNSUPPORTED_VALUE", "batch commands must contain JSON-compatible values", {
      command_index: commandIndex,
      value_type: typeof value,
    });
  }
  if (typeof value !== "object") return value;
  if (seen.has(value)) {
    throw batchReferenceError("BATCH_REFERENCE_CYCLE", "batch command contains a cyclic value", { command_index: commandIndex });
  }
  seen.add(value);
  try {
    if (Array.isArray(value)) return value.map((item) => resolveBatchReferences(item, results, options, seen));
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
      throw batchReferenceError("BATCH_REFERENCE_UNSUPPORTED_VALUE", "batch commands must use plain objects", {
        command_index: commandIndex,
        value_type: prototype?.constructor?.name || "object",
      });
    }
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [
      key,
      resolveBatchReferences(item, results, options, seen),
    ]));
  } finally {
    seen.delete(value);
  }
}

function extensionBatchReferenceSource() {
  return [
    "// --- browser67 generated batch reference core ---",
    batchReferenceError.toString(),
    resolveBatchPath.toString(),
    resolveReferenceString.toString(),
    resolveBatchReferences.toString(),
    "globalThis.browser67ResolveBatchReferences = resolveBatchReferences;",
    "// --- end browser67 generated batch reference core ---",
  ].join("\n\n");
}

export {
  batchReferenceError,
  extensionBatchReferenceSource,
  resolveBatchPath,
  resolveBatchReferences,
};
