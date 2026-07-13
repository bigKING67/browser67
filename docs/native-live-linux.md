# Linux GUI native live proof

`native-live-linux` must be collected on a real Linux graphical desktop. A
physical Linux machine is not required; an Ubuntu Desktop VM is sufficient as
long as the session is interactive, unlocked, and can display and foreground a
real Chrome/Edge window.

## Recommended host

- Ubuntu Desktop 22.04 or 24.04.
- Xorg/X11 login session. A Wayland session is acceptable only when a working
  X11 `DISPLAY` bridge is present, but Xorg is the reproducible baseline.
- Node.js 20 or 22, npm, Git, and Chrome/Chromium/Edge.
- The browser67 unpacked extension connected to the local hub.
- A visible desktop session whose mouse can move. SSH-only VPS, headless Docker,
  ordinary GitHub Actions runners, and Wayland-only sessions without `DISPLAY`
  do not qualify.

Parallels, VMware, VirtualBox, a local KVM VM, or a cloud VM with a persistent
desktop/RDP/VNC session can be used. Keep the desktop session connected and
unlocked for the physical gate. Run Node/npm inside the Linux guest, not from
the macOS/Windows host controlling the VM.

## 1. Prepare the repository and native provider

```bash
git clone https://github.com/bigKING67/browser67.git
cd browser67
npm ci
```

Confirm the desktop backend before installing anything:

```bash
printf 'session=%s\nDISPLAY=%s\nWAYLAND_DISPLAY=%s\n' \
  "${XDG_SESSION_TYPE:-unknown}" \
  "${DISPLAY:-unset}" \
  "${WAYLAND_DISPLAY:-unset}"
```

For the standard proof host, `DISPLAY` must be non-empty. If the login screen
offers a session chooser, select an Xorg/X11 session before logging in.

Install browser67's Linux native dependencies:

```bash
npm run native:doctor
npm run native:setup
```

`native:setup` uses the detected package manager. On Ubuntu it installs
`xdotool` and `xclip` through `sudo apt-get`. If system package changes are
managed centrally, install those two packages through the normal administrator
workflow instead.

## 2. Install the extension and start the hub

```bash
npm run setup
npm run hub:start
npm run extension:doctor
npm run doctor
```

Open `chrome://extensions` or `edge://extensions`, enable Developer Mode, and
load the unpacked extension directory printed by `npm run setup`. The canonical
default is:

```text
~/.browser67/browser/tmwd_cdp_bridge/
```

Reload the extension if `extension:doctor` reports
`needs_browser_extension_reload:true`. The native live gate creates fresh local
managed fixture tabs, so their content scripts will be injected after reload.

Verify the real browser transport:

```bash
npm run check:live:doctor
```

## 3. Run no-input readiness checks

These commands do not move the mouse or create a browser tab:

```bash
npm run check:native-pointer -- --json
npm run check:native-live -- --json
npm run plan:optional-live-proofs -- --id native-live-linux --json
```

Expected native-live readiness status:

```text
ready_for_explicit_opt_in
```

Do not continue until native pointer readiness reports both click and drag as
available.

## 4. Run the explicit physical proof

The following command is intentionally explicit because it will foreground the
browser and move the system pointer. Keep the desktop unlocked, stop using the
mouse, and make sure no sensitive page is visible in front of the fixture.

```bash
TMWD_NATIVE_LIVE_PHYSICAL=1 \
TMWD_NATIVE_LIVE_CONFIRM=1 \
npm run proof:native-live -- --write --json
```

The gate:

1. creates browser67-owned local fixture tabs;
2. forces the `native-os` provider;
3. verifies a positive-size native `get_window_rect` result;
4. performs and visibly verifies a slider drag;
5. performs and verifies an inside-hotspot checkbox click;
6. finalizes only its managed fixture tabs; and
7. records sanitized proof through the existing optional-proof validator.

The canonical output file is:

```text
~/.browser67/optional-live-proofs/native-live-linux.json
```

The proof stores no screenshot, cookie, token, page content, window title, or
account data. It contains only the target platform, action/result booleans,
provider/driver class, timestamps, and safe-boundary assertions.

If an accepted proof already exists, the gate blocks before moving the pointer.
Use `--replace` only for an intentional refresh:

```bash
TMWD_NATIVE_LIVE_PHYSICAL=1 \
TMWD_NATIVE_LIVE_CONFIRM=1 \
npm run proof:native-live -- --write --replace --json
```

## 5. Validate and transfer the proof

Validate locally:

```bash
npm run check:optional-live-proofs -- --json
npm run proof:optional-live-status -- --id native-live-linux --json
```

Transfer only `native-live-linux.json` to the release workstation. Do not copy
the whole browser67 runtime directory, screenshots, profiles, logs, or browser
state. On the release workstation, run a dry validation before writing:

```bash
npm run proof:optional-live-record -- \
  --id native-live-linux \
  --from-json /path/to/native-live-linux.json

npm run proof:optional-live-record -- \
  --id native-live-linux \
  --from-json /path/to/native-live-linux.json \
  --write
```

Add `--replace` only when deliberately replacing an older canonical proof.

## Troubleshooting

### `DISPLAY_BACKEND_UNSUPPORTED`

- Confirm `DISPLAY` is non-empty in the same terminal that runs browser67.
- Log out and select an Xorg/X11 desktop session.
- Do not manufacture a fake `DISPLAY`; it must refer to the active desktop.

### `xdotool is required` or pointer readiness is blocked

```bash
command -v xdotool
command -v xclip
npm run native:doctor
npm run check:native-pointer -- --json
```

Install the missing packages through `npm run native:setup` or the host's normal
package-management process.

### Hub or extension is disconnected

```bash
npm run hub:status
npm run extension:doctor
npm run doctor:json
npm run check:live:doctor
```

Reload the unpacked extension and rerun the live doctor before retrying the
physical gate.

### Window lookup or visible completion fails

- Keep Chrome/Edge visible, unlocked, and allowed to come to the foreground.
- Do not move the mouse during the gate.
- Retry only after checking the first failure; do not loop physical input.
- If using VNC/RDP, keep the interactive desktop connected for the entire run.
