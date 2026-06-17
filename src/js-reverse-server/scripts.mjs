import { pageEval } from "./tmwd-adapter.mjs";
import {
  COMMON_KEYWORDS,
  asArray,
  clip,
} from "./utils.mjs";

async function handleListScripts(args) {
  const result = await pageEval(args, `
    return Array.from(document.scripts).map((script, index) => ({
      id: script.src ? 'src:' + index : 'inline:' + index,
      index,
      src: script.src || '',
      inline: !script.src,
      length: (script.textContent || '').length,
      preview: (script.textContent || '').slice(0, 240)
    }));
  `);
  return { ok: true, transport: result.transport, page: result.page, scripts: result.value };
}

async function handleGetScriptSource(args) {
  const scriptId = String(args?.script_id ?? "").trim();
  const sourceUrl = String(args?.source_url ?? "").trim();
  const result = await pageEval(args, `
    const scriptId = input.scriptId;
    const sourceUrl = input.sourceUrl;
    const scripts = Array.from(document.scripts);
    let script = null;
    if (sourceUrl) script = scripts.find((item) => item.src === sourceUrl);
    if (!script && scriptId) {
      const index = Number(String(scriptId).split(':').pop());
      if (Number.isFinite(index)) script = scripts[index];
    }
    if (!script) return { ok: false, error: 'script not found' };
    if (!script.src) return { ok: true, id: scriptId, source_url: '', source: script.textContent || '', inline: true };
    try {
      const res = await fetch(script.src, { credentials: 'include', cache: 'force-cache' });
      const text = await res.text();
      return { ok: true, id: scriptId, source_url: script.src, source: text, inline: false, status: res.status };
    } catch (error) {
      return { ok: false, id: scriptId, source_url: script.src, inline: false, error: error.message || String(error) };
    }
  `, { scriptId, sourceUrl });
  return { ok: result.value?.ok !== false, transport: result.transport, page: result.page, ...result.value };
}

async function scriptSources(args, limit = 80) {
  const result = await pageEval(args, `
    const scripts = Array.from(document.scripts).slice(0, input.limit);
    return await Promise.all(scripts.map(async (script, index) => {
      if (!script.src) {
        return { id: 'inline:' + index, source_url: '', inline: true, source: script.textContent || '' };
      }
      try {
        const res = await fetch(script.src, { credentials: 'include', cache: 'force-cache' });
        const text = await res.text();
        return { id: 'src:' + index, source_url: script.src, inline: false, source: text, status: res.status };
      } catch (error) {
        return { id: 'src:' + index, source_url: script.src, inline: false, source: '', error: error.message || String(error) };
      }
    }));
  `, { limit });
  return {
    transport: result.transport,
    page: result.page,
    rows: Array.isArray(result.value) ? result.value : [],
  };
}

async function handleSearchInScripts(args) {
  const keywords = asArray(args?.keywords).length > 0 ? asArray(args.keywords) : COMMON_KEYWORDS;
  const pattern = String(args?.pattern ?? "").trim();
  const regex = pattern ? new RegExp(pattern, "i") : new RegExp(keywords.map((item) => item.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|"), "i");
  const sources = await scriptSources(args, Number(args?.script_limit ?? 80));
  const matches = [];
  for (const row of sources.rows) {
    const lines = String(row.source ?? "").split(/\r?\n/);
    for (let index = 0; index < lines.length; index += 1) {
      if (regex.test(lines[index])) {
        matches.push({
          script_id: row.id,
          source_url: row.source_url,
          line: index + 1,
          text: clip(lines[index].trim(), 500),
        });
        if (matches.length >= Number(args?.max_records ?? 200)) break;
      }
    }
    if (matches.length >= Number(args?.max_records ?? 200)) break;
  }
  return { ok: true, transport: sources.transport, page: sources.page, keywords, pattern, matches };
}

async function handleFindInScript(args) {
  const source = await handleGetScriptSource(args);
  const needle = String(args?.pattern ?? args?.keywords ?? "").trim();
  if (!source.ok || !needle) {
    return { ok: false, error: source.error ?? "pattern is required", source };
  }
  const lines = String(source.source ?? "").split(/\r?\n/);
  const matches = [];
  for (let index = 0; index < lines.length; index += 1) {
    if (lines[index].includes(needle)) {
      matches.push({ line: index + 1, text: clip(lines[index].trim(), 500) });
    }
  }
  return { ok: true, script_id: source.id, source_url: source.source_url, matches };
}

export {
  handleFindInScript,
  handleGetScriptSource,
  handleListScripts,
  handleSearchInScripts,
  scriptSources,
};
