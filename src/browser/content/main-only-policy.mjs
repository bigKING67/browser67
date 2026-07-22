function normalizeMainOnlyMinChars(raw) {
  const parsed = Number(raw ?? 600);
  if (!Number.isFinite(parsed)) return 600;
  return Math.max(100, Math.min(10_000, Math.floor(parsed)));
}

function normalizeMainOnlyMinCoverage(raw) {
  const parsed = Number(raw ?? 0.35);
  if (!Number.isFinite(parsed)) return 0.35;
  return Math.max(0.05, Math.min(0.95, parsed));
}

function applyMainOnlyGuardrail(mainText, fullText, args) {
  const main = String(mainText ?? "");
  const full = String(fullText ?? "");
  const fallbackToFull = args?.main_only_fallback_to_full !== false;
  const minChars = normalizeMainOnlyMinChars(args?.main_only_min_chars);
  const minCoverage = normalizeMainOnlyMinCoverage(args?.main_only_min_coverage);
  const mainLength = main.length;
  const fullLength = full.length;
  const coverage = fullLength > 0 ? mainLength / fullLength : 1;
  const reasons = [];
  if (mainLength === 0) reasons.push("empty_main");
  if (mainLength > 0 && mainLength < minChars) reasons.push("below_min_chars");
  if (fullLength > 0 && coverage < minCoverage) reasons.push("below_min_coverage");
  if (fullLength === 0 && reasons.length > 0) reasons.push("full_empty");
  const fallbackApplied = fallbackToFull && reasons.length > 0 && fullLength > 0;
  return {
    content: fallbackApplied ? full : main,
    metadata: {
      enabled: true,
      fallback_to_full: fallbackToFull,
      fallback_applied: fallbackApplied,
      fallback_reason: reasons.length > 0 ? reasons.join("+") : "none",
      min_chars: minChars,
      min_coverage: minCoverage,
      main_length: mainLength,
      full_length: fullLength,
      main_coverage: Number(coverage.toFixed(4)),
      main_only_effective: !fallbackApplied,
    },
  };
}

export {
  applyMainOnlyGuardrail,
  normalizeMainOnlyMinChars,
  normalizeMainOnlyMinCoverage,
};
