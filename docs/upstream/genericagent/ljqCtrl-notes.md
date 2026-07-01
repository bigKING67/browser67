# GenericAgent ljqCtrl notes absorbed locally

Source: `lsdefine/GenericAgent@c25ea7c15c4b3f217318a1d86a7ee097dfbb5085`

These notes summarize the parts of upstream `memory/ljqCtrl.py`,
`memory/ljqCtrl_sop.md`, and `memory/computer_use.md` that are useful for this
project's TMWD/native-input layer.

## Windows DPI and visual matching

- Call `SetProcessDPIAware()` before reading window/client rectangles. Without
  it, Win32 APIs may return logical coordinates while screenshots and physical
  input use physical pixels.
- Treat `FindBlock` as a scored visual signal. Preserve the raw match score
  (`max_val`) in diagnostics if this project later promotes template matching
  into a provider result schema.
- After physical click, compare a small bounded region before/after the click.
  Near-zero pixel change is a coordinate bug signal; stop and diagnose instead
  of blind retrying.

## macOS coordinate discipline

- Upstream `macljqCtrl.py` mirrors Windows `ljqCtrl` with physical screen-pixel
  APIs.
- `screencapture -R` accepts logical points, while returned images are physical
  pixels. The reference implementation wraps this so callers keep physical
  coordinates at the public API boundary.
- When an image detector finds a point inside a clipped screenshot, convert back
  with `CropToScreen(bbox, x, y)`: add the crop origin and do not rescale.

## macOS AX control tree

- Prefer accessibility elements for ordinary desktop UI controls when available:
  `AXElements(target)` -> filter with `AXFind(...)` -> press with `AXPress` or
  `AXClick`.
- AX `Press` is element-based and avoids coordinate conversion. Physical
  fallback still needs screen-pixel coordinates and click-change verification.
- AX element references can go stale after windows are rebuilt. Enumerate close
  to the action rather than caching long-lived raw AX elements.

## Local boundary

- This repo currently treats macOS AX as reference/diagnostic only. The default
  macOS input path remains `native-os`.
- Do not use AX or image matching to bypass TMWD CAPTCHA policy. Visible CAPTCHA
  assist remains browser67-owned tab, bounded region, explicit confirmation, and
  physical input only.
