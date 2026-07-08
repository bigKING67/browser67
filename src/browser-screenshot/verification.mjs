const CSS_VIEWPORT_TOLERANCE_PX = 1;
const PNG_DIMENSION_TOLERANCE_PX = 2;

function positiveFiniteNumber(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function dimensionDelta(actual, expected) {
  if (actual === null || expected === null) {
    return null;
  }
  return Math.abs(actual - expected);
}

function axisCheck({
  actual,
  expected,
  tolerance,
}) {
  const normalizedActual = positiveFiniteNumber(actual);
  const normalizedExpected = positiveFiniteNumber(expected);
  const delta = dimensionDelta(normalizedActual, normalizedExpected);
  return {
    ok: delta !== null && delta <= tolerance,
    actual: normalizedActual ?? actual ?? null,
    expected: normalizedExpected ?? expected ?? null,
    delta,
    tolerance,
  };
}

function requestedViewportDimensions(viewportOverrideResult) {
  const requested = viewportOverrideResult?.requested ?? {};
  return {
    width: positiveFiniteNumber(requested.width),
    height: positiveFiniteNumber(requested.height),
    dpr: positiveFiniteNumber(requested.dpr) ?? 1,
  };
}

function pageViewportDimensions(page) {
  const viewport = page?.viewport ?? {};
  const visualViewport = viewport.visual_viewport ?? {};
  return {
    width: positiveFiniteNumber(viewport.inner_width)
      ?? positiveFiniteNumber(visualViewport.width),
    height: positiveFiniteNumber(viewport.inner_height)
      ?? positiveFiniteNumber(visualViewport.height),
    dpr: positiveFiniteNumber(viewport.device_pixel_ratio) ?? 1,
  };
}

function verifyViewportOverridePage({
  page,
  viewportOverrideResult,
}) {
  const requested = requestedViewportDimensions(viewportOverrideResult);
  const actual = pageViewportDimensions(page);
  const width = axisCheck({
    actual: actual.width,
    expected: requested.width,
    tolerance: CSS_VIEWPORT_TOLERANCE_PX,
  });
  const height = axisCheck({
    actual: actual.height,
    expected: requested.height,
    tolerance: CSS_VIEWPORT_TOLERANCE_PX,
  });
  return {
    ok: width.ok && height.ok,
    scope: "page_viewport",
    width,
    height,
    requested,
    actual,
  };
}

function expectedViewportArtifactDimensions({
  page,
  viewportOverrideResult,
}) {
  const requested = requestedViewportDimensions(viewportOverrideResult);
  const actual = pageViewportDimensions(page);
  const cssWidth = actual.width ?? requested.width;
  const cssHeight = actual.height ?? requested.height;
  const dpr = actual.dpr ?? requested.dpr;
  if (cssWidth === null || cssHeight === null || dpr === null) {
    return null;
  }
  return {
    width: Math.round(cssWidth * dpr),
    height: Math.round(cssHeight * dpr),
    css_width: cssWidth,
    css_height: cssHeight,
    dpr,
  };
}

function verifyViewportOverrideArtifact({
  artifact,
  page,
  target,
  viewportOverrideResult,
}) {
  if (!viewportOverrideResult || target !== "viewport") {
    return {
      ok: true,
      skipped: true,
      reason: viewportOverrideResult ? "non_viewport_target" : "no_viewport_override",
    };
  }
  const expected = expectedViewportArtifactDimensions({ page, viewportOverrideResult });
  if (!expected) {
    return {
      ok: false,
      skipped: false,
      reason: "missing_expected_dimensions",
      expected: null,
      actual: {
        width: positiveFiniteNumber(artifact?.width) ?? artifact?.width ?? null,
        height: positiveFiniteNumber(artifact?.height) ?? artifact?.height ?? null,
      },
    };
  }
  const width = axisCheck({
    actual: artifact?.width,
    expected: expected.width,
    tolerance: PNG_DIMENSION_TOLERANCE_PX,
  });
  const height = axisCheck({
    actual: artifact?.height,
    expected: expected.height,
    tolerance: PNG_DIMENSION_TOLERANCE_PX,
  });
  return {
    ok: width.ok && height.ok,
    skipped: false,
    scope: "viewport_png_dimensions",
    width,
    height,
    expected,
    actual: {
      width: positiveFiniteNumber(artifact?.width) ?? artifact?.width ?? null,
      height: positiveFiniteNumber(artifact?.height) ?? artifact?.height ?? null,
    },
  };
}

function buildViewportOverrideVerification({
  artifact,
  page,
  target,
  viewportOverrideResult,
}) {
  if (!viewportOverrideResult) {
    return undefined;
  }
  const pageVerification = verifyViewportOverridePage({
    page,
    viewportOverrideResult,
  });
  const artifactVerification = verifyViewportOverrideArtifact({
    artifact,
    page,
    target,
    viewportOverrideResult,
  });
  return {
    ok: pageVerification.ok && artifactVerification.ok,
    page: pageVerification,
    artifact: artifactVerification,
  };
}

function assertViewportOverridePageVerification(verification) {
  if (!verification || verification.ok) {
    return;
  }
  const error = new Error("viewport override page metrics do not match requested viewport");
  error.errorCode = "SCREENSHOT_VIEWPORT_OVERRIDE_MISMATCH";
  error.retryable = true;
  error.details = {
    verification,
  };
  throw error;
}

function assertViewportOverrideArtifactVerification(verification, artifact) {
  const artifactVerification = verification?.artifact;
  if (!artifactVerification || artifactVerification.ok) {
    return;
  }
  const error = new Error("viewport screenshot artifact dimensions do not match viewport override");
  error.errorCode = "SCREENSHOT_ARTIFACT_DIMENSION_MISMATCH";
  error.retryable = true;
  error.details = {
    verification,
    artifact,
  };
  throw error;
}

export {
  CSS_VIEWPORT_TOLERANCE_PX,
  PNG_DIMENSION_TOLERANCE_PX,
  assertViewportOverrideArtifactVerification,
  assertViewportOverridePageVerification,
  buildViewportOverrideVerification,
  expectedViewportArtifactDimensions,
  verifyViewportOverrideArtifact,
  verifyViewportOverridePage,
};
