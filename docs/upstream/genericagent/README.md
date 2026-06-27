# GenericAgent upstream reference

This directory keeps audited upstream material that is useful for strengthening
`tmwd-browser-mcp` without replacing the local architecture.

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
npm run upstream:audit -- --source /path/to/GenericAgent/assets/tmwd_cdp_bridge --json
```
