# Browser67 Auth and Native Input

Read before SSO/auth handoffs, CAPTCHA assistance, or physical/native input.
Use the exact managed target and existing host authorization; ordinary page
reading does not activate these procedures.

## Target and SSO handling

- For explicitly confirmed physical CAPTCHA assist on macOS, require the
   exact managed Chrome/Edge tab id before `cliclick`, with its redacted URL only
   as a fallback. Use logical screen-point window bounds, prefer a detected
   slider track over the handle-only rect, and keep CAPTCHA screenshots
   region-bounded.
- Treat provider `[role="button"]` controls and same-tab existing-account,
   authorize, or consent pages as SSO handoffs. Require explicit popup evidence
   before using `manual_context.kind:"oauth_popup"`. For JS clicks that may open
   a delayed provider window, rely on the bounded default new-target poll or set
   `new_tab_wait_ms`; `no_monitor:true` intentionally disables that poll.

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
