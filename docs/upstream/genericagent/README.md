# GenericAgent upstream reference

This directory keeps audited upstream material that is useful for strengthening
browser67 without replacing the local architecture.

## Source

- Upstream repo: `https://github.com/lsdefine/GenericAgent`
- Audited commit: `c25ea7c15c4b3f217318a1d86a7ee097dfbb5085`
- Upstream release context: `desktop-portable-v0.1.4`
- Imported reference path: `memory/macljqCtrl.py`

## Local policy

- Reference files here are provenance material and design input, not default
  production execution paths.
- Do not direct-sync upstream `assets/tmwd_cdp_bridge` over local `extension/`
  without `npm run upstream:audit` and manual review. The local bridge currently
  owns stronger managed-tab capabilities such as `tabs.get`, `tabs.close`, and
  `includeUnscriptable`.
- `UPSTREAM.review.json` records the latest manually reviewed upstream commit
  and the decision to keep local bridge behavior while treating upstream
  `macljqCtrl` / AX work as reference material. `UPSTREAM.lock.json` remains the
  extension sync baseline until an intentional extension sync is performed.
- macOS AX / `macljqCtrl` concepts may be promoted later as a guarded optional
  provider, but the default macOS physical-input provider remains `native-os`
  (`osascript` + `cliclick`).
- CAPTCHA boundaries remain unchanged: no fullscreen screenshots, no token or
  cookie extraction, no JS/CDP CAPTCHA clicking, and no unmanaged user-tab
  takeover.

## Useful upstream ideas absorbed locally

- `CropToScreen(bbox, x, y)` for converting clipped-region image coordinates
  back to absolute physical screen pixels.
- `AXElements` / `AXFind` / `AXPress` / `AXClick` as a future optional path for
  ordinary desktop/UI controls where accessibility APIs are more stable than
  image matching.
- Windows `ljqCtrl` DPI and click-check lessons: make the process DPI-aware,
  use raw `FindBlock` score, and stop when click pixel-change is near zero
  instead of blind retrying.

Run the local audit entrypoint before future upstream absorption work:

```bash
npm run upstream:audit
npm run check:upstream-audit
npm run check:upstream-review
npm run upstream:audit:latest
npm run upstream:audit -- --source /path/to/GenericAgent/assets/tmwd_cdp_bridge --json
```

`upstream:audit` reports `extension_review.recommended_merge_mode` and per-file
`recommended_action` rows. Treat `manual_merge_preserve_local_bridge_features`
as a hard stop for blind sync: merge only the useful upstream hunks and preserve
local bridge capabilities such as `handleTabs`, `tabs.get`, `tabs.close`, and
`includeUnscriptable`, plus guarded numeric `tabId` validation on cookies, CDP,
batch, and WebSocket exec paths. Formatting-only differences such as final
newline changes are reported as `keep_local_no_behavior_change`. JSON output
also includes `checked_source`, `source_checkout_matches_locked_commit`, and
`source_checkout_matches_remote_main` so callers can tell whether the audit used
the stale local checkout, an explicit source, or a latest-temp upstream clone.
When the latest remote commit matches `UPSTREAM.review.json`, audit output also
sets `upstream_review.remote_main_reviewed=true` and avoids treating the same
reviewed drift as a new pending absorption item. The same output now includes
`upstream_review.status`, `upstream_review.stale`, and
`upstream_review.next_command`; `status=stale` means remote `main` no longer
matches `upstream.reviewed_commit` and the ledger must be updated only after a
fresh manual review. `npm run check:upstream-review` validates
`UPSTREAM.review.json` against `docs/schemas/upstream-review.schema.json` and
asserts the reviewed files plus required local bridge preserve-feature ids.
