import { pageEval } from "./tmwd-adapter.mjs";

function frameListingScript() {
  return `
    const rectPayload = (node) => {
      const rect = node.getBoundingClientRect();
      return {
        x: Math.round(rect.x),
        y: Math.round(rect.y),
        width: Math.round(rect.width),
        height: Math.round(rect.height)
      };
    };
    const originOf = (url) => {
      try { return new URL(url || location.href, location.href).origin; } catch (_) { return ''; }
    };
    const labelFor = (path) => path.length === 0 ? 'top' : 'top > ' + path.map((index) => 'frame[' + index + ']').join(' > ');
    const walk = (win, path = [], depth = 0) => {
      if (depth > 6) return [];
      const doc = win.document;
      const frames = Array.from(doc.querySelectorAll("iframe,frame"));
      const rows = [];
      frames.forEach((node, index) => {
        const framePath = [...path, index];
        let accessible = false;
        let url = node.src || "";
        let title = node.getAttribute("title") || "";
        let childCount = 0;
        let error = "";
        try {
          const childDoc = node.contentWindow?.document;
          accessible = Boolean(childDoc);
          if (accessible) {
            url = childDoc.location?.href || node.src || "";
            title = childDoc.title || title;
            childCount = childDoc.querySelectorAll("iframe,frame").length;
          }
        } catch (err) {
          error = String(err?.message || err);
        }
        const sameOrigin = accessible;
        const row = {
          frame_id: "frame:" + framePath.join("/"),
          frame_path: framePath.join("/"),
          frame_path_label: labelFor(framePath),
          parent_frame_path: path.length ? path.join("/") : "top",
          depth,
          index,
          tag: node.tagName,
          src: node.src || "",
          url,
          origin: originOf(url || node.src || ""),
          title,
          name: node.getAttribute("name") || "",
          sandbox: node.getAttribute("sandbox") || "",
          accessible,
          same_origin: sameOrigin,
          degraded_mode: !sameOrigin,
          access_level: sameOrigin ? "same_origin_dom" : "cross_origin_element_metadata",
          child_count: childCount,
          rect: rectPayload(node),
          error
        };
        rows.push(row);
        if (accessible) {
          try {
            rows.push(...walk(node.contentWindow, framePath, depth + 1));
          } catch {
            // Cross-origin descendants are represented by the parent inaccessible row.
          }
        }
      });
      return rows;
    };
    return {
      url: location.href,
      origin: location.origin,
      title: document.title,
      selected_frame: {
        frame_id: "top",
        frame_path: "top",
        frame_path_label: "top",
        url: location.href,
        origin: location.origin,
        same_origin: true,
        degraded_mode: false,
        access_level: "same_origin_dom"
      },
      frames: walk(window),
      note: "Cross-origin frames are listed by element metadata only; inner DOM requires a frame-capable CDP or extension path."
    };
  `;
}

async function handleListFrames(args) {
  const result = await pageEval(args, frameListingScript());
  return {
    ok: true,
    transport: result.transport,
    page: result.page,
    ...result.value,
  };
}

export {
  handleListFrames,
};
