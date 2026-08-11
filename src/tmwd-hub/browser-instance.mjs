function normalizeBrowserInstanceId(raw) {
  const value = String(raw ?? "").trim();
  return value.length > 0
    && value.length <= 128
    && /^[A-Za-z0-9._-]+$/u.test(value)
    ? value
    : "";
}

function sessionKey(browserInstanceId, tabId) {
  const instance = normalizeBrowserInstanceId(browserInstanceId);
  const tab = String(tabId ?? "").trim();
  if (!instance || !tab) return "";
  return `${instance}:${tab}`;
}

function browserInstanceError(code, message, details = {}) {
  const error = new Error(message);
  error.errorCode = code;
  error.details = details;
  return error;
}

export {
  browserInstanceError,
  normalizeBrowserInstanceId,
  sessionKey,
};
