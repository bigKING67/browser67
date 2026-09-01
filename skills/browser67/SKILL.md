---
name: browser67
description: >-
  Use for browser67 real-browser agent runtime work: tmwd_browser MCP setup and
  operation, Chrome/Edge profile automation, managed tabs, auth lifecycle,
  screenshots/evidence, downloads/uploads, native fallback planning, runtime
  home migration, project governance, and the paired js-reverse MCP surface.
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

## Naming

- Use `browser67` for the project, package, CLI, docs, and runtime umbrella.
- Keep `tmwd_browser` and `js-reverse` as MCP config keys.
- Do not install or route through the retired `tmwd-browser-mcp` Skill.
- Runtime home is resolved through `BROWSER67_HOME`, legacy
  `TMWD_BROWSER_MCP_HOME`, existing `~/.browser67`, existing
  `~/.tmwd-browser-mcp`, then fresh default `~/.browser67`.

## Core workflow

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
   - Each Chrome/Edge Browser Profile must load/enable the extension separately.
     browser67 identifies its bridge with the Profile-local opaque
     `browser67.browser_instance_id.v1` UUID; the target identity is
     `(browser_instance_id, tab_id)`.
   - With multiple active Browser Instances, call `browser_instance_ops list`
     and pass `browser_instance_id`, or set an explicit default. Treat
     `AMBIGUOUS_TARGET` and `BROWSER_INSTANCE_UNAVAILABLE` as fail-closed routing
     states; never choose the first/latest surviving Profile.
4. For real browser work, select/create browser67-owned managed tabs and finalize
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
   - If the user already opened and logged into a tab, use
     `inspect_adoption -> adopt_existing` on that exact tab. Do not reopen the
     page or repeat login. Finalization releases adopted tabs without closing
     them.
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
5. For JS reverse work, use the `js-reverse` MCP and finalize pages opened by
   `js-reverse new_page`.
6. Windows GUI portability proof remains in the default external acceptance
   set. Linux GUI proof is on demand only; headless/SSH Linux servers do not
   require it. On an in-scope interactive GUI host, run
   `npm run check:native-live` first. Run `proof:native-live` only with the
   explicit physical/confirm environment flags and `--write`; never fabricate a
   target-OS proof on another platform. Select Linux explicitly with
   `--id native-live-linux` or `--include-on-demand`.
7. For explicitly confirmed physical CAPTCHA assist on macOS, require the
   exact managed Chrome/Edge tab id before `cliclick`, with its redacted URL only
   as a fallback. Use logical screen-point window bounds, prefer a detected
   slider track over the handle-only rect, and keep CAPTCHA screenshots
   region-bounded.
8. Treat provider `[role="button"]` controls and same-tab existing-account,
   authorize, or consent pages as SSO handoffs. Require explicit popup evidence
   before using `manual_context.kind:"oauth_popup"`. For JS clicks that may open
   a delayed provider window, rely on the bounded default new-target poll or set
   `new_tab_wait_ms`; `no_monitor:true` intentionally disables that poll.
9. Treat MCP output as `browser67.tool-outcome.v3`: inspect `ok/status`, then
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
10. Use `script`, not the removed `code` alias, for `browser_execute_js` and
    `browser_job_ops.start`. Bridge commands must be strict JSON.
11. For a script or NodeRef action whose network completion matters, pass
    bounded `network_observation` options and inspect its idle/final summary.
    Snapshot `limitations` and `marker_policy` are authoritative for opaque
    cross-origin frames, closed shadow roots, document lifetime, and retention.

## CAPTCHA and physical input

- Treat `manual_required_captcha`, `manual_required_mfa`, and
  `manual_required_sso` as handoff states. Start CAPTCHA assistance with
  `browser_auth_ops.plan_captcha_assist`; it is a dry-run planner and must keep
  screenshots region-bounded, redact provider data, and degrade inaccessible
  cross-origin challenges to manual handoff.
- Call `browser_auth_ops.assist_captcha` only on a browser67-owned managed tab
  with the matching explicit coordinate-source confirmation and
  `confirm_physical_input:true`. Never use token/cookie extraction, JS/CDP
  clicks, or fullscreen screenshots to solve a challenge.
- CAPTCHA/native input uses the managed-tab focus lease, not an unscoped
  `tabs.switch`. Keep the default guarded restore unless the user explicitly
  requests `focus_policy:"foreground"`.
- Configure JFBYM/Yunma only through the repo-external setup path, then run
  `npm run check:captcha-router`, `npm run check:captcha-provider-jfbym`,
  `npm run check:captcha-provider-jfbym-setup`, and
  `npm run check:captcha-provider-jfbym-coordinate` after router/provider
  changes. Protocol solving remains default-off and separately confirmed.
- Run `npm run check:native-pointer` before physical click/drag work. The
  optional GUI gate is `npm run check:captcha-assist-physical-live` and requires
  the explicit physical/confirm environment flags; skipped or blocked runs are
  not proof. Accept CAPTCHA/native proof only when its
  `browser67.optional-proof-source.v1` identity is source-equivalent to the
  current `physical-input-v1` behavior digest; an unexpired historical proof
  cannot prove newer focus/native code. Use `npm run check:ljqctrl` only as a
  diagnostic unless the guarded execution bridge is explicitly enabled.
- Treat macOS native `scroll` as unsupported until a verified wheel-event
  driver exists; `cliclick w:` is wait, not scroll. Use managed-page DOM/CDP
  scrolling only when it preserves the intended interaction semantics.
- Wait at least five seconds after a failed physical attempt and hand off for
  multi-round image/puzzle challenges. Do not keep trying selectors, unrelated
  profiles, cross-origin IdP actions, or repeated submits.

## Quality bar

- Keep browser-visible claims backed by live browser evidence or a clear skipped
  reason; responsive screenshots must include viewport/PNG dimension verification
  before treating a mobile artifact as valid evidence.
- Keep large outputs bounded; write screenshots, run records, and rebuild
  bundles as repo-external artifacts with path/hash/count metadata. Prefer
  selector/clip screenshots and inspect the returned path only when needed;
  never inline screenshot base64 into tool context.
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
- Run `npm run check:mcp`, `npm run check:js-reverse-mcp`,
  `npm run check:browser67-naming`, `npm run check:runtime-home`, and
  `npm run skills:check` after naming/runtime/tooling changes.
