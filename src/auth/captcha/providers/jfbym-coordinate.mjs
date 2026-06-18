import { readFile } from "node:fs/promises";

import {
  clientPointToScreenEstimate,
  finiteNumber,
  roundCoordinate,
} from "../coordinates.mjs";
import { CAPTCHA_ASSIST_REASONS } from "../reasons.mjs";
import {
  kindAllowed,
  loadJfbymProviderRuntimeConfig,
  normalizeKindList,
  originAllowed,
} from "./config.mjs";
import {
  callJfbymCoordinateApi,
  providerMessage,
  providerStatusCode,
} from "./jfbym-client.mjs";

const PROTOCOL_KINDS_AS_CHECKBOX = new Set(["hcaptcha", "recaptcha", "turnstile"]);

function normalizeProviderKind(kind = "") {
  const value = String(kind || "").trim().toLowerCase();
  return PROTOCOL_KINDS_AS_CHECKBOX.has(value) ? value : value;
}

function imageCoordinateKind(kind = "") {
  return PROTOCOL_KINDS_AS_CHECKBOX.has(kind) ? "checkbox" : kind;
}

function redactArtifact(artifact = {}) {
  if (!artifact || typeof artifact !== "object") return undefined;
  return {
    path: artifact.path,
    sha256: artifact.sha256,
    mime_type: artifact.mime_type,
    bytes: artifact.bytes,
    width: artifact.width,
    height: artifact.height,
    clip: artifact.clip,
    fullscreen: artifact.fullscreen === true,
    ttl_ms: artifact.ttl_ms,
    created_at: artifact.created_at,
    expires_at: artifact.expires_at,
  };
}

function selectVisionArtifact(plan = {}) {
  return plan.coordinate_transform?.vision_correction?.artifact
    ?? plan.coordinate_transform?.vision_correction_plan?.correction_artifact
    ?? null;
}

function coordinateScale(artifact = {}) {
  const clip = artifact.clip ?? {};
  const imageWidth = finiteNumber(artifact.width);
  const imageHeight = finiteNumber(artifact.height);
  const clipWidth = finiteNumber(clip.width);
  const clipHeight = finiteNumber(clip.height);
  if (
    imageWidth === null
    || imageHeight === null
    || clipWidth === null
    || clipHeight === null
    || imageWidth <= 0
    || imageHeight <= 0
    || clipWidth <= 0
    || clipHeight <= 0
  ) {
    return null;
  }
  return {
    x: clipWidth / imageWidth,
    y: clipHeight / imageHeight,
  };
}

function imagePointToClient(point = {}, artifact = {}) {
  const clip = artifact.clip ?? {};
  const scale = coordinateScale(artifact);
  const x = finiteNumber(point.x);
  const y = finiteNumber(point.y);
  const clipX = finiteNumber(clip.x);
  const clipY = finiteNumber(clip.y);
  if (!scale || x === null || y === null || clipX === null || clipY === null) return null;
  return {
    x: roundCoordinate(clipX + x * scale.x),
    y: roundCoordinate(clipY + y * scale.y),
    coordinate_system: "viewport_css_pixels",
  };
}

function pointToScreen(point = {}, viewport = {}) {
  const screen = clientPointToScreenEstimate(point, viewport);
  return screen ? {
    x: screen.x,
    y: screen.y,
    coordinate_system: "screen_pixels_estimate",
    method: screen.method,
    confidence: screen.confidence,
  } : null;
}

function numbersFromString(value) {
  return String(value ?? "")
    .match(/-?\d+(?:\.\d+)?/g)
    ?.map((entry) => Number(entry))
    .filter((entry) => Number.isFinite(entry)) ?? [];
}

function pointFromObject(value = {}) {
  const x = finiteNumber(value.x ?? value.left ?? value.target_x ?? value.px);
  const y = finiteNumber(value.y ?? value.top ?? value.target_y ?? value.py);
  return x === null || y === null ? null : { x, y };
}

function pointsFromAny(data) {
  if (Array.isArray(data)) {
    return data.map((entry) => {
      if (Array.isArray(entry)) {
        const x = finiteNumber(entry[0]);
        const y = finiteNumber(entry[1]);
        return x === null || y === null ? null : { x, y };
      }
      if (entry && typeof entry === "object") return pointFromObject(entry);
      return null;
    }).filter(Boolean);
  }
  if (data && typeof data === "object") {
    const objectPoint = pointFromObject(data);
    if (objectPoint) return [objectPoint];
    return pointsFromAny(data.points ?? data.coordinates ?? data.coords ?? data.list ?? data.data);
  }
  const text = String(data ?? "");
  const groups = text.split(/[|;]/g)
    .map((group) => numbersFromString(group))
    .filter((numbers) => numbers.length >= 2)
    .map((numbers) => ({ x: numbers[0], y: numbers[1] }));
  if (groups.length > 0) return groups;
  const numbers = numbersFromString(text);
  const points = [];
  for (let index = 0; index + 1 < numbers.length; index += 2) {
    points.push({ x: numbers[index], y: numbers[index + 1] });
  }
  return points;
}

function scalarFromAny(data, names = []) {
  if (data && typeof data === "object" && !Array.isArray(data)) {
    for (const name of names) {
      const value = finiteNumber(data[name]);
      if (value !== null) return value;
    }
    return scalarFromAny(data.data ?? data.result ?? data.value, names);
  }
  if (Array.isArray(data)) {
    const value = finiteNumber(data[0]);
    return value;
  }
  const [value] = numbersFromString(data);
  return Number.isFinite(value) ? value : null;
}

function responseData(responseJson = {}) {
  const data = responseJson.data;
  if (data && typeof data === "object" && !Array.isArray(data)) {
    return data.data
      ?? data.result
      ?? data.res
      ?? data.value
      ?? data.coordinates
      ?? data;
  }
  return data ?? responseJson.result ?? responseJson.value ?? responseJson;
}

function responseConfidence(responseJson = {}) {
  const candidates = [
    responseJson.confidence,
    responseJson.score,
    responseJson.data?.confidence,
    responseJson.data?.score,
  ];
  for (const raw of candidates) {
    const value = finiteNumber(raw);
    if (value !== null) {
      return value > 1 ? Math.min(1, value / 100) : Math.max(0, value);
    }
  }
  return null;
}

function successCode(code) {
  return code === 10000 || code === 0 || code === "10000" || code === "0" || code === "success";
}

function parseJfbymCoordinateResponse(responseJson = {}, {
  captcha_kind = "checkbox",
  min_confidence = 0.65,
} = {}) {
  const code = providerStatusCode(responseJson);
  const message = providerMessage(responseJson);
  if (!successCode(code)) {
    return {
      ok: false,
      reason: CAPTCHA_ASSIST_REASONS.PROVIDER_COORDINATE_SOLVER_FAILED,
      provider_id: "jfbym",
      provider_code: code,
      provider_message: message,
      secrets_redacted: true,
    };
  }
  const data = responseData(responseJson);
  const confidence = responseConfidence(responseJson);
  if (confidence !== null && confidence < min_confidence) {
    return {
      ok: false,
      reason: CAPTCHA_ASSIST_REASONS.PROVIDER_COORDINATES_CONFIDENCE_TOO_LOW,
      provider_id: "jfbym",
      provider_code: code,
      provider_message: message,
      confidence,
      minimum_confidence: min_confidence,
      secrets_redacted: true,
    };
  }
  const kind = imageCoordinateKind(captcha_kind);
  const points = pointsFromAny(data);
  const distance = scalarFromAny(data, ["distance", "offset", "move", "dx", "x"]);
  const angle = scalarFromAny(data, ["angle", "rotate", "degree"]);

  if (kind === "rotate") {
    if (angle === null) {
      return {
        ok: false,
        reason: CAPTCHA_ASSIST_REASONS.PROVIDER_COORDINATES_UNAVAILABLE,
        provider_id: "jfbym",
        provider_code: code,
        provider_message: message,
        secrets_redacted: true,
      };
    }
    return {
      ok: true,
      provider_id: "jfbym",
      provider_code: code,
      provider_message: message,
      captcha_kind,
      parsed_kind: kind,
      confidence: confidence ?? undefined,
      rotate_angle_degrees: angle,
      secrets_redacted: true,
    };
  }

  if (kind === "slider") {
    if (points.length === 0 && distance === null) {
      return {
        ok: false,
        reason: CAPTCHA_ASSIST_REASONS.PROVIDER_COORDINATES_UNAVAILABLE,
        provider_id: "jfbym",
        provider_code: code,
        provider_message: message,
        secrets_redacted: true,
      };
    }
    return {
      ok: true,
      provider_id: "jfbym",
      provider_code: code,
      provider_message: message,
      captcha_kind,
      parsed_kind: kind,
      confidence: confidence ?? undefined,
      image_points: points,
      distance_px: distance ?? undefined,
      secrets_redacted: true,
    };
  }

  if (points.length === 0) {
    return {
      ok: false,
      reason: CAPTCHA_ASSIST_REASONS.PROVIDER_COORDINATES_UNAVAILABLE,
      provider_id: "jfbym",
      provider_code: code,
      provider_message: message,
      secrets_redacted: true,
    };
  }
  return {
    ok: true,
    provider_id: "jfbym",
    provider_code: code,
    provider_message: message,
    captcha_kind,
    parsed_kind: kind,
    confidence: confidence ?? undefined,
    image_points: points,
    secrets_redacted: true,
  };
}

function fallbackSliderFromClient(plan = {}, artifact = {}) {
  const from = plan.slider_drag_hint?.from_client;
  if (from?.x !== undefined && from?.y !== undefined) {
    return from;
  }
  const clip = artifact.clip ?? {};
  const clipX = finiteNumber(clip.x);
  const clipY = finiteNumber(clip.y);
  const clipWidth = finiteNumber(clip.width);
  const clipHeight = finiteNumber(clip.height);
  if (clipX === null || clipY === null || clipWidth === null || clipHeight === null) return null;
  return {
    x: roundCoordinate(clipX + Math.max(6, Math.min(42, clipWidth * 0.12))),
    y: roundCoordinate(clipY + clipHeight / 2),
  };
}

function materializeJfbymCoordinateResult(parsed = {}, {
  plan = {},
  artifact = {},
  slider_result_mode = "target_x",
} = {}) {
  if (parsed.ok !== true) return parsed;
  const viewport = plan.viewport ?? {};
  const targetKind = parsed.parsed_kind;
  if (targetKind === "rotate") {
    return {
      ...parsed,
      status: "blocked",
      reason: CAPTCHA_ASSIST_REASONS.PROVIDER_COORDINATES_UNAVAILABLE,
      unsupported_physical_action: "rotate_angle_not_mapped_to_mouse_input",
      artifact: redactArtifact(artifact),
      secrets_redacted: true,
    };
  }
  if (targetKind === "slider") {
    const fromClient = fallbackSliderFromClient(plan, artifact);
    if (!fromClient) {
      return {
        ...parsed,
        ok: false,
        reason: CAPTCHA_ASSIST_REASONS.PROVIDER_COORDINATES_UNAVAILABLE,
        artifact: redactArtifact(artifact),
        secrets_redacted: true,
      };
    }
    const firstPoint = parsed.image_points?.[0];
    const targetClient = firstPoint ? imagePointToClient(firstPoint, artifact) : null;
    const scale = coordinateScale(artifact);
    const distance = finiteNumber(parsed.distance_px);
    let toClient = null;
    let interpretation = slider_result_mode;
    if (slider_result_mode === "distance" && distance !== null && scale) {
      toClient = {
        x: roundCoordinate(fromClient.x + distance * scale.x),
        y: roundCoordinate(fromClient.y),
        coordinate_system: "viewport_css_pixels",
      };
    } else if (targetClient) {
      toClient = {
        x: targetClient.x,
        y: roundCoordinate(fromClient.y),
        coordinate_system: "viewport_css_pixels",
      };
    } else if (distance !== null && scale) {
      toClient = {
        x: roundCoordinate(fromClient.x + distance * scale.x),
        y: roundCoordinate(fromClient.y),
        coordinate_system: "viewport_css_pixels",
      };
      interpretation = "distance_fallback";
    }
    if (toClient && toClient.x <= fromClient.x && distance !== null && scale) {
      toClient = {
        x: roundCoordinate(fromClient.x + distance * scale.x),
        y: roundCoordinate(fromClient.y),
        coordinate_system: "viewport_css_pixels",
      };
      interpretation = "distance_fallback_after_nonforward_target";
    }
    const fromScreen = pointToScreen(fromClient, viewport);
    const toScreen = toClient ? pointToScreen(toClient, viewport) : null;
    if (!fromScreen || !toScreen) {
      return {
        ...parsed,
        ok: false,
        reason: CAPTCHA_ASSIST_REASONS.PROVIDER_COORDINATES_UNAVAILABLE,
        artifact: redactArtifact(artifact),
        secrets_redacted: true,
      };
    }
    return {
      ...parsed,
      coordinate_system: "screen_pixels",
      provider_coordinate_source: "jfbym_region_image",
      slider_result_interpretation: interpretation,
      image_artifact: redactArtifact(artifact),
      viewport_coordinates: {
        from: fromClient,
        to: toClient,
      },
      screen_coordinates: {
        x: fromScreen.x,
        y: fromScreen.y,
        to_x: toScreen.x,
        to_y: toScreen.y,
        coordinate_system: "screen_pixels",
        source: "jfbym_coordinate_solver",
      },
      secrets_redacted: true,
    };
  }

  const firstPoint = parsed.image_points?.[0];
  const clickClient = firstPoint ? imagePointToClient(firstPoint, artifact) : null;
  const clickScreen = clickClient ? pointToScreen(clickClient, viewport) : null;
  if (!clickClient || !clickScreen) {
    return {
      ...parsed,
      ok: false,
      reason: CAPTCHA_ASSIST_REASONS.PROVIDER_COORDINATES_UNAVAILABLE,
      artifact: redactArtifact(artifact),
      secrets_redacted: true,
    };
  }
  return {
    ...parsed,
    coordinate_system: "screen_pixels",
    provider_coordinate_source: "jfbym_region_image",
    image_artifact: redactArtifact(artifact),
    viewport_coordinates: {
      click: clickClient,
    },
    screen_coordinates: {
      x: clickScreen.x,
      y: clickScreen.y,
      coordinate_system: "screen_pixels",
      source: "jfbym_coordinate_solver",
    },
    image_click_points: parsed.image_points?.length > 1 ? parsed.image_points : undefined,
    secrets_redacted: true,
  };
}

function providerBlock(reason, extras = {}) {
  return {
    ok: false,
    status: "blocked",
    provider_id: "jfbym",
    reason,
    ...extras,
    secrets_redacted: true,
  };
}

function validateConfig(config = {}, plan = {}) {
  const kind = normalizeProviderKind(plan.captcha_kind || plan.assist_target || "checkbox");
  const allowedKinds = normalizeKindList(config.allowed_kinds);
  const effectiveKindAllowed = allowedKinds.includes(kind) || (
    PROTOCOL_KINDS_AS_CHECKBOX.has(kind) && allowedKinds.includes("checkbox")
  );
  if (config.configured !== true || !config.token) {
    return providerBlock(CAPTCHA_ASSIST_REASONS.PROVIDER_COORDINATE_SOLVER_NOT_CONFIGURED, {
      configured: config.configured === true,
      token_configured: Boolean(config.token),
    });
  }
  if (config.coordinate_solver_enabled !== true) {
    return providerBlock(CAPTCHA_ASSIST_REASONS.PROVIDER_COORDINATE_SOLVER_NOT_CONFIGURED, {
      coordinate_solver_enabled: false,
    });
  }
  if (originAllowed(config, plan.origin) !== true) {
    return providerBlock(CAPTCHA_ASSIST_REASONS.PROVIDER_COORDINATE_ORIGIN_NOT_ALLOWLISTED, {
      origin: plan.origin,
      allowed_origins: config.allowed_origins,
    });
  }
  if (!effectiveKindAllowed && kindAllowed(config, kind) !== true) {
    return providerBlock(CAPTCHA_ASSIST_REASONS.PROVIDER_COORDINATE_SOLVER_NOT_CONFIGURED, {
      captcha_kind: kind,
      allowed_kinds: config.allowed_kinds,
    });
  }
  return null;
}

async function solveJfbymCoordinateChallenge({
  args = {},
  plan = {},
  fetch_impl,
  provider_response,
} = {}) {
  const config = await loadJfbymProviderRuntimeConfig(args);
  const configBlock = validateConfig(config, plan);
  if (configBlock) return configBlock;

  const artifact = selectVisionArtifact(plan);
  if (!artifact?.path || artifact.fullscreen === true) {
    return providerBlock(CAPTCHA_ASSIST_REASONS.PROVIDER_COORDINATE_ARTIFACT_REQUIRED, {
      artifact_available: Boolean(artifact?.path),
      fullscreen_allowed: false,
      required: "run_vision_correction:true",
    });
  }

  const captchaKind = normalizeProviderKind(plan.captcha_kind || plan.assist_target || "checkbox");
  const typeId = config.coordinate_type_ids?.[captchaKind]
    ?? config.coordinate_type_ids?.[imageCoordinateKind(captchaKind)]
    ?? config.coordinate_type_ids?.checkbox;
  const imageBytes = await readFile(artifact.path);
  const request = {
    type_id: typeId,
    image_base64: imageBytes.toString("base64"),
    extra: config.coordinate_extra?.[captchaKind]
      || config.coordinate_extra?.[imageCoordinateKind(captchaKind)]
      || "",
  };
  const providerResult = provider_response
    ? { ok: true, json: provider_response, attempts: 0, provider_id: "jfbym", secrets_redacted: true }
    : await callJfbymCoordinateApi(config, request, { fetch_impl });
  if (!providerResult.json) {
    return providerBlock(CAPTCHA_ASSIST_REASONS.PROVIDER_COORDINATE_SOLVER_FAILED, {
      attempts: providerResult.attempts,
      provider_error: providerResult.reason,
      error: providerResult.error,
    });
  }
  const parsed = parseJfbymCoordinateResponse(providerResult.json, {
    captcha_kind: captchaKind,
    min_confidence: config.min_confidence,
  });
  if (parsed.ok !== true) {
    return {
      ...parsed,
      status: "blocked",
      attempts: providerResult.attempts,
      provider_type_id: typeId,
      secrets_redacted: true,
    };
  }
  const materialized = materializeJfbymCoordinateResult(parsed, {
    plan,
    artifact,
    slider_result_mode: config.slider_result_mode,
  });
  return {
    ...materialized,
    status: materialized.ok === true ? "success" : "blocked",
    attempts: providerResult.attempts,
    provider_type_id: typeId,
    request_shape: {
      endpoint: "customApi",
      has_image_base64: true,
      has_token: true,
      has_extra: Boolean(request.extra),
      image_bytes: imageBytes.length,
    },
    secrets_redacted: true,
  };
}

export {
  imagePointToClient,
  materializeJfbymCoordinateResult,
  parseJfbymCoordinateResponse,
  selectVisionArtifact,
  solveJfbymCoordinateChallenge,
};
