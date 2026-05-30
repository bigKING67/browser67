import { compactText, hashText } from "./common.mjs";

function extractActionableNodes(html, limit) {
  const text = String(html ?? "");
  const pattern = /<(a|button|input|select|textarea)[^>]*>(.*?)<\/\1>|<(input|select|textarea)[^>]*\/?>/gims;
  const nodes = [];
  let match = pattern.exec(text);
  while (match && nodes.length < limit) {
    const raw = match[0] ?? "";
    const tag = (match[1] || match[3] || "unknown").toLowerCase();
    const content = match[2] ?? "";
    const nodeText = compactText(content.replace(/<[^>]+>/g, " "), 120);
    const id = `${tag}_${hashText(raw).slice(0, 10)}`;
    nodes.push({
      id,
      role: tag,
      text: nodeText,
      selector: `${tag}[data-ga-node="${id}"]`,
    });
    match = pattern.exec(text);
  }
  return nodes;
}

export { extractActionableNodes };
