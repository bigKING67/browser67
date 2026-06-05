# Security

`browser67` / `tmwd-browser-mcp` is a local MCP toolkit for real Chrome/Edge
automation and JavaScript reverse-engineering workflows. It is designed for
trusted local agent use.

## Local browser profile access

The TMWD path connects to a real browser profile through a local hub and an
unpacked extension. Depending on the tool call, it can inspect page content,
tabs, cookies, storage, downloads, uploads, and runtime state. Treat any agent
with access to this MCP server as able to operate that local browser profile.

Default browser work should use TMWD-owned managed tabs. User-opened unmanaged
tabs are read-only by default and must not be navigated, typed into, clicked,
closed, or adopted unless the user explicitly asks for that tab to be operated
on.

## Data that must not be committed

Do not commit:

- `extension/config.js`
- `runtime/` or `.tmwd-browser-mcp/`
- JS reverse evidence/rebuild bundles containing real request samples
- cookies, tokens, credentials, localStorage/sessionStorage values, or HAR/PCAP
  files from real sites
- `.env` files or machine-specific secret material

The repository keeps schemas and examples that mention cookies/tokens only as
placeholders or key-name examples. They must not contain real secret values.

## Network exposure

The default hub endpoints are local loopback endpoints:

- `ws://127.0.0.1:18765`
- `http://127.0.0.1:18766/link`

Do not expose these endpoints to untrusted networks. If you run this toolkit in
CI, containers, or shared hosts, bind it to local-only interfaces and use a
separate test browser profile.

## Reporting issues

For security issues in this repository, use the GitHub issue tracker only for
non-sensitive reports. For sensitive reports, avoid including cookies, tokens,
screenshots of private pages, or request captures with live credentials.
