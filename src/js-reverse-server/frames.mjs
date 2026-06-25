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
        const row = {
          frame_id: "frame:" + framePath.join("/"),
          frame_path: framePath.join("/"),
          depth,
          index,
          tag: node.tagName,
          src: node.src || "",
          url,
          title,
          name: node.getAttribute("name") || "",
          sandbox: node.getAttribute("sandbox") || "",
          accessible,
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
      title: document.title,
      frames: walk(window),
      note: "Cross-origin frames are listed by element metadata only; inner DOM requires a CDP/frame-aware path."
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
