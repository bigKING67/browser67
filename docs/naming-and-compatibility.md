# browser67 naming and compatibility

browser67 is the canonical project, package, CLI, and runtime umbrella.

## Canonical names

| Layer | Canonical name | Notes |
| --- | --- | --- |
| Project / package / CLI | `browser67` | New docs, setup commands, and release notes should use this name. |
| Real-browser MCP config key | `tmwd_browser` | Keeps the tool surface explicit: real Chrome/Edge profile automation through TMWD. |
| JS reverse MCP config key | `js-reverse` | A first-class browser67 surface for API discovery, hooks, network sampling, and rebuild bundles. |
| Browser MCP server identity | `browser67-tmwd-browser` | Returned by MCP `initialize` for the real-browser server. |
| Runtime home env | `BROWSER67_HOME` | Canonical override for repo-external browser67 runtime state. |
| Runtime home default | `~/.browser67` | New installs and migrated installs should use this location. |

## Compatibility names

`tmwd-browser-mcp` remains a compatibility alias only:

- legacy npm/bin entrypoint;
- legacy skill name for callers that have not switched to `skills/browser67`;
- legacy runtime path `~/.tmwd-browser-mcp`;
- historical docs or upstream provenance context.

Do not use `tmwd-browser-mcp` as the umbrella project name in new docs. When the
legacy name appears, the surrounding text must make the compatibility role
explicit.

## Runtime-home resolution

Runtime state is resolved in this order:

1. `BROWSER67_HOME` when explicitly set;
2. `TMWD_BROWSER_MCP_HOME` / `TMWD_HOME` for legacy callers;
3. existing `~/.browser67`;
4. existing `~/.tmwd-browser-mcp` to avoid making old local state disappear;
5. fresh default `~/.browser67`.

Use `browser67 migrate-home --dry-run` before copying legacy state. The migration
copies into `~/.browser67`, writes a manifest when `--write` is used, and never
deletes the legacy source.

## Upstream provenance

GenericAgent/TMWebDriver is an upstream protocol and extension provenance source,
not the browser67 product boundary. Upstream absorption must continue to go
through `npm run upstream:audit`, `npm run upstream:audit:latest`, and the
review/lock contracts before any local bridge files are updated.
