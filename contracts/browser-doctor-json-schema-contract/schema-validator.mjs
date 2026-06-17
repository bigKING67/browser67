import { readFile } from "node:fs/promises";

import { schemaPath } from "./paths.mjs";

function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function loadSchema() {
  const parsed = JSON.parse(await readFile(schemaPath, "utf8"));
  if (!isRecord(parsed)) {
    throw new Error("browser doctor schema must be a JSON object");
  }
  return parsed;
}

function resolveRef(rootSchema, ref) {
  if (typeof ref !== "string" || !ref.startsWith("#/")) {
    throw new Error(`unsupported schema ref: ${String(ref)}`);
  }
  let current = rootSchema;
  for (const rawPart of ref.slice(2).split("/")) {
    const part = rawPart.replace(/~1/g, "/").replace(/~0/g, "~");
    if (!isRecord(current) || !(part in current)) {
      throw new Error(`schema ref not found: ${ref}`);
    }
    current = current[part];
  }
  if (!isRecord(current)) {
    throw new Error(`schema ref must resolve to object: ${ref}`);
  }
  return current;
}

function valueMatchesType(value, typeName) {
  if (typeName === "null") {
    return value === null;
  }
  if (typeName === "array") {
    return Array.isArray(value);
  }
  if (typeName === "object") {
    return isRecord(value);
  }
  if (typeName === "integer") {
    return Number.isInteger(value);
  }
  if (typeName === "number") {
    return typeof value === "number" && Number.isFinite(value);
  }
  return typeof value === typeName;
}

function validateSchemaValue(rootSchema, schema, value, path = "$") {
  if (!isRecord(schema)) {
    throw new Error(`schema at ${path} must be object`);
  }
  if (schema.$ref) {
    validateSchemaValue(rootSchema, resolveRef(rootSchema, schema.$ref), value, path);
    return;
  }

  if (schema.type) {
    const types = Array.isArray(schema.type) ? schema.type : [schema.type];
    const matched = types.some((typeName) => valueMatchesType(value, typeName));
    if (!matched) {
      throw new Error(`${path} expected type ${types.join("|")}, got ${Array.isArray(value) ? "array" : typeof value}`);
    }
  }

  if (Array.isArray(schema.enum) && !schema.enum.includes(value)) {
    throw new Error(`${path} expected one of ${schema.enum.join(", ")}, got ${String(value)}`);
  }

  if (Array.isArray(schema.required)) {
    if (!isRecord(value)) {
      throw new Error(`${path} required fields need object value`);
    }
    for (const key of schema.required) {
      if (!(key in value)) {
        throw new Error(`${path}.${key} is required`);
      }
    }
  }

  if (isRecord(schema.properties) && isRecord(value)) {
    for (const [key, childSchema] of Object.entries(schema.properties)) {
      if (key in value) {
        validateSchemaValue(rootSchema, childSchema, value[key], `${path}.${key}`);
      }
    }
  }

  if (isRecord(schema.items) && Array.isArray(value)) {
    for (let index = 0; index < value.length; index += 1) {
      validateSchemaValue(rootSchema, schema.items, value[index], `${path}[${String(index)}]`);
    }
  }
}

export {
  loadSchema,
  validateSchemaValue,
};
