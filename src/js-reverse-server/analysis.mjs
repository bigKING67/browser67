import { randomUUID } from "node:crypto";

import {
  handleFindInScript,
  handleListScripts,
  handleSearchInScripts,
} from "./scripts.mjs";
import {
  handleGetDomStructure,
  handleListNetworkRequests,
} from "./network.mjs";
import { bridgeCommand, pageEval } from "./tmwd-adapter.mjs";
import {
  COMMON_KEYWORDS,
  hashText,
} from "./utils.mjs";

async function handleAnalyzeTarget(args) {
  const [scripts, network, dom, search] = await Promise.all([
    handleListScripts(args),
    handleListNetworkRequests(args),
    handleGetDomStructure(args),
    handleSearchInScripts({ ...args, keywords: args?.keywords ?? COMMON_KEYWORDS, max_records: 80 }),
  ]);
  const priorityTargets = network.requests
    .filter((item) => /sign|token|nonce|h5st|x-bogus|msToken|signature/i.test(JSON.stringify(item)))
    .slice(0, 20);
  return {
    ok: true,
    page: dom.page,
    requestFingerprints: {
      requests_count: network.requests.length,
      priority_count: priorityTargets.length,
      priorityTargets,
    },
    scripts: {
      count: Array.isArray(scripts.scripts) ? scripts.scripts.length : 0,
      keyword_matches: search.matches,
    },
    dom: dom.dom,
    signatureChain: search.matches.slice(0, 20),
    actionPlan: [
      "Install fetch/xhr hooks with create_hook + inject_hook.",
      "Reproduce the target action.",
      "Read get_hook_data(view=summary), then raw records with initiator stacks.",
      "Only then export_rebuild_bundle or patch local environment.",
    ],
  };
}

function handleUnderstandCode(args) {
  const code = String(args?.code ?? "");
  return {
    ok: true,
    fingerprint: hashText(code),
    length: code.length,
    functions: Array.from(code.matchAll(/(?:function\s+([\w$]+)|(?:const|let|var)\s+([\w$]+)\s*=\s*(?:async\s*)?\(?[^=]*=>)/g)).slice(0, 80).map((match) => match[1] || match[2]),
    suspicious_keywords: COMMON_KEYWORDS.filter((keyword) => new RegExp(keyword, "i").test(code)),
    notes: [
      /eval|Function\(/.test(code) ? "dynamic evaluation detected" : null,
      /atob|btoa|TextEncoder|crypto/.test(code) ? "encoding/crypto APIs detected" : null,
    ].filter(Boolean),
  };
}

function handleDeobfuscateCode(args) {
  const code = String(args?.code ?? "");
  const pretty = code
    .replace(/;/g, ";\n")
    .replace(/\{/g, "{\n")
    .replace(/\}/g, "\n}\n")
    .replace(/,(?=[A-Za-z_$])/g, ",\n")
    .split(/\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .join("\n");
  return {
    ok: true,
    warning: "lightweight formatter only; use AST tooling for production deobfuscation",
    source_hash: hashText(code),
    code: pretty,
  };
}

function handleDetectCrypto(args) {
  const code = String(args?.code ?? "");
  const patterns = {
    md5: /md5/i,
    sha: /sha(?:1|256|512)?/i,
    hmac: /hmac/i,
    aes: /\bAES\b|CryptoJS\.AES/i,
    rsa: /\bRSA\b|JSEncrypt/i,
    base64: /atob|btoa|base64/i,
    webcrypto: /crypto\.subtle|SubtleCrypto/i,
    x_bogus: /x-bogus|xbogus/i,
    h5st: /h5st/i,
  };
  return {
    ok: true,
    detected: Object.entries(patterns).filter(([, regex]) => regex.test(code)).map(([name]) => name),
    source_hash: hashText(code),
  };
}

function handleSummarizeCode(args) {
  const code = String(args?.code ?? "");
  return {
    ok: true,
    source_hash: hashText(code),
    lines: code.split(/\r?\n/).length,
    bytes: Buffer.byteLength(code),
    summary: `Code has ${String(code.length)} characters, ${String((code.match(/function|=>/g) || []).length)} function-like constructs, and ${String(COMMON_KEYWORDS.filter((keyword) => new RegExp(keyword, "i").test(code)).length)} reverse-keyword hits.`,
  };
}

function handleRiskPanel(args) {
  const code = String(args?.code ?? JSON.stringify(args?.data ?? {}));
  const hits = handleDetectCrypto({ code }).detected;
  const dynamic = /eval|Function\(|debugger|setInterval|setTimeout/.test(code);
  const score = Math.min(100, hits.length * 12 + (dynamic ? 20 : 0) + (/webdriver|bot|captcha/i.test(code) ? 20 : 0));
  return {
    ok: true,
    score,
    level: score >= 60 ? "high" : score >= 30 ? "medium" : "low",
    signals: { crypto: hits, dynamic_execution: dynamic },
  };
}

function handleDiffEnvRequirements(args) {
  const text = JSON.stringify(args?.data ?? args ?? {});
  const candidates = ["window", "document", "navigator", "location", "localStorage", "sessionStorage", "crypto", "TextEncoder", "atob", "btoa", "fetch", "XMLHttpRequest"];
  return {
    ok: true,
    likely_requirements: candidates.filter((name) => new RegExp(name, "i").test(text)),
    recommendation: "Patch the first missing API shown in the local proxy/env log, then rerun. Do not batch-patch multiple environment gaps.",
  };
}

async function handleCollectCode(args) {
  const search = await handleSearchInScripts(args);
  const collection = {
    id: `collection_${randomUUID().slice(0, 8)}`,
    ts: new Date().toISOString(),
    matches: search.matches,
    hash: hashText(JSON.stringify(search.matches)),
  };
  return { ok: true, collection };
}

function handleCollectionDiff(args) {
  const before = args?.before ?? {};
  const after = args?.after ?? {};
  const beforeSet = new Set((before.matches ?? []).map((item) => hashText(JSON.stringify(item))));
  const afterSet = new Set((after.matches ?? []).map((item) => hashText(JSON.stringify(item))));
  return {
    ok: true,
    added: [...afterSet].filter((item) => !beforeSet.has(item)),
    removed: [...beforeSet].filter((item) => !afterSet.has(item)),
  };
}

async function handleInjectStealth(args) {
  const result = await pageEval(args, `
    Object.defineProperty(navigator, 'webdriver', { get: () => false, configurable: true });
    window.chrome ||= { runtime: {} };
    return { ok: true, webdriver: navigator.webdriver === false };
  `);
  return { ok: true, transport: result.transport, page: result.page, result: result.value };
}

async function handleSetUserAgent(args) {
  const userAgent = String(args?.user_agent ?? "").trim();
  if (!userAgent) return { ok: false, error: "user_agent is required" };
  const result = await bridgeCommand(args, {
    cmd: "cdp",
    method: "Network.setUserAgentOverride",
    params: { userAgent },
  });
  return { ok: true, transport: result.transport, page: result.page, result: result.value };
}

export {
  handleAnalyzeTarget,
  handleCollectCode,
  handleCollectionDiff,
  handleDeobfuscateCode,
  handleDetectCrypto,
  handleDiffEnvRequirements,
  handleFindInScript,
  handleInjectStealth,
  handleRiskPanel,
  handleSetUserAgent,
  handleSummarizeCode,
  handleUnderstandCode,
};
