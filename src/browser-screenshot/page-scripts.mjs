const PAGE_METADATA_SCRIPT = `return (() => {
  const doc = document.documentElement || {};
  const body = document.body || {};
  const visualViewport = window.visualViewport ? {
    width: window.visualViewport.width,
    height: window.visualViewport.height,
    offset_left: window.visualViewport.offsetLeft,
    offset_top: window.visualViewport.offsetTop,
    page_left: window.visualViewport.pageLeft,
    page_top: window.visualViewport.pageTop,
    scale: window.visualViewport.scale
  } : null;
  const scrollWidth = Math.max(
    Number(doc.scrollWidth || 0),
    Number(body.scrollWidth || 0),
    Number(doc.clientWidth || 0),
    Number(window.innerWidth || 0)
  );
  const scrollHeight = Math.max(
    Number(doc.scrollHeight || 0),
    Number(body.scrollHeight || 0),
    Number(doc.clientHeight || 0),
    Number(window.innerHeight || 0)
  );
  return {
    url: String(location.href || ""),
    title: String(document.title || ""),
    visibility_state: String(document.visibilityState || "unknown"),
    viewport: {
      inner_width: Number(window.innerWidth || 0),
      inner_height: Number(window.innerHeight || 0),
      outer_width: Number(window.outerWidth || 0),
      outer_height: Number(window.outerHeight || 0),
      scroll_x: Number(window.scrollX || 0),
      scroll_y: Number(window.scrollY || 0),
      screen_x: Number(window.screenX || 0),
      screen_y: Number(window.screenY || 0),
      device_pixel_ratio: Number(window.devicePixelRatio || 1),
      visual_viewport: visualViewport
    },
    document: {
      scroll_width: scrollWidth,
      scroll_height: scrollHeight,
      client_width: Number(doc.clientWidth || 0),
      client_height: Number(doc.clientHeight || 0),
      body_scroll_width: Number(body.scrollWidth || 0),
      body_scroll_height: Number(body.scrollHeight || 0)
    }
  };
})();`;

function viewportOverrideSettleScript(requested) {
  return `return (() => {
  const expected = ${JSON.stringify({
    width: Number(requested?.width ?? 0),
    height: Number(requested?.height ?? 0),
    dpr: Number(requested?.dpr ?? 1),
  })};
  const sample = () => ({
    inner_width: Number(window.innerWidth || 0),
    inner_height: Number(window.innerHeight || 0),
    device_pixel_ratio: Number(window.devicePixelRatio || 1)
  });
  const matches = (value) => (
    Math.abs(value.inner_width - expected.width) <= 1
    && Math.abs(value.inner_height - expected.height) <= 1
    && Math.abs(value.device_pixel_ratio - expected.dpr) <= 0.01
  );
  const actual = sample();
  return {
    ok: matches(actual),
    attempts: 1,
    settle_basis: "cdp_ack_plus_synchronous_layout_read",
    visibility_state: String(document.visibilityState || "unknown"),
    expected,
    actual
  };
})();`;
}

function selectorClipScript(selector) {
  return `return (() => {
  const selector = ${JSON.stringify(selector)};
  const rectSnapshot = (rect) => ({
    x: rect.x,
    y: rect.y,
    left: rect.left,
    top: rect.top,
    right: rect.right,
    bottom: rect.bottom,
    width: rect.width,
    height: rect.height
  });
  const rectDelta = (first, second) => Math.max(
    Math.abs(Number(first.left || 0) - Number(second.left || 0)),
    Math.abs(Number(first.top || 0) - Number(second.top || 0)),
    Math.abs(Number(first.width || 0) - Number(second.width || 0)),
    Math.abs(Number(first.height || 0) - Number(second.height || 0))
  );
  const node = document.querySelector(selector);
  if (!node) {
    return { ok: false, reason: "selector_not_found", selector, attempts: 1 };
  }
  try {
    node.scrollIntoView({ block: "center", inline: "center" });
  } catch {
    // Some nodes cannot scroll; keep going and report the measured box.
  }
  if (!node.isConnected) {
    return { ok: false, reason: "selector_detached_after_scroll", selector, attempts: 1 };
  }
  const firstRect = rectSnapshot(node.getBoundingClientRect());
  if (!node.isConnected) {
    return { ok: false, reason: "selector_detached_after_measure", selector, attempts: 1 };
  }
  const rect = rectSnapshot(node.getBoundingClientRect());
  const stable = rectDelta(firstRect, rect) <= 0.5;
  const computed = window.getComputedStyle(node);
  const page = (() => {
    const doc = document.documentElement || {};
    const body = document.body || {};
    const visualViewport = window.visualViewport ? {
      width: window.visualViewport.width,
      height: window.visualViewport.height,
      offset_left: window.visualViewport.offsetLeft,
      offset_top: window.visualViewport.offsetTop,
      page_left: window.visualViewport.pageLeft,
      page_top: window.visualViewport.pageTop,
      scale: window.visualViewport.scale
    } : null;
    return {
      url: String(location.href || ""),
      title: String(document.title || ""),
      visibility_state: String(document.visibilityState || "unknown"),
      viewport: {
        inner_width: Number(window.innerWidth || 0),
        inner_height: Number(window.innerHeight || 0),
        outer_width: Number(window.outerWidth || 0),
        outer_height: Number(window.outerHeight || 0),
        scroll_x: Number(window.scrollX || 0),
        scroll_y: Number(window.scrollY || 0),
        screen_x: Number(window.screenX || 0),
        screen_y: Number(window.screenY || 0),
        device_pixel_ratio: Number(window.devicePixelRatio || 1),
        visual_viewport: visualViewport
      },
      document: {
        scroll_width: Math.max(Number(doc.scrollWidth || 0), Number(body.scrollWidth || 0), Number(doc.clientWidth || 0), Number(window.innerWidth || 0)),
        scroll_height: Math.max(Number(doc.scrollHeight || 0), Number(body.scrollHeight || 0), Number(doc.clientHeight || 0), Number(window.innerHeight || 0)),
        client_width: Number(doc.clientWidth || 0),
        client_height: Number(doc.clientHeight || 0)
      }
    };
  })();
  return {
    ok: true,
    selector,
    attempts: 1,
    stable,
    stability_basis: "synchronous_layout_flush",
    rect,
    computed: computed ? {
      display: computed.display,
      visibility: computed.visibility,
      opacity: computed.opacity,
      position: computed.position,
      overflow_x: computed.overflowX,
      overflow_y: computed.overflowY
    } : null,
    page
  };
})();`;
}

function layoutMetricsScript(selectors) {
  return `return (() => {
  const selectors = ${JSON.stringify(selectors)};
  const doc = document.documentElement || {};
  const body = document.body || {};
  const viewport = {
    inner_width: Number(window.innerWidth || 0),
    inner_height: Number(window.innerHeight || 0),
    device_pixel_ratio: Number(window.devicePixelRatio || 1),
    scroll_x: Number(window.scrollX || 0),
    scroll_y: Number(window.scrollY || 0),
    visual_viewport: window.visualViewport ? {
      width: window.visualViewport.width,
      height: window.visualViewport.height,
      offset_left: window.visualViewport.offsetLeft,
      offset_top: window.visualViewport.offsetTop,
      page_left: window.visualViewport.pageLeft,
      page_top: window.visualViewport.pageTop,
      scale: window.visualViewport.scale
    } : null
  };
  const documentMetrics = {
    scroll_width: Math.max(Number(doc.scrollWidth || 0), Number(body.scrollWidth || 0), Number(doc.clientWidth || 0), Number(window.innerWidth || 0)),
    scroll_height: Math.max(Number(doc.scrollHeight || 0), Number(body.scrollHeight || 0), Number(doc.clientHeight || 0), Number(window.innerHeight || 0)),
    client_width: Number(doc.clientWidth || 0),
    client_height: Number(doc.clientHeight || 0),
    body_scroll_width: Number(body.scrollWidth || 0),
    body_scroll_height: Number(body.scrollHeight || 0)
  };
  const selectorMetrics = {};
  for (const [name, selector] of Object.entries(selectors || {})) {
    const key = String(name || selector || "selector");
    const cssSelector = String(selector || "").trim();
    if (!cssSelector) {
      selectorMetrics[key] = { found: false, selector: cssSelector, reason: "empty_selector" };
      continue;
    }
    const node = document.querySelector(cssSelector);
    if (!node) {
      selectorMetrics[key] = { found: false, selector: cssSelector, reason: "selector_not_found" };
      continue;
    }
    const rect = node.getBoundingClientRect();
    const style = window.getComputedStyle(node);
    selectorMetrics[key] = {
      found: true,
      selector: cssSelector,
      rect: {
        x: rect.x,
        y: rect.y,
        top: rect.top,
        left: rect.left,
        right: rect.right,
        bottom: rect.bottom,
        width: rect.width,
        height: rect.height
      },
      computed: {
        display: style.display,
        visibility: style.visibility,
        position: style.position,
        overflow_x: style.overflowX,
        overflow_y: style.overflowY,
        outline_width: style.outlineWidth,
        outline_style: style.outlineStyle,
        outline_color: style.outlineColor
      }
    };
  }
  return {
    url: String(location.href || ""),
    title: String(document.title || ""),
    viewport,
    document: documentMetrics,
    horizontal_overflow: documentMetrics.scroll_width > viewport.inner_width + 1,
    selectors: selectorMetrics
  };
})();`;
}

export {
  PAGE_METADATA_SCRIPT,
  layoutMetricsScript,
  selectorClipScript,
  viewportOverrideSettleScript,
};
