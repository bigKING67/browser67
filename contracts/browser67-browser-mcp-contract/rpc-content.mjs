import assert from "node:assert/strict";

function parseJsonContentItem(item) {
  if (item?.type === "json" && typeof item.json === "object" && item.json !== null) {
    return item.json;
  }
  if (item?.type === "text" && typeof item.text === "string") {
    try {
      const parsed = JSON.parse(item.text);
      if (typeof parsed === "object" && parsed !== null) {
        return parsed;
      }
    } catch {
      return null;
    }
  }
  return null;
}

function firstOutcomeContent(result) {
  const content = Array.isArray(result?.content) ? result.content : [];
  for (const item of content) {
    const parsed = parseJsonContentItem(item);
    if (parsed) {
      return parsed;
    }
  }
  return null;
}

function firstJsonContent(result) {
  const parsed = firstOutcomeContent(result);
  if (parsed?.schema !== "browser67.tool-outcome.v3") {
    return parsed;
  }
  if (parsed.ok === true) {
    return parsed.data;
  }
  return {
    status: "error",
    tool: parsed.meta?.tool,
    error: parsed.error?.message,
    error_code: parsed.error?.code,
    retryable: parsed.error?.retryable,
    details: parsed.error?.details,
    transport_attempts: parsed.meta?.transport_attempts,
    at: parsed.meta?.completed_at,
  };
}

function assertTextJsonContent(result, label) {
  const content = Array.isArray(result?.content) ? result.content : [];
  assert.equal(content.length > 0, true, `${label} must return MCP content`);
  assert.equal(
    content.some((item) => item?.type === "json"),
    false,
    `${label} must not return non-standard MCP content type=json`,
  );
  assert.equal(
    content.some((item) => item?.type === "text" && parseJsonContentItem(item) !== null),
    true,
    `${label} must return JSON encoded as MCP text content`,
  );
}

export {
  assertTextJsonContent,
  firstJsonContent,
  firstOutcomeContent,
};
