# Browser67 Setup and Maintenance

Read for setup, migration, naming/tool changes, permissions, or host/release
acceptance. These are conditional maintenance procedures, not prerequisites for
ordinary page work. Preserve the host's existing authorization boundaries.

## Naming

- Use `browser67` for the project, package, CLI, docs, and runtime umbrella.
- Keep `tmwd_browser` and `js-reverse` as MCP config keys.
- Do not install or route through the retired `tmwd-browser-mcp` Skill.
- Runtime home is resolved through `BROWSER67_HOME`, legacy
  `TMWD_BROWSER_MCP_HOME`, existing `~/.browser67`, existing
  `~/.tmwd-browser-mcp`, then fresh default `~/.browser67`.

## Setup and migration

1. Check readiness with `browser67 doctor` or `npm run doctor`.
2. For setup, use `browser67 setup`; it writes under the active browser67 home.
   When an existing bridge is connected, use `npm run extension:reload-live`
   after setup and confirm readiness with `npm run check:live:doctor`.
   A verified TMWD route requires `tmwd_ws_runtime` or `tmwd_link_runtime` to
   report `extension_identity_ok`; this compares the live `ext_ready` build
   identity with the deterministic current source identity and reports matching
   installed roots instead of trusting disk files alone.
3. For legacy runtime migration, run `browser67 migrate-home --dry-run` before
   `browser67 migrate-home --write`.

## Host acceptance

- Windows GUI portability proof remains in the default external acceptance
   set. Linux GUI proof is on demand only; headless/SSH Linux servers do not
   require it. On an in-scope interactive GUI host, run
   `npm run check:native-live` first. Run `proof:native-live` only with the
   explicit physical/confirm environment flags and `--write`; never fabricate a
   target-OS proof on another platform. Select Linux explicitly with
   `--id native-live-linux` or `--include-on-demand`.

## Runtime and tooling checks

- Run `npm run check:mcp`, `npm run check:js-reverse-mcp`,
  `npm run check:browser67-naming`, `npm run check:runtime-home`, and
  `npm run skills:check` after naming/runtime/tooling changes.
- Keep runtime directories owner-only (`0700`) and runtime files/artifacts
  owner-only (`0600`); new MCP server processes set umask `077`, and the
  managed-tab registry is written atomically as `0600` under its private default
  directory. Audit existing runtime and managed-tab registry state before applying with
  `npm run runtime:permissions:dry-run -- --json`; stale run terminalization and
  empty-group pruning have separate dry-run/explicit-write commands and must not
  be conflated with retention deletion.
