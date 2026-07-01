import assert from "node:assert/strict";

const FORBIDDEN_TOP_LEVEL_SCHEMA_KEYS = ["oneOf", "anyOf", "allOf", "enum", "not"];
const FORBIDDEN_COMPOSITION_SCHEMA_KEYS = ["oneOf", "anyOf", "allOf", "not"];

function assertNoCompositionKeywords(value, path) {
  if (!value || typeof value !== "object") {
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((item, index) => assertNoCompositionKeywords(item, `${path}[${String(index)}]`));
    return;
  }
  for (const key of FORBIDDEN_COMPOSITION_SCHEMA_KEYS) {
    assert.equal(
      Object.prototype.hasOwnProperty.call(value, key),
      false,
      `${path} must not use JSON Schema composition keyword ${key}`,
    );
  }
  for (const [key, child] of Object.entries(value)) {
    assertNoCompositionKeywords(child, `${path}.${key}`);
  }
}

function assertOpenAiToolSchemaCompatibility(tools, serverName) {
  assert.equal(Array.isArray(tools), true, `${serverName} tools/list must return tools array`);
  for (const tool of tools) {
    const name = String(tool?.name ?? "<unnamed>");
    const schema = tool?.inputSchema;
    const path = `${serverName}.${name}.inputSchema`;
    assert.equal(schema && typeof schema === "object" && !Array.isArray(schema), true, `${path} must be an object`);
    assert.equal(schema.type, "object", `${path} top-level type must be object`);
    assert.equal(schema.properties && typeof schema.properties === "object", true, `${path}.properties must be an object`);
    for (const key of FORBIDDEN_TOP_LEVEL_SCHEMA_KEYS) {
      assert.equal(
        Object.prototype.hasOwnProperty.call(schema, key),
        false,
        `${path} must not include top-level ${key}; OpenAI function parameters reject it`,
      );
    }
    // Property-level enum is intentionally allowed; composition keywords are not needed
    // for these MCP tools and have caused Codex/OpenAI schema registration failures.
    assertNoCompositionKeywords(schema, path);
  }
}

export { assertOpenAiToolSchemaCompatibility };
