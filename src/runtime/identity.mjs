import { createHash } from "node:crypto";

function nowIso() {
  return new Date().toISOString();
}

function hashText(value) {
  return createHash("sha1").update(String(value ?? "")).digest("hex");
}

function randomId(prefix) {
  return `${String(prefix)}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

export {
  hashText,
  nowIso,
  randomId,
};
