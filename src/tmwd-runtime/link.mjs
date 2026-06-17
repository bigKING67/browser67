import {
  normalizeTimeoutMs,
  normalizeTmwdLinkEndpoint,
} from "../common.mjs";

async function callTmwdLink(args, payload, timeoutMsOverride) {
  const endpoint = normalizeTmwdLinkEndpoint(args?.tmwd_link_endpoint ?? process.env.BROWSER_STRUCTURED_TMWD_LINK_ENDPOINT);
  const timeoutMs = timeoutMsOverride ?? Math.min(15_000, normalizeTimeoutMs(args?.timeout_ms));
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
    if (!response.ok) {
      throw new Error(`tmwd link failed status=${String(response.status)}`);
    }
    const parsed = await response.json();
    if (typeof parsed !== "object" || parsed === null || !("r" in parsed)) {
      throw new Error("tmwd link returned invalid payload");
    }
    return {
      endpoint,
      value: parsed.r,
    };
  } catch (error) {
    if (error?.name === "AbortError") {
      throw new Error(`tmwd link timeout after ${String(timeoutMs)}ms`);
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

export {
  callTmwdLink,
};
