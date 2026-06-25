import { normalizeTimeoutMs } from "../../common.mjs";
import { handleBrowserExecuteJs } from "./execute-js.mjs";

function normalizeWaitTimeout(raw) {
  return Math.max(100, Math.min(120_000, normalizeTimeoutMs(raw)));
}

function waitCode(args = {}) {
  const input = {
    type: String(args.type ?? "selector"),
    selector: String(args.selector ?? ""),
    text: String(args.text ?? ""),
    predicate: String(args.predicate ?? args.code ?? ""),
    visible: args.visible !== false,
    stable_ms: Math.max(50, Math.min(30_000, Number(args.stable_ms ?? 750))),
    interval_ms: Math.max(25, Math.min(5_000, Number(args.interval_ms ?? 100))),
    timeout_ms: normalizeWaitTimeout(args.timeout_ms),
  };
  return `
return await (async (input) => {
  const started = Date.now();
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const deadline = started + input.timeout_ms;
  const isVisible = (node) => {
    if (!node) return false;
    const style = getComputedStyle(node);
    const rect = node.getBoundingClientRect();
    return style.visibility !== "hidden"
      && style.display !== "none"
      && Number(rect.width) > 0
      && Number(rect.height) > 0;
  };
  const pass = async () => {
    if (input.type === "selector") {
      const node = document.querySelector(input.selector);
      return {
        ok: Boolean(node) && (input.visible ? isVisible(node) : true),
        detail: node ? {
          tag: node.tagName,
          id: node.id || "",
          className: String(node.className || "").slice(0, 160),
          text: String(node.innerText || node.textContent || "").replace(/\\s+/g, " ").trim().slice(0, 240)
        } : null
      };
    }
    if (input.type === "text") {
      const bodyText = String(document.body?.innerText || document.documentElement?.innerText || "");
      return { ok: input.text.length > 0 && bodyText.includes(input.text), detail: { text: input.text } };
    }
    if (input.type === "function") {
      const fn = Function("return (" + input.predicate + ")")();
      const value = await fn();
      return { ok: Boolean(value), detail: { value } };
    }
    if (input.type === "dom_stable") {
      let lastChange = Date.now();
      const observer = new MutationObserver(() => { lastChange = Date.now(); });
      observer.observe(document.documentElement, { childList: true, subtree: true, attributes: true, characterData: true });
      try {
        while (Date.now() < deadline) {
          if (Date.now() - lastChange >= input.stable_ms) {
            return { ok: true, detail: { stable_ms: input.stable_ms } };
          }
          await sleep(input.interval_ms);
        }
        return { ok: false, detail: { stable_ms: input.stable_ms, last_change_age_ms: Date.now() - lastChange } };
      } finally {
        observer.disconnect();
      }
    }
    if (input.type === "network_idle") {
      let lastCount = performance.getEntriesByType("resource").length;
      let stableSince = Date.now();
      while (Date.now() < deadline) {
        await sleep(input.interval_ms);
        const count = performance.getEntriesByType("resource").length;
        if (count !== lastCount) {
          lastCount = count;
          stableSince = Date.now();
        }
        if (Date.now() - stableSince >= input.stable_ms) {
          return { ok: true, detail: { resource_count: count, stable_ms: input.stable_ms } };
        }
      }
      return { ok: false, detail: { resource_count: lastCount, stable_ms: input.stable_ms } };
    }
    return { ok: false, detail: { error: "unsupported wait type: " + input.type } };
  };
  let last = null;
  while (Date.now() < deadline) {
    try {
      last = await pass();
    } catch (error) {
      last = { ok: false, detail: { error: String(error?.message || error) } };
    }
    if (last?.ok) {
      return { status: "passed", elapsed_ms: Date.now() - started, type: input.type, detail: last.detail };
    }
    await sleep(input.interval_ms);
  }
  return { status: "timeout", elapsed_ms: Date.now() - started, type: input.type, detail: last?.detail || null };
})(${JSON.stringify(input)});
`;
}

async function handleBrowserWait(args = {}) {
  const type = String(args.type ?? "selector");
  if (type === "selector" && !String(args.selector ?? "").trim()) {
    return {
      status: "invalid_argument",
      ok: false,
      wait_type: type,
      error: "browser_wait selector wait requires selector",
    };
  }
  if (type === "text" && !String(args.text ?? "").trim()) {
    return {
      status: "invalid_argument",
      ok: false,
      wait_type: type,
      error: "browser_wait text wait requires text",
    };
  }
  if (type === "function" && !String(args.predicate ?? args.code ?? "").trim()) {
    return {
      status: "invalid_argument",
      ok: false,
      wait_type: type,
      error: "browser_wait function wait requires predicate or code",
    };
  }
  const timeoutMs = normalizeWaitTimeout(args.timeout_ms);
  const executed = await handleBrowserExecuteJs({
    ...args,
    code: waitCode({ ...args, timeout_ms: timeoutMs }),
    timeout_ms: timeoutMs,
    no_monitor: true,
  });
  const waitResult = executed.js_return && typeof executed.js_return === "object"
    ? executed.js_return
    : null;
  if (executed.status !== "success") {
    return {
      status: "failed",
      ok: false,
      wait_type: String(args.type ?? "selector"),
      execute: executed,
    };
  }
  return {
    status: waitResult?.status ?? "failed",
    ok: waitResult?.status === "passed",
    wait_type: waitResult?.type ?? String(args.type ?? "selector"),
    elapsed_ms: waitResult?.elapsed_ms,
    detail: waitResult?.detail,
    transport: executed.transport,
    transport_attempts: executed.transport_attempts,
    tab_id: executed.tab_id,
    session_id: executed.session_id,
  };
}

export {
  handleBrowserWait,
};
