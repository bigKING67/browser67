import { trimTrailingSlash } from "./endpoints.mjs";

function abortableFetchTimeout(timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  return {
    controller,
    clear: () => clearTimeout(timer),
  };
}

function errorDetail(error) {
  return String(error?.name === "AbortError" ? "timeout" : (error?.message ?? error));
}

async function readJsonResponse(response) {
  const text = await response.text();
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

async function probeCdpHttp(cdpEndpoint, timeoutMs) {
  const base = trimTrailingSlash(cdpEndpoint);
  const endpoint = `${base}/json/version`;
  const startedAt = Date.now();
  const timeout = abortableFetchTimeout(timeoutMs);
  try {
    const response = await fetch(endpoint, {
      method: "GET",
      signal: timeout.controller.signal,
    });
    const parsed = await readJsonResponse(response);
    return {
      endpoint,
      ok: response.ok,
      status: response.status,
      latency_ms: Date.now() - startedAt,
      browser: typeof parsed?.Browser === "string" ? parsed.Browser : undefined,
      websocket_debugger_url: typeof parsed?.webSocketDebuggerUrl === "string"
        ? parsed.webSocketDebuggerUrl
        : undefined,
      detail: response.ok ? "http_ok" : `http_${String(response.status)}`,
    };
  } catch (error) {
    return {
      endpoint,
      ok: false,
      status: null,
      latency_ms: Date.now() - startedAt,
      detail: errorDetail(error),
    };
  } finally {
    timeout.clear();
  }
}

async function probeCdpTargets(cdpEndpoint, timeoutMs) {
  const base = trimTrailingSlash(cdpEndpoint);
  const endpoint = `${base}/json/list`;
  const startedAt = Date.now();
  const timeout = abortableFetchTimeout(timeoutMs);
  try {
    const response = await fetch(endpoint, {
      method: "GET",
      signal: timeout.controller.signal,
    });
    const parsed = await readJsonResponse(response);
    const rows = Array.isArray(parsed) ? parsed : [];
    const pageCount = rows.filter((item) => item?.type === "page").length;
    return {
      endpoint,
      ok: response.ok && Array.isArray(parsed),
      status: response.status,
      latency_ms: Date.now() - startedAt,
      page_count: pageCount,
      detail: response.ok
        ? (Array.isArray(parsed) ? "http_ok_with_list" : "http_ok_invalid_json")
        : `http_${String(response.status)}`,
    };
  } catch (error) {
    return {
      endpoint,
      ok: false,
      status: null,
      latency_ms: Date.now() - startedAt,
      page_count: 0,
      detail: errorDetail(error),
    };
  } finally {
    timeout.clear();
  }
}

export {
  probeCdpHttp,
  probeCdpTargets,
};
