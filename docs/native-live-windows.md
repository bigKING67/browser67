# Windows GUI native live proof

`native-live-win32` must be collected on a real Windows graphical desktop. A
physical PC is not required; a Windows 10/11 VM is sufficient when it has an
interactive, unlocked desktop and a visible Chrome/Edge window.

## Recommended host

- Windows 10 or Windows 11 desktop, including a supported Windows 11 VM.
- Node.js 20 or 22, npm, Git, and Chrome or Edge.
- Windows PowerShell (`powershell`) or PowerShell 7 (`pwsh`) on `PATH`.
- The browser67 unpacked extension connected to the local hub.
- A live interactive login session. A locked desktop, service session, ordinary
  GitHub Actions runner, headless container, or WSL without a Windows desktop
  session does not qualify.

Parallels, VMware, Hyper-V, VirtualBox, or a cloud Windows VM with an active RDP
desktop can be used. Keep the RDP/console session connected and unlocked during
the physical gate; do not disconnect it into a non-interactive state. Run the
repository with native Windows Node/npm in PowerShell. WSL reports
`process.platform=linux` and cannot produce `native-live-win32`.

## 1. Prepare the repository and native provider

Run in PowerShell:

```powershell
git clone https://github.com/bigKING67/browser67.git
Set-Location browser67
npm ci

npm run native:doctor
Get-Command powershell -ErrorAction SilentlyContinue
Get-Command pwsh -ErrorAction SilentlyContinue
```

Windows PowerShell is normally built into Windows. If neither command is
available, install PowerShell 7 and reopen the terminal:

```powershell
winget install --id Microsoft.PowerShell -e
```

The native provider uses `System.Windows.Forms`, `System.Drawing`, and
`user32.dll` APIs such as `GetForegroundWindow`, `GetWindowRect`,
`SetForegroundWindow`, and `mouse_event`.

## 2. Install the extension and start the hub

```powershell
npm run setup
npm run hub:start
npm run extension:doctor
npm run doctor
```

Open `chrome://extensions` or `edge://extensions`, enable Developer Mode, and
load the unpacked extension directory printed by `npm run setup`. The canonical
default is:

```text
%USERPROFILE%\.browser67\browser\tmwd_cdp_bridge\
```

To print the resolved path in PowerShell:

```powershell
(Resolve-Path "$HOME\.browser67\browser\tmwd_cdp_bridge").Path
```

Reload the extension if `extension:doctor` reports
`needs_browser_extension_reload:true`, then verify the real browser transport:

```powershell
npm run check:live:doctor
```

## 3. Run no-input readiness checks

These commands do not move the mouse or create a browser tab:

```powershell
npm run check:native-pointer -- --json
npm run check:native-live -- --json
npm run plan:optional-live-proofs -- --id native-live-win32 --json
```

Expected native-live readiness status:

```text
ready_for_explicit_opt_in
```

Do not continue until native pointer readiness reports both click and drag as
available.

## 4. Run the explicit physical proof

The following commands explicitly authorize foreground activation and physical
mouse input. Keep the desktop unlocked, stop using the mouse, and make sure no
sensitive page is visible in front of the local fixture.

```powershell
$env:TMWD_NATIVE_LIVE_PHYSICAL = "1"
$env:TMWD_NATIVE_LIVE_CONFIRM = "1"
npm run proof:native-live -- --write --json
```

The gate:

1. creates browser67-owned local fixture tabs;
2. forces the `native-os` PowerShell provider;
3. verifies a positive-size native `GetWindowRect` result;
4. performs and visibly verifies a slider drag;
5. performs and verifies an inside-hotspot checkbox click;
6. finalizes only its managed fixture tabs; and
7. records sanitized proof through the existing optional-proof validator.

The canonical output file is:

```text
%USERPROFILE%\.browser67\optional-live-proofs\native-live-win32.json
```

The proof stores no screenshot, cookie, token, page content, window title, or
account data. It contains only the target platform, action/result booleans,
provider/driver class, timestamps, and safe-boundary assertions.

If an accepted proof already exists, the gate blocks before moving the pointer.
Use `--replace` only for an intentional refresh:

```powershell
npm run proof:native-live -- --write --replace --json
```

Clear the per-terminal opt-in variables after the run:

```powershell
Remove-Item Env:TMWD_NATIVE_LIVE_PHYSICAL -ErrorAction SilentlyContinue
Remove-Item Env:TMWD_NATIVE_LIVE_CONFIRM -ErrorAction SilentlyContinue
```

## 5. Validate and transfer the proof

Validate locally:

```powershell
npm run check:optional-live-proofs -- --json
npm run proof:optional-live-status -- --id native-live-win32 --json
```

Transfer only `native-live-win32.json` to the release workstation. Do not copy
the whole browser67 runtime directory, screenshots, profiles, logs, or browser
state. On the release workstation, run a dry validation before writing:

```powershell
npm run proof:optional-live-record -- `
  --id native-live-win32 `
  --from-json C:\path\to\native-live-win32.json

npm run proof:optional-live-record -- `
  --id native-live-win32 `
  --from-json C:\path\to\native-live-win32.json `
  --write
```

Add `--replace` only when deliberately replacing an older canonical proof.

## Troubleshooting

### PowerShell provider is unavailable

```powershell
npm run native:doctor
Get-Command powershell -ErrorAction SilentlyContinue
Get-Command pwsh -ErrorAction SilentlyContinue
```

Install PowerShell 7 with `winget` when neither executable is available.

### Hub or extension is disconnected

```powershell
npm run hub:status
npm run extension:doctor
npm run doctor:json
npm run check:live:doctor
```

Reload the unpacked extension and rerun the live doctor before retrying the
physical gate.

### `WINDOW_NOT_FOUND`, `GetWindowRect failed`, or visible completion fails

- Keep Chrome/Edge visible and allow it to come to the foreground.
- Keep the Windows desktop unlocked and the RDP/console session connected.
- Do not move the mouse during the gate.
- Retry only after checking the first failure; do not loop physical input.
- Run the terminal and browser in the same interactive user session.
