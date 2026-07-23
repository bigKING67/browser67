const OUTPUT_MODES = new Set(["compact", "full"]);

function resolveOutputMode(args = {}, fallback = "full") {
  const requested = String(args?.output_mode ?? "").trim();
  if (OUTPUT_MODES.has(requested)) return requested;
  return OUTPUT_MODES.has(fallback) ? fallback : "full";
}

function compactTransportAttempt(attempt = {}) {
  const health = attempt.health && typeof attempt.health === "object"
    ? {
        transport: attempt.health.transport,
        consecutive_failures: attempt.health.consecutive_failures,
        backed_off: attempt.health.backed_off,
        retry_after: attempt.health.retry_after,
      }
    : undefined;
  return {
    transport: attempt.transport,
    phase: attempt.phase,
    status: attempt.status,
    reason: attempt.reason,
    health,
  };
}

function compactTransportAttempts(attempts) {
  return Array.isArray(attempts) ? attempts.map(compactTransportAttempt) : attempts;
}

function compactSession(session = {}) {
  return {
    id: session.id ?? session.tab_id,
    title: session.title,
    url: session.url,
    active: session.active,
    is_default: session.is_default,
    is_latest: session.is_latest,
  };
}

function selectedSessions(sessions = [], page = null) {
  const selectedId = String(page?.tab_id ?? "").trim();
  const selected = sessions.filter((session) => {
    const id = String(session?.id ?? session?.tab_id ?? "").trim();
    return (selectedId && id === selectedId)
      || session?.active === true
      || session?.is_default === true
      || session?.is_latest === true;
  });
  const rows = (selected.length > 0 ? selected : sessions.slice(0, 1)).slice(0, 3);
  return rows.map((session) => compactSession(session));
}

function compactCommonDiagnostics(data, page) {
  if (!data || typeof data !== "object" || Array.isArray(data)) return data;
  const next = { ...data };
  if (Array.isArray(data.transport_attempts)) {
    next.transport_attempts = compactTransportAttempts(data.transport_attempts);
  }
  if (Array.isArray(data.sessions)) {
    next.session_summary = {
      count: data.sessions.length,
      selected: selectedSessions(data.sessions, page),
    };
    delete next.sessions;
  }
  return next;
}

function compactToolData(toolName, data, page, options = {}) {
  if (options.mode !== "compact") return data;
  if (["browser_tab_ops", "browser_tab_lifecycle", "browser_transport_health"].includes(toolName)) {
    return data;
  }
  return compactCommonDiagnostics(data, page);
}

export {
  compactCommonDiagnostics,
  compactTransportAttempts,
  compactToolData,
  resolveOutputMode,
};
