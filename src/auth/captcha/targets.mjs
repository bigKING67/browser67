function buildCaptchaAssistInspectorJs(manualChallengeDetectorJs) {
  return `
    ${manualChallengeDetectorJs}
    const challenge = detectManualChallenge();
    const safeQueryAll = (root, selector) => {
      try {
        return Array.from(root.querySelectorAll(selector));
      } catch {
        return [];
      }
    };
    const describeRect = (el, offset = { left: 0, top: 0 }) => {
      const rect = el.getBoundingClientRect();
      if (!rect || rect.width <= 0 || rect.height <= 0) {
        return null;
      }
      const left = rect.left + (offset.left || 0);
      const top = rect.top + (offset.top || 0);
      const right = rect.right + (offset.left || 0);
      const bottom = rect.bottom + (offset.top || 0);
      return {
        x: left,
        y: top,
        left,
        top,
        right,
        bottom,
        width: rect.width,
        height: rect.height,
        center_client: {
          x: left + rect.width / 2,
          y: top + rect.height / 2
        }
      };
    };
    const describeSliderTrack = (el, handleRect, context = {}) => {
      if (!el || !handleRect) {
        return null;
      }
      const possibleTracks = [];
      let ancestor = el.parentElement;
      for (let depth = 1; ancestor && depth <= 4; depth += 1) {
        possibleTracks.push({ el: ancestor, depth, relation: "ancestor" });
        ancestor = ancestor.parentElement;
      }
      const parent = el.parentElement;
      if (parent) {
        for (const sibling of Array.from(parent.children || [])) {
          if (sibling !== el) {
            possibleTracks.push({ el: sibling, depth: 1, relation: "sibling" });
          }
        }
      }
      let best = null;
      for (const item of possibleTracks) {
        const trackRect = describeRect(item.el, context.offset);
        if (!trackRect || trackRect.width < handleRect.width * 1.8) {
          continue;
        }
        const overlap = Math.max(0, Math.min(trackRect.bottom, handleRect.bottom) - Math.max(trackRect.top, handleRect.top));
        if (overlap < Math.min(trackRect.height, handleRect.height) * 0.45) {
          continue;
        }
        if (trackRect.height > Math.max(160, handleRect.height * 4)) {
          continue;
        }
        const marker = [
          item.el.id || "",
          String(item.el.className || ""),
          String(item.el.getAttribute("role") || "")
        ].join(" ");
        const markerMatched = /track|rail|bar|body|wrapper|container|slide|slider|captcha/i.test(marker);
        if (!markerMatched) {
          continue;
        }
        const markerScore = 6;
        const widthScore = Math.min(8, trackRect.width / Math.max(1, handleRect.width));
        const heightScore = Math.max(0, 3 - Math.abs(trackRect.height - handleRect.height) / Math.max(1, handleRect.height));
        const relationScore = item.relation === "ancestor" ? Math.max(0, 3 - item.depth * 0.5) : 0;
        const score = markerScore + widthScore + heightScore + relationScore;
        if (!best || score > best.score || (score === best.score && trackRect.width > best.rect.width)) {
          best = {
            rect: trackRect,
            score,
            source: item.relation,
            source_id: item.el.id || undefined,
            source_class_name: String(item.el.className || "").slice(0, 160) || undefined
          };
        }
      }
      return best ? {
        ...best.rect,
        source: best.source,
        source_id: best.source_id,
        source_class_name: best.source_class_name
      } : null;
    };
    const seen = new Set();
    const candidates = [];
    const candidateByElement = new Map();
    const pushCandidate = (el, selector_hint, role, confidence, indicator, context = {}) => {
      if (!el || el.nodeType !== 1) {
        return;
      }
      if (seen.has(el)) {
        const existing = candidateByElement.get(el);
        if (existing && context.force_update === true) {
          existing.frame_access = context.frame_access || existing.frame_access;
          existing.degraded_mode = context.degraded_mode === true || existing.degraded_mode === true;
          existing.manual_handoff_recommended = context.manual_handoff_recommended === true || existing.manual_handoff_recommended === true;
          existing.inaccessible_frame_reason = context.inaccessible_frame_reason || existing.inaccessible_frame_reason;
          existing.iframe_origin = context.iframe_origin || existing.iframe_origin;
          existing.indicator = context.indicator_override || existing.indicator;
          existing.confidence = context.confidence_override || existing.confidence;
        }
        return;
      }
      const rect = describeRect(el, context.offset);
      if (!rect) {
        return;
      }
      seen.add(el);
      const tag = String(el.tagName || "").toLowerCase();
      const text = String(el.textContent || "").replace(/\\s+/g, " ").trim().slice(0, 80);
      const attrs = [
        el.id || "",
        String(el.className || ""),
        String(el.getAttribute("data-captcha") || ""),
        String(el.getAttribute("data-sitekey") || ""),
        String(el.getAttribute("aria-label") || ""),
        String(el.getAttribute("role") || "")
      ].join(" ");
      const marker_priority = el.hasAttribute("data-captcha")
        ? 0
        : (/captcha/i.test(attrs) ? 1 : (/handle|button/i.test(attrs) ? 2 : (/status|message|error|label/i.test(attrs) ? 8 : 4)));
      const candidate = {
        role,
        selector_hint,
        indicator,
        confidence,
        marker_priority,
        tag,
        id: el.id || undefined,
        class_name: String(el.className || "").slice(0, 160) || undefined,
        sitekey_present: Boolean(el.getAttribute("data-sitekey")),
        iframe_src: tag === "iframe" ? String(el.getAttribute("src") || "").slice(0, 220) || undefined : undefined,
        text_hint: text || undefined,
        rect,
        track_rect: role === "slider" ? describeSliderTrack(el, rect, context) || undefined : undefined,
        center_client: rect.center_client,
        frame_path: context.frame_path || "top",
        same_origin_frame_depth: context.depth || 0,
        frame_access: context.frame_access,
        degraded_mode: context.degraded_mode === true || undefined,
        manual_handoff_recommended: context.manual_handoff_recommended === true || undefined,
        inaccessible_frame_reason: context.inaccessible_frame_reason,
        iframe_origin: context.iframe_origin,
        coordinate_system: "viewport_css_pixels"
      };
      candidates.push(candidate);
      candidateByElement.set(el, candidate);
    };
    const describeIframeOrigin = (iframe) => {
      const src = String(iframe.getAttribute("src") || "").trim();
      if (!src) {
        return undefined;
      }
      try {
        return new URL(src, location.href).origin;
      } catch {
        return undefined;
      }
    };
    const captchaLikeIframe = (iframe) => {
      const marker = [
        iframe.id || "",
        String(iframe.className || ""),
        String(iframe.getAttribute("name") || ""),
        String(iframe.getAttribute("title") || ""),
        String(iframe.getAttribute("src") || ""),
        String(iframe.getAttribute("data-captcha") || ""),
        String(iframe.getAttribute("data-sitekey") || ""),
        String(iframe.getAttribute("aria-label") || "")
      ].join(" ");
      return /captcha|hcaptcha|recaptcha|turnstile|challenge|verify|human|slider|slide/i.test(marker);
    };
    const selectorGroups = [
      {
        selector: '.h-captcha, [data-hcaptcha-widget-id], iframe[src*="hcaptcha" i]',
        role: "checkbox",
        confidence: "high",
        indicator: "hcaptcha_widget"
      },
      {
        selector: '.g-recaptcha, [data-recaptcha-widget-id], iframe[src*="recaptcha" i]',
        role: "checkbox",
        confidence: "medium",
        indicator: "recaptcha_widget"
      },
      {
        selector: '.cf-turnstile, [data-cf-turnstile], iframe[src*="turnstile" i], iframe[src*="challenges.cloudflare.com" i]',
        role: "checkbox",
        confidence: "high",
        indicator: "turnstile_widget"
      },
      {
        selector: '[class*="slider" i]:not([id*="status" i]):not([class*="status" i]):not([id*="message" i]):not([class*="message" i]), [id*="slider" i]:not([id*="status" i]):not([class*="status" i]):not([id*="message" i]):not([class*="message" i]), [class*="slide" i][class*="captcha" i], [id*="slide" i][id*="captcha" i], canvas[class*="captcha" i], canvas[id*="captcha" i]',
        role: "slider",
        confidence: "medium",
        indicator: "slider_marker"
      },
      {
        selector: '[class*="captcha" i], [id*="captcha" i]:not(input):not(label):not(form):not(p), iframe[src*="captcha" i], [data-sitekey], [data-captcha]',
        role: "unknown",
        confidence: "low",
        indicator: "captcha_marker"
      }
    ];
    const inspectDocument = (rootDocument, context = {}) => {
      for (const group of selectorGroups) {
        for (const el of safeQueryAll(rootDocument, group.selector)) {
          pushCandidate(el, group.selector, group.role, group.confidence, group.indicator, context);
        }
      }
      const textCandidates = safeQueryAll(rootDocument, 'button, a, div, span, canvas, [role="button"]')
        .filter((el) => /请按住|拖动|滑块|verify|human|captcha|slide/i.test(String(el.textContent || "") + " " + String(el.getAttribute("aria-label") || "")))
        .slice(0, 40);
      for (const el of textCandidates) {
        const text = String(el.textContent || "") + " " + String(el.getAttribute("aria-label") || "");
        const role = /请按住|拖动|滑块|slide|slider/i.test(text) ? "slider" : "unknown";
        pushCandidate(el, "text:captcha_or_slider", role, "low", "challenge_text", context);
      }
      if ((context.depth || 0) >= 2) {
        return;
      }
      for (const iframe of safeQueryAll(rootDocument, "iframe")) {
        const iframeRect = describeRect(iframe, context.offset);
        if (!iframeRect) {
          continue;
        }
        try {
          const childDocument = iframe.contentDocument;
          if (!childDocument) {
            if (captchaLikeIframe(iframe)) {
              pushCandidate(iframe, "iframe:cross_origin_captcha_marker", "unknown", "medium", "cross_origin_iframe_captcha_marker", {
                ...context,
                force_update: true,
                frame_access: "cross_origin_uninspectable",
                degraded_mode: true,
                manual_handoff_recommended: true,
                inaccessible_frame_reason: "cross_origin_frame_uninspectable",
                iframe_origin: describeIframeOrigin(iframe),
                indicator_override: "cross_origin_iframe_captcha_marker",
                confidence_override: "medium"
              });
            }
            continue;
          }
          inspectDocument(childDocument, {
            depth: (context.depth || 0) + 1,
            frame_path: String(context.frame_path || "top") + " > iframe" + (iframe.id ? "#" + iframe.id : ""),
            offset: {
              left: iframeRect.left,
              top: iframeRect.top
            }
          });
        } catch {
          if (captchaLikeIframe(iframe)) {
            pushCandidate(iframe, "iframe:cross_origin_captcha_marker", "unknown", "medium", "cross_origin_iframe_captcha_marker", {
              ...context,
              force_update: true,
              frame_access: "cross_origin_uninspectable",
              degraded_mode: true,
              manual_handoff_recommended: true,
              inaccessible_frame_reason: "cross_origin_frame_uninspectable",
              iframe_origin: describeIframeOrigin(iframe),
              indicator_override: "cross_origin_iframe_captcha_marker",
              confidence_override: "medium"
            });
          }
        }
      }
    };
    inspectDocument(document, { depth: 0, frame_path: "top", offset: { left: 0, top: 0 } });
    const sitekeys = Array.from(new Set(safeQueryAll(document, "[data-sitekey]")
      .map((el) => String(el.getAttribute("data-sitekey") || "").trim())
      .filter(Boolean)))
      .slice(0, 8);
    const roleRank = { checkbox: 0, slider: 1, unknown: 2 };
    const confidenceRank = { high: 0, medium: 1, low: 2 };
    candidates.sort((left, right) => {
      const roleDiff = (roleRank[left.role] ?? 9) - (roleRank[right.role] ?? 9);
      if (roleDiff !== 0) return roleDiff;
      const confidenceDiff = (confidenceRank[left.confidence] ?? 9) - (confidenceRank[right.confidence] ?? 9);
      if (confidenceDiff !== 0) return confidenceDiff;
      const priorityDiff = (left.marker_priority ?? 9) - (right.marker_priority ?? 9);
      if (priorityDiff !== 0) return priorityDiff;
      const leftArea = left.rect.width * left.rect.height;
      const rightArea = right.rect.width * right.rect.height;
      return rightArea - leftArea;
    });
    const viewport = {
      inner_width: window.innerWidth,
      inner_height: window.innerHeight,
      outer_width: window.outerWidth,
      outer_height: window.outerHeight,
      device_pixel_ratio: window.devicePixelRatio,
      scroll_x: window.scrollX,
      scroll_y: window.scrollY,
      screen_x: window.screenX,
      screen_y: window.screenY,
      visual_viewport: window.visualViewport ? {
        offset_left: window.visualViewport.offsetLeft,
        offset_top: window.visualViewport.offsetTop,
        width: window.visualViewport.width,
        height: window.visualViewport.height,
        scale: window.visualViewport.scale
      } : undefined
    };
    return {
      url: location.href,
      origin: location.origin,
      pathname: location.pathname,
      title: document.title,
      ready_state: document.readyState,
      ...challenge,
      viewport,
      protocol_hints: {
        page_url: location.href,
        sitekey_count: sitekeys.length,
        sitekey_present: sitekeys.length > 0
      },
      candidate_targets: candidates.slice(0, 12),
      target: candidates[0] || null
    };
  `;
}

export { buildCaptchaAssistInspectorJs };
