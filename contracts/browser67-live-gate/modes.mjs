function normalizeTmwdMode(value) {
  const normalized = String(value ?? "").trim().toLowerCase();
  if (normalized === "auto" || normalized === "tmwd" || normalized === "remote_cdp" || normalized === "cdp") {
    return normalized;
  }
  throw new Error("invalid --tmwd-mode value (expected auto|tmwd|remote_cdp|cdp)");
}

function isRemoteCdpMode(mode) {
  return mode === "remote_cdp" || mode === "cdp";
}

function isTmwdReadyPath(readiness) {
  return readiness?.ready === true
    && (readiness.path === "tmwd_ws" || readiness.path === "tmwd_link");
}

function isCdpReadyPath(readiness) {
  return readiness?.ready === true && readiness.path === "cdp";
}

function shouldSuggestRemoteCdp(config, doctorPayload) {
  if (isRemoteCdpMode(config.tmwd_mode)) {
    return true;
  }
  if (config.tmwd_mode === "tmwd") {
    return false;
  }
  return !isTmwdReadyPath(doctorPayload?.readiness) && !isCdpReadyPath(doctorPayload?.readiness);
}

export {
  isCdpReadyPath,
  isRemoteCdpMode,
  isTmwdReadyPath,
  normalizeTmwdMode,
  shouldSuggestRemoteCdp,
};
