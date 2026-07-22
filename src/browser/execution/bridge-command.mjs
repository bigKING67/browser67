function parseBridgeCommand(script) {
  if (typeof script === "object" && script !== null && !Array.isArray(script)) {
    return typeof script.cmd === "string" && script.cmd.trim() ? script : undefined;
  }
  if (typeof script !== "string") return undefined;
  const trimmed = script.trim();
  if (!trimmed.startsWith("{")) return undefined;
  let parsed;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    return undefined;
  }
  if (!parsed || Array.isArray(parsed) || typeof parsed !== "object") return undefined;
  return typeof parsed.cmd === "string" && parsed.cmd.trim() ? parsed : undefined;
}

export { parseBridgeCommand };
