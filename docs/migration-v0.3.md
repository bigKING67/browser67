# browser67 v0.3 migration

browser67 v0.3 is a deliberate breaking upgrade. It keeps the single package,
the `tmwd_browser` and `js-reverse` MCP keys, and the TMWD-first login-state
boundary, but removes legacy input/output ambiguity.

## MCP result envelope

Both MCP surfaces now return JSON encoded in standard MCP text content using:

```json
{
  "schema": "browser67.tool-outcome.v3",
  "ok": true,
  "status": "completed",
  "data": {},
  "meta": {
    "tool": "browser_scan",
    "request_id": "tool_...",
    "duration_ms": 12.3
  },
  "warnings": [],
  "artifacts": []
}
```

Failures use `ok:false`, `status:"failed"`, and a structured `error` with
`code`, `message`, `retryable`, and optional `details`. Consumers that formerly
read the handler payload at the content root must read `data` after confirming
the envelope.

## Raw execution input

- `browser_execute_js.code` is removed. Use `script`.
- `browser_job_ops.code` is removed. Use `script` when `action:"start"`.
- Bridge commands must be strict JSON strings such as
  `{"cmd":"tabs"}`. JavaScript object-literal syntax such as `{cmd:'tabs'}` is
  rejected and is never evaluated with `Function(...)`.
- Structured NodeRef operations use `operation`, `node_ref`, and optional
  `expected`/`value`; they cannot be combined with `script`.

## User tabs and adoption

User-opened tabs remain `user_unmanaged` and read-only by default. A tab that
the user opened and logged into does not need to be reopened or logged in
again. Adopt it in place:

1. Call `browser_tab_lifecycle` with `action:"inspect_adoption"` and the exact
   tab id.
2. Present/retain the returned short-lived adoption capability token.
3. Call `action:"adopt_existing"` with the same tab, workspace/task scope, and
   token.
4. Operate the resulting `user_adopted` managed tab. Raw TMWD script execution
   and NodeRef mutations reject unmanaged tabs.
5. Call `finalize_task` or `release_adopted`. Adopted tabs are released, not
   closed, by default.

Adoption tokens expire after 60 seconds. The default lease is 10 minutes and is
renewed while browser67 owns the tab. Closing an adopted user tab requires the
separate `inspect_close_adopted` then `close_adopted` two-stage token flow.

Navigation inside an adopted lease is guarded separately. Before an Agent
operation that may navigate, browser67 asks the extension for a short-lived
one-shot authorization and reconciles the resulting navigation generation on
the next snapshot or mutation. A user/manual navigation, extension connection
generation change, ownership/lease change, regressed generation, or missing
managed policy suspends the record. Calls then fail with
`ADOPTED_TAB_SUSPENDED`; obtain a fresh adoption token and run
`inspect_adoption -> adopt_existing` again against the new document.

## Ordinary and managed extension behavior

The generated v0.3 extension overlay keeps ordinary tabs unchanged:

```text
managed:false
CSP unchanged
native dialogs
no badge or marker
no browser67 content bridge
no browser67 network observer
```

Agent-created or adopted managed tabs can enable tab-scoped CSP/dialog/badge,
marker, bridge, and network policies. Releasing ownership removes those
effects. After updating source, the installed unpacked extension is not changed
until the operator explicitly runs `npm run setup`, reloads the extension, and
refreshes affected tabs.

## Snapshot, diff, and wait changes

- `browser_extract` returns `browser67.actionable-snapshot.v2` with scoped
  NodeRefs, accessibility data, frame/shadow paths, locator candidates, and
  redacted sensitive values. Cross-origin/denied iframes are declared opaque,
  and closed shadow roots are explicitly declared unobservable.
- Snapshot `marker_policy` declares `data-browser67-node-id` as stable only in
  the current document, ending on navigation or managed-policy release, with
  explicit TTL, per-tab, and global snapshot bounds.
- `browser_diff` returns `browser67.semantic-diff.v2` instead of HTML line-set
  hashes.
- The former resource-count heuristic is named `resource_quiet`.
- `network_idle` uses request lifecycle/in-flight tracking.
- `browser_execute_js.network_observation` now covers raw scripts as well as
  structured NodeRef operations and returns a bounded idle/final summary.
- `dom_stable` accepts `root_selector`, `ignore_selectors`,
  `ignore_attributes`, and `mutation_threshold`.

`tmwd_mode=auto` remains TMWD-owned for execution authorization. A transport
failure does not silently become an explicit remote-CDP login-state route;
only `tmwd_mode=remote_cdp` or `cdp` may use the isolated debug/CI exception.

## Runtime run/job storage

New writes use `browser67.run.v2` and `browser67.browser-job.v3`. Audit an
existing repo-external runtime before migration:

```bash
npm run runtime:migrate -- --check --json
```

Apply the migration only after reviewing the reported root:

```bash
npm run runtime:migrate -- --write --json
```

The migration upgrades run metadata and rebuilds group `index.ndjson`, the job
catalog, and the small active-job index. It does not introduce SQLite and does
not move runtime state into the repository.

## Verification

The executable verification manifest is the command source of truth:

```bash
npm run gate -- --tier fast
npm run gate -- --tier check
npm run gate -- --tier check --changed
npm run verify
npm run verify:live
npm run verify:platform
```

`npm run setup`, extension reload, active-skill sync, commit, push, tag, and
publish remain explicit operator actions outside deterministic migration.
