import { hashText } from "../../common.mjs";
import { cdpReadPageContent } from "../../cdp-runtime.mjs";
import { extractActionableNodes } from "../../content-extraction.mjs";
import { getActiveTargetId } from "../../session-registry.mjs";
import {
  executeTmwdJs,
  resolvePreferredBrowserContext,
} from "../../tmwd-runtime.mjs";

async function handleBrowserExtract(args) {
  let html = "";
  let transport = "cdp";
  let tmwdLinkEndpoint;
  let tmwdWsEndpoint;
  let selection;
  let transportAttempts = [];
  if (typeof args?.html === "string" && args.html.length > 0) {
    html = args.html;
  } else {
    const preferred = await resolvePreferredBrowserContext(args ?? {});
    transport = preferred.transport;
    transportAttempts = Array.isArray(preferred.transport_attempts) ? preferred.transport_attempts : [];
    tmwdLinkEndpoint = preferred.transport === "tmwd_link" ? preferred.context.endpoint : undefined;
    tmwdWsEndpoint = preferred.transport === "tmwd_ws" ? preferred.context.endpoint : undefined;
    selection = preferred.context.selection;
    if (preferred.transport === "tmwd_ws" || preferred.transport === "tmwd_link") {
      const executed = await executeTmwdJs(
        {
          ...args,
          session_id: preferred.context.target.id,
        },
        preferred.context,
        "return (() => document.documentElement.outerHTML)();",
      );
      html = String(executed.value ?? "");
    } else {
      const page = await cdpReadPageContent(args ?? {}, false);
      html = page.result.content;
    }
  }
  const limitRaw = Number(args?.selector_limit ?? 120);
  const limit = Number.isFinite(limitRaw)
    ? Math.max(1, Math.min(300, Math.floor(limitRaw)))
    : 120;
  const nodes = extractActionableNodes(html, limit);
  return {
    transport,
    transport_attempts: transportAttempts,
    tmwd_link_endpoint: tmwdLinkEndpoint,
    tmwd_ws_endpoint: tmwdWsEndpoint,
    selection,
    selection_source: selection?.selected_by ?? null,
    selection_warning: selection?.warning ?? undefined,
    page_fingerprint: hashText(html),
    actionable_nodes: nodes,
    state_transients: [],
    evidence_snapshot_ref: `snapshot_${hashText(html).slice(0, 12)}`,
    fallback_used: "none",
    active_tab: getActiveTargetId() || null,
  };
}

function handleBrowserDiff(args) {
  const toLines = (value) => String(value ?? "")
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  const beforeLines = new Set(toLines(args?.before ?? ""));
  const afterLines = new Set(toLines(args?.after ?? ""));
  const added = [];
  const removed = [];
  for (const line of afterLines) {
    if (!beforeLines.has(line)) {
      added.push(hashText(line).slice(0, 12));
    }
  }
  for (const line of beforeLines) {
    if (!afterLines.has(line)) {
      removed.push(hashText(line).slice(0, 12));
    }
  }
  return {
    added_signatures: added.slice(0, 200),
    removed_signatures: removed.slice(0, 200),
    before_fingerprint: hashText(String(args?.before ?? "")),
    after_fingerprint: hashText(String(args?.after ?? "")),
  };
}

export {
  handleBrowserDiff,
  handleBrowserExtract,
};
