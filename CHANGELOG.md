# Changelog

## 0.2.0 - 2026-07-01

- Promote `browser67` as the canonical project/package/CLI/runtime identity.
- Keep `tmwd-browser-mcp` and `tmwd-browser` as explicit compatibility aliases.
- Move the default runtime home to `~/.browser67` while preserving
  `~/.tmwd-browser-mcp` as copy-only migration compatibility.
- Add canonical MCP entrypoints under `src/mcp/browser/` and
  `src/mcp/js-reverse/` while retaining legacy server shims.
- Normalize setup registry output to canonical MCP server paths.
- Add release-readiness governance for version metadata, changelog coverage,
  clean/synced release checks, Pi package pin follow-up, and optional live proof
  boundaries.
- Keep GenericAgent/TMWebDriver provenance explicit through upstream lock and
  review gates.

