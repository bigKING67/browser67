function parseEndpoint(endpoint) {
  const value = String(endpoint ?? "").trim();
  if (!value) {
    throw new Error("empty endpoint");
  }
  const url = new URL(value);
  const protocol = url.protocol.replace(":", "");
  let port = Number(url.port || "");
  if (!Number.isFinite(port) || port <= 0) {
    port = protocol === "https" || protocol === "wss" ? 443 : 80;
  }
  return {
    protocol,
    host: url.hostname,
    port,
    href: url.href,
  };
}

export {
  parseEndpoint,
};
