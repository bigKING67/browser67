import { sessionPointers } from "../session-registry.mjs";
import { withTargetClient } from "./execution.mjs";

function buildScanContentExpression(textOnly, mainOnly) {
  if (textOnly && mainOnly) {
    return `(() => {
      const selectors = 'main, article, [role="main"], #main, .main-content, .content, .mdx-content, .markdown-body, .prose, [data-doc-main]';
      const direct = document.querySelector(selectors);
      if (direct) {
        const text = (direct.innerText || '').trim();
        if (text.length >= 200) {
          return text;
        }
      }
      const clone = document.body ? document.body.cloneNode(true) : null;
      if (!clone) {
        return document.documentElement ? (document.documentElement.innerText || '') : '';
      }
      clone.querySelectorAll('nav, header, footer, aside, script, style, noscript, form, [role="navigation"], [data-testid*="nav"], [class*="sidebar"], [class*="toc"], [class*="breadcrumb"]').forEach((node) => node.remove());
      const stripped = (clone.innerText || '').trim();
      if (stripped.length >= 200) {
        return stripped;
      }
      const root = document.body || document.documentElement;
      return root ? (root.innerText || '') : '';
    })()`;
  }
  if (textOnly) {
    return `(() => document.body ? document.body.innerText : document.documentElement.innerText)()`;
  }
  if (mainOnly) {
    return `(() => {
      const selectors = 'main, article, [role="main"], #main, .main-content, .content, .mdx-content, .markdown-body, .prose, [data-doc-main]';
      const direct = document.querySelector(selectors);
      if (direct) {
        return direct.outerHTML || '';
      }
      const clone = document.body ? document.body.cloneNode(true) : null;
      if (!clone) {
        return document.documentElement ? (document.documentElement.outerHTML || '') : '';
      }
      clone.querySelectorAll('nav, header, footer, aside, script, style, noscript, form, [role="navigation"], [data-testid*="nav"], [class*="sidebar"], [class*="toc"], [class*="breadcrumb"]').forEach((node) => node.remove());
      return clone.outerHTML || (document.documentElement ? (document.documentElement.outerHTML || '') : '');
    })()`;
  }
  return `(() => document.documentElement.outerHTML)()`;
}

function buildGuardedMainContentExpression(options = {}) {
  const config = JSON.stringify({
    fallback_to_full: options.fallback_to_full !== false,
    min_chars: Number(options.min_chars ?? 600),
    min_coverage: Number(options.min_coverage ?? 0.35),
  });
  return `(() => {
    const input = ${config};
    const root = document.body || document.documentElement;
    const full = root ? String(root.innerText || '') : '';
    const selectors = 'main, article, [role="main"], #main, .main-content, .content, .mdx-content, .markdown-body, .prose, [data-doc-main]';
    const direct = document.querySelector(selectors);
    let main = direct ? String(direct.innerText || '').trim() : '';
    if (!direct && document.body) {
      const clone = document.body.cloneNode(true);
      clone.querySelectorAll('nav, header, footer, aside, script, style, noscript, form, [role="navigation"], [data-testid*="nav"], [class*="sidebar"], [class*="toc"], [class*="breadcrumb"]').forEach((node) => node.remove());
      main = String(clone.innerText || '').trim();
    }
    const mainLength = main.length;
    const fullLength = full.length;
    const coverage = fullLength > 0 ? mainLength / fullLength : 1;
    const reasons = [];
    if (mainLength === 0) reasons.push('empty_main');
    if (mainLength > 0 && mainLength < input.min_chars) reasons.push('below_min_chars');
    if (fullLength > 0 && coverage < input.min_coverage) reasons.push('below_min_coverage');
    if (fullLength === 0 && reasons.length > 0) reasons.push('full_empty');
    const fallbackApplied = input.fallback_to_full && reasons.length > 0 && fullLength > 0;
    return {
      content: fallbackApplied ? full : main,
      metadata: {
        enabled: true,
        fallback_to_full: input.fallback_to_full,
        fallback_applied: fallbackApplied,
        fallback_reason: reasons.length > 0 ? reasons.join('+') : 'none',
        min_chars: input.min_chars,
        min_coverage: input.min_coverage,
        main_length: mainLength,
        full_length: fullLength,
        main_coverage: Number(coverage.toFixed(4)),
        main_only_effective: !fallbackApplied,
        capture_passes: 1
      }
    };
  })()`;
}

function evaluationError(evalResult, fallback) {
  if (!evalResult?.exceptionDetails) return null;
  return new Error(String(
    evalResult.exceptionDetails?.exception?.description
      || evalResult.exceptionDetails?.text
      || fallback,
  ));
}

function contentResult(target, endpoint, resolved, result) {
  return {
    target_id: target.id,
    target_url: target.url,
    endpoint,
    ...result,
    selection: resolved.selection,
    sessions: resolved.sessions,
    ...sessionPointers(),
  };
}

async function evaluateContent(args, expression, fallbackError, selectValue) {
  return withTargetClient(args, async (client, target, endpoint, timeoutMs, resolved) => {
    await client.send("Runtime.enable", {}, Math.min(timeoutMs, 10_000));
    const evalResult = await client.send("Runtime.evaluate", {
      expression,
      awaitPromise: true,
      returnByValue: true,
    }, timeoutMs);
    const error = evaluationError(evalResult, fallbackError);
    if (error) throw error;
    return contentResult(target, endpoint, resolved, selectValue(evalResult));
  });
}

async function cdpReadPageContent(args, textOnly, mainOnly = false) {
  const expression = buildScanContentExpression(textOnly, mainOnly);
  return evaluateContent(args, expression, "CDP page content evaluate failed", (evalResult) => ({
    content: String(evalResult?.result?.value ?? ""),
  }));
}

async function cdpReadGuardedMainContent(args, options = {}) {
  const expression = buildGuardedMainContentExpression(options);
  return evaluateContent(args, expression, "CDP guarded main content evaluate failed", (evalResult) => ({
    value: evalResult?.result?.value,
  }));
}

export {
  buildGuardedMainContentExpression,
  buildScanContentExpression,
  cdpReadGuardedMainContent,
  cdpReadPageContent,
};
