function normalizeTmwdTransportLabel(transport) {
  return transport === "ws" ? "tmwd_ws" : "tmwd_link";
}

function appendTransportAttempt(attempts, transport, phase, status, options = {}) {
  attempts.push({
    transport: normalizeTmwdTransportLabel(transport),
    phase,
    status,
    reason: options.reason,
    message: options.message,
    error_code: options.error_code,
  });
}

function mergeTransportAttempts(primary, secondary) {
  const first = Array.isArray(primary) ? primary : [];
  const second = Array.isArray(secondary) ? secondary : [];
  return [...first, ...second];
}

export {
  appendTransportAttempt,
  mergeTransportAttempts,
  normalizeTmwdTransportLabel,
};
