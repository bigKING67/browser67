import {
  applyMainOnlyGuardrail,
  clipContent,
  normalizeMaxChars,
} from "../../common.mjs";
import {
  buildScanContentExpression,
  cdpReadPageContent,
} from "../../cdp-runtime.mjs";
import {
  asShortTabs,
  markSessionSelected,
  sessionPointers,
} from "../../session-registry.mjs";
import {
  executeTmwdJs,
  resolvePreferredBrowserContext,
} from "../../tmwd-runtime.mjs";

async function handleBrowserScan(args) {
  const preferred = await resolvePreferredBrowserContext(args ?? {});
  const resolved = preferred.context;
  const targets = resolved.targets;
  const selected = resolved.target;
  markSessionSelected(selected.id, { make_default: false });
  const metadata = {
    transport: preferred.transport,
    transport_attempts: Array.isArray(preferred.transport_attempts) ? preferred.transport_attempts : [],
    tabs_count: targets.length,
    tabs: asShortTabs(targets),
    active_tab: selected.id,
    cdp_endpoint: preferred.transport === "cdp" ? resolved.endpoint : undefined,
    tmwd_link_endpoint: preferred.transport === "tmwd_link" ? resolved.endpoint : undefined,
    tmwd_ws_endpoint: preferred.transport === "tmwd_ws" ? resolved.endpoint : undefined,
    selection: resolved.selection,
    selection_source: resolved.selection?.selected_by ?? null,
    selection_warning: resolved.selection?.warning ?? undefined,
    sessions: resolved.sessions,
    ...sessionPointers(),
  };
  if (args?.tabs_only === true) {
    return {
      status: "success",
      metadata,
    };
  }
  const textOnly = args?.text_only === true;
  const mainOnly = args?.main_only === true;
  const maxChars = normalizeMaxChars(args?.max_chars);
  let mainOnlyGuardrail;
  let content = "";
  if (preferred.transport === "tmwd_ws" || preferred.transport === "tmwd_link") {
    const readTmwdContent = async (readTextOnly, readMainOnly) => {
      const tmwdScript = `return ${buildScanContentExpression(readTextOnly, readMainOnly)};`;
      const tmwdExec = await executeTmwdJs(
        {
          ...args,
          session_id: selected.id,
        },
        resolved,
        tmwdScript,
      );
      return String(tmwdExec.value ?? "");
    };
    if (textOnly && mainOnly) {
      const mainContent = await readTmwdContent(true, true);
      const fullContent = await readTmwdContent(true, false);
      const guarded = applyMainOnlyGuardrail(mainContent, fullContent, args);
      content = guarded.content;
      mainOnlyGuardrail = guarded.metadata;
    } else {
      content = await readTmwdContent(textOnly, mainOnly);
    }
  } else {
    const readCdpContent = async (readTextOnly, readMainOnly) => {
      const contentResult = await cdpReadPageContent({
        ...args,
        switch_tab_id: selected.id,
      }, readTextOnly, readMainOnly);
      return String(contentResult.result.content ?? "");
    };
    if (textOnly && mainOnly) {
      const mainContent = await readCdpContent(true, true);
      const fullContent = await readCdpContent(true, false);
      const guarded = applyMainOnlyGuardrail(mainContent, fullContent, args);
      content = guarded.content;
      mainOnlyGuardrail = guarded.metadata;
    } else {
      content = await readCdpContent(textOnly, mainOnly);
    }
  }
  const clipped = clipContent(content, maxChars);
  return {
    status: "success",
    metadata: {
      ...metadata,
      text_only: textOnly,
      main_only: mainOnly,
      main_only_guardrail: textOnly && mainOnly ? mainOnlyGuardrail : undefined,
      truncated: clipped.truncated,
      original_length: clipped.original_length,
      max_chars: maxChars,
    },
    content: clipped.value,
  };
}

export {
  handleBrowserScan,
};
