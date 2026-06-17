import { runtimeScript } from "./runtime-script.mjs";
import { pageEval } from "./tmwd-adapter.mjs";

async function handleListNetworkRequests(args) {
  const result = await pageEval(args, `
    ${runtimeScript()}
    const perf = performance.getEntriesByType('resource').map((entry, index) => ({
      id: 'perf:' + index,
      source: 'performance',
      name: entry.name,
      initiatorType: entry.initiatorType,
      startTime: Math.round(entry.startTime),
      duration: Math.round(entry.duration),
      transferSize: entry.transferSize || 0
    }));
    const hooks = root.records
      .filter((record) => ['fetch', 'xhr'].includes(record.kind))
      .map((record) => ({ id: record.id, source: 'hook', kind: record.kind, ts: record.ts, url: record.data?.request?.url || record.data?.response?.responseURL || record.url, data: record.data }));
    return { performance: perf, hooks, combined: [...hooks, ...perf] };
  `);
  return {
    ok: true,
    transport: result.transport,
    page: result.page,
    requests: result.value?.combined ?? [],
    performance: result.value?.performance ?? [],
    hooks: result.value?.hooks ?? [],
  };
}

async function handleGetNetworkRequest(args) {
  const requestId = String(args?.request_id ?? "").trim();
  const listed = await handleListNetworkRequests(args);
  const found = listed.requests.find((item) => item.id === requestId);
  return found ? { ok: true, request: found } : { ok: false, error: `request not found: ${requestId}` };
}

async function handleGetRequestInitiator(args) {
  const request = await handleGetNetworkRequest(args);
  if (!request.ok) return request;
  const stack = request.request?.data?.request?.stack;
  return {
    ok: Boolean(stack),
    request_id: args?.request_id,
    initiator: stack ? { stack } : null,
    note: stack ? "captured by runtime hook" : "performance entries do not include JavaScript initiator stack; inject fetch/xhr hooks before reproducing the request",
  };
}

async function handleWebSockets(args) {
  const result = await pageEval(args, `
    ${runtimeScript()}
    const perf = performance.getEntriesByType('resource').filter((entry) => /websocket/i.test(entry.initiatorType || '')).map((entry, index) => ({ id: 'wsperf:' + index, source: 'performance', name: entry.name }));
    const records = root.records.filter((record) => record.kind === 'websocket');
    return { performance: perf, records };
  `);
  return {
    ok: true,
    transport: result.transport,
    page: result.page,
    connections: result.value?.performance ?? [],
    messages: result.value?.records ?? [],
  };
}

async function handleGetWebSocketMessages(args) {
  const rows = await handleWebSockets(args);
  return { ok: true, messages: rows.messages };
}

async function handleGetDomStructure(args) {
  const result = await pageEval(args, `
    const walk = (node, depth = 0) => {
      if (!node || depth > 4) return null;
      const children = Array.from(node.children || []).slice(0, 12).map((child) => walk(child, depth + 1)).filter(Boolean);
      return {
        tag: node.tagName,
        id: node.id || '',
        className: String(node.className || '').slice(0, 120),
        text: String(node.innerText || node.textContent || '').replace(/\\s+/g, ' ').trim().slice(0, 160),
        children
      };
    };
    return { url: location.href, title: document.title, root: walk(document.body || document.documentElement) };
  `);
  return { ok: true, transport: result.transport, page: result.page, dom: result.value };
}

export {
  handleGetDomStructure,
  handleGetNetworkRequest,
  handleGetRequestInitiator,
  handleGetWebSocketMessages,
  handleListNetworkRequests,
  handleWebSockets,
};
