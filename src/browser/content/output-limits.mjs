function compactText(value, maxLength) {
  const normalized = String(value ?? "").replace(/\s+/g, " ").trim();
  if (normalized.length <= maxLength) return normalized;
  return `${normalized.slice(0, Math.max(1, maxLength - 1))}…`;
}

function clipContent(value, maxChars) {
  const text = String(value ?? "");
  if (text.length <= maxChars) {
    return { value: text, truncated: false, original_length: text.length };
  }
  return {
    value: `${text.slice(0, maxChars)}\n\n[TRUNCATED ${String(text.length - maxChars)} chars]`,
    truncated: true,
    original_length: text.length,
  };
}

export {
  clipContent,
  compactText,
};
