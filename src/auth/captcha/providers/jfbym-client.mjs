function sanitizeProviderError(error) {
  return String(error?.message ?? error ?? "unknown_error")
    .replace(/Bearer\s+[A-Za-z0-9._~+/-]+/gi, "Bearer <redacted>")
    .replace(/token[=:]\s*[A-Za-z0-9._~+/-]{8,}/gi, "token=<redacted>")
    .slice(0, 300);
}

function providerStatusCode(responseJson = {}) {
  const raw = responseJson.code
    ?? responseJson.status
    ?? responseJson.err_no
    ?? responseJson.error_code
    ?? responseJson.ret;
  const numeric = Number(raw);
  return Number.isFinite(numeric) ? numeric : raw;
}

function providerMessage(responseJson = {}) {
  return String(
    responseJson.msg
      ?? responseJson.message
      ?? responseJson.err_str
      ?? responseJson.error
      ?? "",
  ).slice(0, 300);
}

async function postJfbymCustomApi(config = {}, payload = {}, {
  fetch_impl: fetchImpl = globalThis.fetch,
} = {}) {
  if (typeof fetchImpl !== "function") {
    return {
      ok: false,
      reason: "fetch_unavailable",
      provider_id: "jfbym",
      secrets_redacted: true,
    };
  }
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), config.timeout_ms);
  try {
    const response = await fetchImpl(config.base_url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
    const text = await response.text();
    let json = null;
    try {
      json = JSON.parse(text);
    } catch {
      json = {
        code: response.status,
        msg: text.slice(0, 300),
      };
    }
    return {
      ok: response.ok,
      http_status: response.status,
      json,
      provider_id: "jfbym",
      secrets_redacted: true,
    };
  } catch (error) {
    return {
      ok: false,
      reason: error?.name === "AbortError" ? "provider_request_timeout" : "provider_request_failed",
      error: sanitizeProviderError(error),
      provider_id: "jfbym",
      secrets_redacted: true,
    };
  } finally {
    clearTimeout(timeout);
  }
}

async function callJfbymCoordinateApi(config = {}, request = {}, options = {}) {
  let lastFailure = null;
  const attempts = Math.max(1, Math.min(3, Number(config.max_attempts) || 1));
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const result = await postJfbymCustomApi(config, {
      token: config.token,
      type: request.type_id,
      image: request.image_base64,
      ...(request.extra ? { extra: request.extra } : {}),
    }, options);
    if (result.ok === true || result.json) {
      return {
        ...result,
        attempts: attempt,
      };
    }
    lastFailure = result;
  }
  return {
    ok: false,
    attempts,
    provider_id: "jfbym",
    reason: lastFailure?.reason || "provider_request_failed",
    error: lastFailure?.error,
    secrets_redacted: true,
  };
}

export {
  callJfbymCoordinateApi,
  providerMessage,
  providerStatusCode,
  sanitizeProviderError,
};
