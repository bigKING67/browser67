---
name: browser67
description: Operate real Chrome/Edge pages through browser67, including managed tabs and login-state workflows. Also use for browser67 setup or maintenance.
---

# browser67

Use this skill for browser67, the canonical real-browser agent runtime. It owns
two paired MCP surfaces:

- `tmwd_browser`: browser67 real Chrome/Edge profile automation tool key.
- `js-reverse`: browser67-backed API discovery, hooks, network/WS sampling, evidence
  export, and local rebuild workflows.

## Host governance

- Before live page work, read any browser governance file named by the active
  `AGENTS.md`. In the standard user setup this is `~/.codex/rules/browser.md`;
  it owns cross-tool routing, user-tab/privacy boundaries, readiness, focus,
  lifecycle completion, and cleanup authorization. This Skill maps that policy
  to browser67 operations and remains self-contained when no host rule exists.
- Do not load the full `docs/codex-integration.md` for routine page work. Read it
  only for MCP setup, exact schemas/fields, implementation changes, specialized
  auth/CAPTCHA/native-input behavior, or release/readiness maintenance.

## Choose the task

For ordinary page work, use the workflow below. Read
[references/setup-and-maintenance.md](references/setup-and-maintenance.md) only
for installation, runtime-home migration, naming/tool changes, permissions, or
host/release acceptance. Read
[references/auth-and-native-input.md](references/auth-and-native-input.md)
before SSO/auth handoffs, CAPTCHA assistance, or physical/native input. These
routes do not authorize installation, external writes, or physical actions.

## Core workflow

1. Reuse current successful runtime evidence for ordinary page work. When
   readiness is unknown or a call reports a transport/identity failure, run a
   bounded doctor/health check; setup and release identity proof use the
   maintenance reference. Do not reinstall or run host acceptance for a normal
   page read.
   - Each Chrome/Edge Browser Profile must load/enable the extension separately.
     browser67 identifies its bridge with the Profile-local opaque
     `browser67.browser_instance_id.v1` UUID; the target identity is
     `(browser_instance_id, tab_id)`.
   - With multiple active Browser Instances, call `browser_instance_ops list`
     and pass `browser_instance_id`, or set an explicit default. Treat
     `AMBIGUOUS_TARGET` and `BROWSER_INSTANCE_UNAVAILABLE` as fail-closed routing
     states; never choose the first/latest surviving Profile.
2. For real browser work, select/create browser67-owned managed tabs and finalize
   the current `workspace_key`/`task_id` before handoff; report the returned
   `delivery_summary` so tab cleanup state is visible.
   - Default new work to `window_policy:"dedicated"`,
     `focus_policy:"background_preferred"`, and `active:false`. This uses a
     non-focused browser67 Agent window in the same Browser Profile, preserving
     approved login/session state without replacing the user's active tab.
   - `window_policy:"current"` fails closed for agent-created work. To operate
     an exact user tab, use `inspect_adoption -> adopt_existing`; do not create
     or navigate a tab in the user's current window as a shortcut.
     `focus_policy:"foreground"` requires `confirm_foreground:true` and is only
     for an intentional visible handoff.
     `background_only` must fail closed when an operation requires foreground.
   - Native/CAPTCHA operations may use a bounded managed-tab focus lease. A
     Browser Profile permits only one active lease, including concurrent
     requests. Switching to another app counts as user activity. A
     default restore is valid only when no user activity was observed, both
     targets still exist, the managed target remains foreground, and the
     extension service worker did not restart; otherwise do not steal focus.
   - Before reusing a dedicated managed tab, verify its live `window_id`. If the
     user moved it out of the Agent window, quarantine that registry record and
     select/create another dedicated tab; never move the user's tab back.
   - Reuse navigation is bound to the exact managed `(browser_instance_id,
     tab_id)` and uses an explicit tab-targeted browser command. If that exact
     tab does not become routable, fail with `NO_SESSION`; never execute the
     navigation through the active/default session or another user tab.
   - Treat effective transport as lifecycle authority. If an explicitly allowed
     `tmwd_mode:"auto"` call falls back to controlled CDP, keep the managed page
     as `isolated_target` through reuse and `finalize_task`; do not reinterpret
     it as a dedicated-window tab or leave it uncloseable.
   - Keep entry, adoption, and `finalize_task` on the same
     `browser_instance_id`. If a workspace/task spans multiple instances,
     omission must fail with `AMBIGUOUS_TARGET`; deliberate cross-instance
     cleanup requires `confirm_all_browser_instances:true`.
   - If the user already opened and logged into a tab, keep read-only requests
     read-only. Only when the user explicitly requests operating that exact tab,
     use `inspect_adoption -> adopt_existing`. Do not reopen the page or repeat
     login. Finalization releases adopted tabs without closing them.
   - Agent navigation on an adopted tab uses a short-lived one-shot
     authorization. User/out-of-band navigation or a connection/lease change
     suspends the tab; run a fresh `inspect_adoption -> adopt_existing` before
     continuing.
   - Ordinary unmanaged tabs are read-only. Raw TMWD scripts and NodeRef
     mutations require an agent-created or adopted managed tab.
   - `list_managed` defaults to `summary_only:true` and returns only managed
     ownership counts, not unrelated live-session metadata. Request expanded
     rows explicitly only for scoped diagnosis.
   - A task scope defaults to at most eight open `keep:false` managed tabs.
     When `MANAGED_TAB_LIMIT_REACHED` occurs, finalize/prune that exact scope;
     use `confirm_managed_tab_overflow:true` only after reviewing it.
   - `finalize_task` also terminalizes nonterminal structured runs in the exact
     workspace/task scope as `interrupted`; explicit caller-owned screenshot
     runs therefore cannot remain `running` after normal task handoff.
   - Chrome debugger attachment UI is Browser-Profile-scoped. A same-Profile
     Agent window isolates tabs/focus, not Chrome's debugger indicator. Use a
     separate Browser Instance/Profile when that indicator must be isolated
     from the user's ordinary windows.
   - Use `browser_console_ops` with `action:"observe"` for bounded console API,
     runtime-exception, and optional Log-domain observation on the exact
     managed/adopted tab. It is non-persistent (maximum 30 seconds, 500 entries,
     and 300,000 serialized console-entry characters), shares the per-tab debugger
     queue, fails closed on external debugger ownership, and must report listener
     removal plus debugger-lease release before success.
3. For JS reverse work, use the `js-reverse` MCP and finalize pages opened by
   `js-reverse new_page`.
4. Treat MCP output as `browser67.tool-outcome.v3`: inspect `ok/status`, then
   read success data from `data` or failure details from `error`. Read the
   top-level `page` for the confirmed tab id/title/URL/managed state; `page:null`
   means the wrapper did not resolve one unique top-level page summary. For
   `browser_tab_lifecycle` entry actions, an exact `data.managed_tab` plus
   `data.status:"success"` and `data.ready:true` is a terminal successful entry;
   do not reopen or keep waiting solely because top-level `page` is null.
   A TMWD page includes `browser_instance_id`, `tab_id`, and `session_key`.
   - All `tmwd_browser` tools accept `output_mode:"compact"|"full"`. Prefer
     compact for routine work and full for transport/session/target diagnosis.
     Output mode only changes repeated diagnostics; content scope remains under
     each tool's scan/extract/execute/screenshot limit parameters.
5. Use `script`, not the removed `code` alias, for `browser_execute_js` and
    `browser_job_ops.start`. Bridge commands must be strict JSON.
6. For a script or NodeRef action whose network completion matters, pass
    bounded `network_observation` options and inspect its idle/final summary.
    Snapshot `limitations` and `marker_policy` are authoritative for opaque
    cross-origin frames, closed shadow roots, document lifetime, and retention.

## Quality bar

- Keep browser-visible claims backed by live browser evidence or a clear skipped
  reason; responsive screenshots must include viewport/PNG dimension verification
  before treating a mobile artifact as valid evidence. Viewport overrides for
  viewport, selector, clip, and bounded full-page targets must keep each
  set/probe/capture/clear transaction on one debugger attachment; reject
  `viewport.clear_after=false` because persistent debugger-scoped emulation is
  unsupported.
- Keep large outputs bounded; write screenshots, run records, and rebuild
  bundles as repo-external artifacts with path/hash/count metadata. Prefer
  selector/clip screenshots and inspect the returned path only when needed;
  never inline screenshot base64 into tool context.
- Keep runtime directories owner-only (`0700`) and runtime files and evidence
  artifacts owner-only (`0600`), including ordinary page-work exports.
- Do not silently fallback from browser67 login-state tasks to remote CDP.
  `tmwd_mode=auto` CDP fallback is not the explicit remote-CDP exception.
- Treat locked/disconnected Windows sessions as insufficient for the default
  `native-live-win32` proof. Headless/SSH Linux does not require GUI proof;
  `native-live-linux` applies only to an explicitly scoped Linux desktop.
- Keep docs, skills, schemas, and contracts synchronized for externally visible
  behavior changes.
- Browser Profile, Pi Agent Profile, native child Session, login profile, and
  worktree are separate concepts. `browser_instance_id` belongs only to
  browser67 Tool routing and must not be inferred from private Profile data.
- Ordinary tabs must retain native CSP/dialog behavior and receive no
  browser67 badge, marker, content bridge, or network observer.
