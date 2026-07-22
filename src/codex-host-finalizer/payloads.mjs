function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseJsonText(text) {
  if (typeof text !== "string") {
    return null;
  }
  const trimmed = text.trim();
  if (!trimmed || !["{", "["].includes(trimmed[0])) {
    return null;
  }
  try {
    return JSON.parse(trimmed);
  } catch {
    return null;
  }
}

function extractJsonPayloads(input) {
  const payloads = [];
  const seen = new Set();
  const pushPayload = (value) => {
    if (!isRecord(value) || seen.has(value)) return;
    seen.add(value);
    payloads.push(value);
  };
  const visit = (value, depth = 0) => {
    if (depth > 4 || value == null) return;
    if (typeof value === "string") {
      const parsed = parseJsonText(value);
      if (parsed) visit(parsed, depth + 1);
      return;
    }
    if (Array.isArray(value)) {
      for (const item of value) visit(item, depth + 1);
      return;
    }
    if (!isRecord(value)) return;
    if (value.type === "text" && typeof value.text === "string") {
      visit(value.text, depth + 1);
      return;
    }
    if (Array.isArray(value.content)) {
      for (const item of value.content) {
        visit(item?.type === "text" && typeof item.text === "string" ? item.text : item, depth + 1);
      }
    }
    if (Array.isArray(value.result?.content)) visit(value.result.content, depth + 1);
    pushPayload(value);
  };
  visit(input);
  return payloads;
}

function collectFinalizeHintsFromToolResult(toolResult, context = {}) {
  const hints = [];
  for (const payload of extractJsonPayloads(toolResult)) {
    if (isRecord(payload.finalize_hint)) {
      hints.push({ hint: payload.finalize_hint, context });
    }
    if (Array.isArray(payload.finalize_hints)) {
      for (const hint of payload.finalize_hints) {
        if (isRecord(hint)) hints.push({ hint, context });
      }
    }
  }
  return hints;
}

export { collectFinalizeHintsFromToolResult, isRecord };
