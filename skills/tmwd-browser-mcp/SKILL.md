---
name: tmwd-browser-mcp
description: >-
  Use for TMWD real-browser automation through tmwd_browser MCP: logged-in
  Chrome/Edge pages, current tabs, cookies/session-aware page inspection, CDP
  bridge commands, background tab actions, downloads/uploads, file chooser
  planning, clipboard write/paste wrappers, managed tab lifecycle, and native
  fallback planning. For page API/interface discovery, request initiator
  tracing, signature-chain tracing, script search, network/WS sampling, hooks,
  and rebuild bundles, hand off to the js-reverse MCP/skill backed by this same
  TMWD runtime.
---

# TMWD Browser MCP

Use this skill for real Chrome/Edge automation through `tmwd_browser`.

## Core workflow

1. Check readiness:
   - run `npm run doctor` in `/path/to/browser67`, or
   - call `browser_tab_ops` / `browser_scan` with `tmwd_mode="tmwd"`.
2. For login-state tasks, keep `tmwd_mode="tmwd"` and `tmwd_transport="auto"`.
3. Use `browser_transport_health` when a task may fail because of hub/extension/transport readiness. It probes `ws` and/or `link`, reports `healthy` / `degraded` / `broken`, and returns a preferred transport plus a concrete suggestion.
4. Use `browser_run_ops.prepare` for multi-step browser work that needs replayable evidence. Runs live outside the repo under `~/.tmwd-browser-mcp/runtime/runs` by default and contain `run.json`, `events.ndjson`, `artifacts/`, and `logs/`.
5. Use `browser_scan` for current page/tabs/text.
6. Use `browser_execute_js` for JS, bridge commands, CDP batch, cookies, and controlled navigation. For large DOM/network payloads, set `output_mode:"compact"` and an explicit `max_return_chars` to keep tool output bounded.
7. Use `browser_wait` instead of ad-hoc sleeps for readiness gates. Supported wait types are `selector`, `text`, `function`, `dom_stable`, and `network_idle`.
8. Use `browser_job_ops` for long-running browser JS when synchronous tool output would be brittle. Current jobs are in-process only (`durable:false`), and `cancel` is a best-effort intent marker (`abort_supported:false`) rather than a true interruption of page-side JS.
9. Use `browser_screenshot_ops` for real-browser PNG screenshot artifacts. Run it after `browser_tab_lifecycle.select_or_create` and `browser_wait`; use `target:"viewport"` for baseline visual QA, `target:"selector"` / `target:"clip"` for focused sections, and bounded `target:"full_page"` only with `max_pixels`. It writes artifacts outside the repo and returns path/hash/dimensions metadata, never image base64.
10. Use `browser_tab_ops` for list/switch/current/session selection.
11. Use `browser_file_ops` for upload inputs and native chooser planning.
12. Use `browser_download_ops` for per-run download prepare/wait/list flows.
13. Use `browser_tab_lifecycle` with `action="select_or_create"` for active work tabs. It reuses only TMWD-owned managed tabs; user-opened unmanaged tabs are read-only by default and must not be navigated, mutated, or closed.
   - Use stable `workspace_key` values at the project/surface level, for example `datahub-special-report`, not one-off subsection keys.
   - End active browser tasks with `action="finalize_task"` for the current `workspace_key` or `task_id` unless the user asked to keep the page open. `finalize_task` prunes stale registry records, closes only `keep:false` managed tabs in scope, preserves `keep:true`, and ignores unmanaged user tabs.
14. Use `browser_auth_ops.ensure_login` after selecting/creating a managed tab. It first checks whether the page is already authenticated; if the tab is on a login page, it only uses exact-origin local profiles from repo-external secret files, redacts outputs, and blocks unknown origins instead of guessing credentials. For a first-time site, use `suggest_profile` then explicit `upsert_profile` with user-provided credentials and `confirm_write:true`. Saved profiles may have redacted lifecycle sidecars (`<profile>.meta.json`) that record timestamps/status only. CAPTCHA, MFA, SSO-only, and OAuth popup pages are manual-required states and should return `manual_required_*` plus non-secret `manual_context` instead of continued automatic guessing.
15. Use `browser_clipboard_ops` for write/paste only; it intentionally does not read clipboard.
16. Use `browser_native_input` only when browser-side automation is blocked.
17. Use `js-reverse` MCP for page API discovery and reverse-specific
   observe/capture/rebuild work instead of overloading the generic
   `tmwd_browser` tools.

## Bridge command examples

```json
{"cmd":"tabs"}
{"cmd":"tabs","method":"create","url":"https://example.test","active":true}
{"cmd":"tabs","method":"get","tabId":123}
{"cmd":"tabs","method":"list","includeUnscriptable":true}
{"cmd":"cookies"}
{"cmd":"cdp","method":"Runtime.evaluate","params":{"expression":"document.title"}}
{"cmd":"batch","commands":[{"cmd":"tabs"},{"cmd":"cdp","method":"Runtime.evaluate","params":{"expression":"document.URL"}}]}
{"cmd":"contentSettings","type":"automaticDownloads","pattern":"https://*/*","setting":"allow"}
```

## Routing rules

- Use TMWD for the user's current browser, logged-in pages, cookies, and visible tab state.
- Use TMWD wrappers for downloads/uploads/file chooser planning/clipboard write-paste/managed tab lifecycle.
- When the user is already using a page, do not take over that unmanaged tab for active work. Create or reuse a TMWD-owned tab instead:
  `browser_tab_lifecycle({action:"select_or_create", url, ownership_policy:"tmwd_only", reuse_scope:"origin_path", workspace_key})`.
- Use `create_managed` only when a fresh TMWD-owned tab is explicitly needed; use `fresh:true` or `reuse:false` as the escape hatch.
- Managed tab registry is outside the repo by default: `~/.tmwd-browser-mcp/tab-workspace/managed-tabs.json`; use `BROWSER_STRUCTURED_TAB_REGISTRY_PATH` for isolated test/workspace runs.
- `create_managed` / `select_or_create` wait for new tabs to become visible by default (`wait_until:"listed"`). Use `wait_until:"none"` only when the caller will do its own readiness wait.
- `list_managed` is live-only by default and limits large arrays. Use
  `summary_only:true`, `max_items`, or `max_stale_items` for bounded
  diagnostics; pass `include_disconnected:true` or `history:true` only when you
  explicitly need disconnected session history.
- Use `prune_stale` to remove registry records for managed tabs that no longer exist; it never closes unmanaged user tabs.
- `finalize_task` is the preferred task-end cleanup wrapper and requires `workspace_key` or `task_id` unless explicitly using `scope:"all"` / `all:true` / `confirm_all:true`. Use `close_unkept` only when you need the lower-level close action without the finalizer summary.
- `create_managed` / `select_or_create` / `js-reverse new_page` responses include `finalize_hint`; if `finalize_hint.required` is true, run the suggested `finalize_task` call before the final response or handoff.
- Use `browser_wait` for selector/text/function/DOM-stable/network-idle waits and keep wait `timeout_ms` explicit on slow pages; avoid fixed sleeps as readiness proof.
- Use `browser_run_ops.record_event` to attach structured progress and normalized `evidence.v1` records to the current run. Override the default run root only with `BROWSER_STRUCTURED_RUN_ROOT` for isolated tests.
- Use `browser_job_ops.start/status/result/list/cancel` for long-running browser execution, but do not describe it as durable or preemptive: jobs are retained in the current MCP process only, and cancel does not stop already-running page code.
- If the managed tab redirects to login, call `browser_auth_ops.ensure_login` with the same `tab_id` (or exact `session_id`). Profiles live in `~/.codex/secrets/tmwd-login-profiles/` by default and must exact-match the current origin. Unknown origins are `blocked`; do not manually try unrelated credentials.
- For a new site with credentials supplied by the user, use `browser_auth_ops.suggest_profile` on the managed login tab, then `browser_auth_ops.upsert_profile` with exact `origin`/`allowed_origins`, selectors, username/password, and `confirm_write:true`; then call `ensure_login`. Profile writes are explicit and repo-external only. If the page is already logged in, `ensure_login` returns `already_authenticated:true` and does not require a profile or resubmit a form; when an exact-origin profile exists, its non-secret lifecycle sidecar can be updated.
- Treat `manual_required_captcha`, `manual_required_mfa`, and `manual_required_sso` as handoff points for user/manual action. OAuth popup flows keep the compatible `manual_required_sso` reason and use `manual_context.kind:"oauth_popup"`. CAPTCHA contexts can include `captcha_kind`, `captcha_assist`, and `captcha_router` metadata. The default router is `captcha_router_v2` / `hybrid_policy_v1`: visible UI challenges use bounded DOM/vision/provider coordinate planning plus explicit physical input, while provider protocol solving is default-off and only plans when `captcha_solver_mode:"protocol_allowed"`, `confirm_protocol_solver:true`, and repo-external provider origin allowlists all match. CDP is allowed for bring-to-front or window/region screenshots, but do not use fullscreen screenshots, JS/CDP clicks on CAPTCHA widgets, or browser token/cookie extraction; wait at least 5 seconds after failed attempts and hand off for multi-round image/puzzle challenges. Use `browser_auth_ops.plan_captcha_assist` first for dry-run coordinate/capability planning; it can return DOM client rectangles, slider drag hints, viewport metadata, physical-input provider selection, coordinate_transform screen estimates, `captcha_policy`, `captcha_router`, redacted `captcha_providers`, and region-only vision correction clips without clicking. Configure JFBYM/Yunma with `npm run setup:captcha-provider:jfbym -- --allowed-origin <origin> --write`, which writes only repo-external redacted config output. Run `npm run check:captcha-router`, `npm run check:captcha-provider-jfbym`, `npm run check:captcha-provider-jfbym-setup`, and `npm run check:captcha-provider-jfbym-coordinate` after router/provider edits or provider config changes. Add `run_vision_correction:true` only when needed; it captures a bounded clipped region artifact outside the repo, returns path/sha256/clip/TTL metadata, tracks scroll-adjusted CDP clips, converts same-origin iframe controls to top viewport coordinates with `frame_path`, and runs first-pass slider coordinate correction. Cross-origin captcha-like iframes must degrade to manual handoff with iframe rect, clipped screenshot plan, `degraded_mode:true`, and `manual_handoff_required:true`; do not infer inner controls or send physical input into them. Use `browser_auth_ops.assist_captcha` only with a TMWD-owned managed tab, `confirm_physical_input:true`, and caller-supplied screen coordinates, `auto_screen_coordinates:true` plus `confirm_auto_coordinates:true`, `use_vision_corrected_coordinates:true` plus `confirm_corrected_coordinates:true`, or `use_provider_coordinates:true` plus `confirm_provider_coordinates:true` on a selected allowlisted JFBYM coordinate route. Provider coordinates require a bounded region artifact from `run_vision_correction:true`, never expose image base64/token/cookies/sitekeys, and are converted through artifact clip plus refreshed viewport metrics before native click/drag. Selected `protocol_solver` routes currently block with `protocol_solver_apply_not_implemented` until a separate allowlisted response-apply contract exists. Normal TMWD-owned tabs are foregrounded with TMWD `tabs.switch`, settled with `pre_input_settle_ms`, and then planner/vision/provider coordinates are refreshed against the active window before physical provider input, while `window_title`/`window_pid`/`window_active_confirmed` are fallback paths. `physical_input_provider:"auto"` currently executes through `native-os` unless the guarded `ljq-ctrl` bridge is explicitly enabled and reports the requested action. Run `npm run check:native-pointer` first for a no-input click/drag readiness check; on macOS, if `cliclick` is installed but Accessibility is missing, the report includes `permission_recovery` with the System Settings path, a copyable `open` command, verification command, and explicit physical CAPTCHA gate command. Then run `npm run check:captcha-assist-physical-live` only as an optional local GUI gate; it skips unless `TMWD_CAPTCHA_ASSIST_PHYSICAL=1 TMWD_CAPTCHA_ASSIST_CONFIRM=1` are set and can be made fail-on-skip with `TMWD_CAPTCHA_ASSIST_REQUIRE_PHYSICAL=1`; skipped/blocked paths explicitly report `physical_input_executed:false` and `pointer_moved:false` plus `physical_gate_command`. The wrapper performs native pointer preflight before opening the GUI fixture or creating a managed tab, so missing click/drag requirements return structured skipped/blocked output without foregrounding Chrome or attempting physical input. When explicitly enabled, the local fixture gate may use bounded retry/tuning (`TMWD_CAPTCHA_ASSIST_MAX_ATTEMPTS`, `TMWD_CAPTCHA_ASSIST_PRE_INPUT_SETTLE_MS`, drag overshoot/offset env vars, or exact `TMWD_CAPTCHA_ASSIST_DRAG_FROM_X/Y` and `TMWD_CAPTCHA_ASSIST_DRAG_TO_X/Y` screen coordinates) while preserving the 5s wait and manual handoff boundaries; passing physical runs must report visible slider movement (`slider_visual_offset` / `handle_transform`) and checkbox inside-hotspot completion before writing sanitized repo-external proof JSON unless `TMWD_CAPTCHA_ASSIST_WRITE_PROOF=0` is set. Run `npm run check:ljqctrl` to diagnose the local Python `ljqCtrl` import and click/window-region capture capability without activating windows, clicking, dragging, taking screenshots, or touching clipboard; it reports a compact `python_candidates` matrix. `TMWD_LJQCTRL_PYTHON=/path/to/python` selects one explicit Python, and `TMWD_LJQCTRL_PYTHON_CANDIDATES` accepts a system path-delimited candidate list; `TMWD_LJQCTRL_EXECUTE=1` is required before the guarded bridge may call `ljqCtrl.Click` or clipped window-region capture artifact creation. Slider execution additionally requires destination screen coordinates (explicit, estimated, vision-corrected, or provider-corrected) and physical `drag` support; on macOS, `native-os` drag support requires `cliclick` plus Accessibility permission for the current terminal/Codex host. Do not keep trying selectors, unrelated profiles, cross-origin IdP actions, or repeated submits.
- GenericAgent's newer macOS `macljqCtrl` / AX control path is available only as audited reference material under `docs/upstream/genericagent/`; it is not the default execution provider. On macOS, `npm run check:ljqctrl -- --json` reports a `macljqctrl` diagnostic for `Quartz`, `AppKit`, `ApplicationServices`, `PIL`, `cv2`, `numpy`, and the `CropToScreen` physical-coordinate model. Keep using `native-os` by default unless a future guarded provider is explicitly enabled.
- For checkbox-style CAPTCHA, prefer `run_vision_correction:true` and `use_vision_corrected_coordinates:true`; the planner now returns `checkbox_click_hint` and a checkbox detector so clicks aim at the visible left-side checkbox hotspot, not the center of the whole Turnstile/hCaptcha widget.
- For near-100 maintenance work, run `npm run check:readiness` after `npm run check:change-set`. It is read-only and reports required governance status plus optional hardening gaps such as pending scoped commits, unconfigured or invalid `ljqCtrl`, skipped physical CAPTCHA gate, cross-OS native live proof, and provider-specific OAuth/SSO/MFA live gates. Its `ljqCtrl` row is platform-aware and uses the same diagnostic-only Python capability probe as `npm run check:ljqctrl`, not only environment-variable presence; the bundled GenericAgent `ljqCtrl` implementation is Windows-oriented, so default absence on non-Windows hosts is informational while explicit interpreter config is still validated. If macOS Accessibility blocks `cliclick`, affected readiness JSON gaps include the same structured `permission_recovery` plan as `npm run check:native-pointer -- --json`, and optional proof gaps include a compact `proof_plan` with the plan command, proof directory, and missing proof ids. An importable driver becomes informational and execution-gated until `TMWD_LJQCTRL_EXECUTE=1` is explicitly supplied. Run `npm run check:optional-live-proofs` to validate sanitized repo-external proof JSON from the local CAPTCHA physical gate, Linux/Windows native-input hosts, or approved external IdP providers; run `npm run plan:optional-live-proofs` for a no-input, no-browser proof collection runbook with accepted proof freshness, `next_command`, `collection_steps`, and audited `record_replace` commands; add `--id <proof-id>` to produce a single-proof handoff packet for one host/provider owner. Run `npm run proof:optional-live-status` for the operator checklist that groups accepted/missing proof, owner, next command, record/write/replace commands, validation command, optional `--id <proof-id>` filtering, and the no-fabricated-proof completion policy; use `npm run proof:optional-live-template` for safe `ok:false` starter templates and `npm run proof:optional-live-record -- --id <proof-id> --from-json <sanitized.json>` to dry-run validate a collected proof and print the redaction checklist before adding `--write` to persist it repo-externally. The record validator rejects obvious Bearer/JWT/cookie-like values and unredacted IdP tenant/account/provider identifiers. The local `check:auth-live` contract already proves manual CAPTCHA/MFA/SSO/OAuth-popup handoff and resume on TMWD-owned fixture tabs; remaining IdP gaps are about approved external provider coverage.
- Use `js-reverse` for page API/interface discovery, request initiator tracing,
  signatures, anti-bot parameters, hook sampling, and local rebuild bundles; it
  uses this same TMWD transport by default. Pages opened by `js-reverse new_page`
  are also TMWD-managed; run `js-reverse finalize_task` for the same
  `workspace_key` or `task_id` before final response unless evidence collection
  requires keeping the page open.
- Use `remote_cdp` only when the user explicitly wants a debug Chrome/CI/JS reverse protocol path.
- Validate that explicit path with `npm run check:remote-cdp`; set `CHROME_BIN`
  if Chrome is not installed in a default location.
- Do not silently fallback from TMWD login-state tasks to remote CDP.
- For localhost/file previews that do not need profile state, use in-app Browser instead.
- For desktop windows, native file chooser, or pure visual input, use Computer Use or TMWD native fallback.

## Important pitfalls

- After extension updates, reload the unpacked extension and refresh old tabs.
- If Chrome visibly shows `about:blank` but `tabs.list` does not, use `tabs.list` with `includeUnscriptable:true` or `tabs.get`; default tab lists intentionally hide non-HTTP(S) pages.
- For lifecycle regressions, run `npm run check:managed-tab-live`; it opens only temporary local fixture pages and closes the TMWD-owned tabs it creates.
- Before absorbing a newer GenericAgent checkout, run `npm run upstream:audit`, `npm run upstream:audit:latest`, or `npm run upstream:audit -- --source <GenericAgent/assets/tmwd_cdp_bridge> --json`; after audit tooling changes run `npm run check:upstream-audit` and `npm run check:upstream-review`. Do not blindly `extension:sync` when the audit reports `safe_to_direct_sync:false`; preserve local enhanced bridge features such as `handleTabs`, `tabs.get`, `tabs.close`, `includeUnscriptable`, and guarded numeric `tabId` validation.
- `UPSTREAM.review.json` records the latest reviewed remote-main drift separately from `UPSTREAM.lock.json` and is validated by `docs/schemas/upstream-review.schema.json`. If `upstream_review.status=stale` or `upstream_review.stale=true`, rerun `npm run upstream:audit:latest -- --json` and refresh the ledger only after a new manual review. If the reviewed commit still lacks local bridge capabilities, keep `safe_to_direct_sync:false` and cherry-pick only future useful hunks.
- After adding or changing wrapper tools, run `npm run check:mcp`; after changing task lifecycle, templates, or governance gates also run `npm run check:performance-smoke`, `npm run check:task-templates`, and `npm run check:regression-matrix`.
- For ad-hoc one-shot Node scripts that directly import `src/tmwd-runtime.mjs`, call `await disposeTmwdRuntime()` in `finally`; otherwise an open TMWD websocket can keep the shell process alive after the browser action has already succeeded.
- `await` in `browser_execute_js` must explicitly `return` to expose values.
- For CDP coordinate clicks, warm up debugger attachment before measuring coordinates.
- For real local file upload, prefer same-batch `DOM.getDocument -> DOM.querySelector -> DOM.setFileInputFiles`; DataTransfer is only suitable for in-memory files.
- `browser_download_ops` only observes the prepared token/directory window; do not read Chrome history DB.
- `browser_tab_lifecycle.close_unkept` must never close unmanaged existing user tabs; it only closes TMWD-owned managed tabs that are not marked `keep:true`.
- `browser_tab_lifecycle.finalize_task` is the normal finalizer for Codex tasks that used TMWD managed tabs. Run it before final response/handoff for the current `workspace_key` or `task_id`, and report whether tabs were closed or intentionally kept.
- `npm run check:managed-tabs-clean` is a registry-only hygiene gate for missed finalizers; run it after lifecycle changes or when diagnosing tab buildup. `npm run verify` snapshots a temporary managed-tab baseline first and fails only on newly leaked unkept records, while the standalone gate remains globally strict.
- `browser_tab_lifecycle` dry-runs are planning-only: do not depend on dry-run calls to select, persist, touch, or clean managed tabs.
- `browser_clipboard_ops` has no clipboard-read action by design.
- OpenAI tool registration rejects top-level JSON Schema composition keywords
  such as `anyOf`/`oneOf`; keep required alternates as runtime validation and
  rerun `npm run check:mcp` after schema edits.
- Codex MCP tool results must use standard MCP text content. Encode structured
  payloads as `type: "text"` with JSON text, not non-standard `type: "json"`;
  `npm run check:mcp` asserts this for representative success/error paths.
- If a Codex thread already captured an invalid MCP tool schema, fixing source
  files is not enough for that old thread; start a fresh thread or restart Codex
  so the Responses state is rebuilt from the current MCP `tools/list`.
