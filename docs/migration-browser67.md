# browser67 migration

This document covers the migration from the legacy `tmwd-browser-mcp` identity
to browser67.

## What changed

- Canonical package and CLI name: `browser67`.
- Real-browser MCP server identity: `browser67-tmwd-browser`.
- Canonical runtime env: `BROWSER67_HOME`.
- Canonical runtime home: `~/.browser67`.
- Legacy bin names (`tmwd-browser-mcp`, `tmwd-browser`) remain wrappers around
  `browser67`.
- MCP config keys remain `tmwd_browser` and `js-reverse`.

## Safe migration flow

Inspect first:

```bash
browser67 migrate-home --dry-run
```

Copy legacy state:

```bash
browser67 migrate-home --write
```

Then reload the unpacked browser extension from:

```text
~/.browser67/browser/tmwd_cdp_bridge/
```

Finally verify:

```bash
npm run doctor
npm run check:live:doctor
```

## Compatibility policy

The migration is copy-only. It does not delete `~/.tmwd-browser-mcp`, does not
read browser cookies/password stores, and does not move unrelated user files.

If a machine still has only `~/.tmwd-browser-mcp`, browser67 may continue using
that path until the operator runs the migration. This prevents local live gates,
managed-tab registries, optional proofs, and extension installs from appearing
lost after an upgrade.

## Legacy cleanup boundary

`browser67 migrate-home --write` is intentionally copy-only. It does not delete
or archive `~/.tmwd-browser-mcp`.

Use this checklist before any manual legacy-home cleanup:

1. `browser67 migrate-home --dry-run`
2. `browser67 migrate-home --write`
3. `browser67 setup`
4. Reload the unpacked extension from `~/.browser67/browser/tmwd_cdp_bridge/`
   in `chrome://extensions`.
5. Refresh target tabs so content scripts are injected from the new extension
   install path.
6. `npm run check:live:doctor`
7. `npm run check:managed-tab-live`
8. `npm run check:screenshot-live`
9. Ask the operator before archiving or deleting `~/.tmwd-browser-mcp`.

Do not rename or delete `tmwd_cdp_bridge`: that name remains the extension and
protocol provenance label. Keep the `tmwd_browser` MCP key and
`tmwd-browser-mcp` bin/skill aliases until downstream Codex, Pi, grobot, and
user configs have migrated.

## LaunchAgent

The canonical user-level macOS label is:

```text
com.browser67.tmwd-hub
```

Legacy labels:

```text
com.browser67.tmwd-browser-mcp
com.gaoqian.tmwd-browser-mcp
```

Install the canonical label with:

```bash
npm run launchd:install
```

Remove the canonical label:

```bash
npm run launchd:uninstall
```

Remove legacy and canonical labels:

```bash
npm run launchd:uninstall -- --all
```
