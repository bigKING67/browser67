const CDP_DEFAULT_ENDPOINT = "http://127.0.0.1:9222";
const TMWD_LINK_DEFAULT_ENDPOINT = "http://127.0.0.1:18766/link";
const TMWD_WS_DEFAULT_ENDPOINT = "ws://127.0.0.1:18765";

function normalizeEndpoint(raw) {
  const endpoint = String(raw ?? CDP_DEFAULT_ENDPOINT).trim();
  return (endpoint || CDP_DEFAULT_ENDPOINT).replace(/\/$/, "");
}

function normalizeTmwdLinkEndpoint(raw) {
  const endpoint = String(raw ?? TMWD_LINK_DEFAULT_ENDPOINT).trim();
  return (endpoint || TMWD_LINK_DEFAULT_ENDPOINT).replace(/\/$/, "");
}

function normalizeTmwdWsEndpoint(raw) {
  const endpoint = String(raw ?? TMWD_WS_DEFAULT_ENDPOINT).trim();
  return endpoint || TMWD_WS_DEFAULT_ENDPOINT;
}

function resolveTmwdMode(raw) {
  const normalized = String(raw ?? process.env.BROWSER_STRUCTURED_TMWD_MODE ?? "auto").trim().toLowerCase();
  if (normalized === "tmwd") return "tmwd";
  if (normalized === "cdp" || normalized === "remote_cdp") return "cdp";
  return "auto";
}

function resolveTmwdTransport(raw) {
  const normalized = String(raw ?? process.env.BROWSER_STRUCTURED_TMWD_TRANSPORT ?? "auto").trim().toLowerCase();
  if (normalized === "ws") return "ws";
  if (normalized === "link") return "link";
  return "auto";
}

export {
  CDP_DEFAULT_ENDPOINT,
  TMWD_LINK_DEFAULT_ENDPOINT,
  TMWD_WS_DEFAULT_ENDPOINT,
  normalizeEndpoint,
  normalizeTmwdLinkEndpoint,
  normalizeTmwdWsEndpoint,
  resolveTmwdMode,
  resolveTmwdTransport,
};
