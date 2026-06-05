# Third-party notices

## GenericAgent / TMWebDriver extension

This project vendors the Chrome/Edge unpacked extension source in `extension/`.
The extension is derived from:

- Project: `lsdefine/GenericAgent`
- Repository: `https://github.com/lsdefine/GenericAgent.git`
- Upstream extension path: `assets/tmwd_cdp_bridge`
- License: MIT

`UPSTREAM.lock.json` records the upstream commit and file hashes used for the
vendored extension snapshot. Refresh that lock only after intentionally syncing
from GenericAgent.

The upstream MIT license text is compatible with this repository's MIT license.
Keep upstream attribution and the vendored hash lock when redistributing this
project.

## npm dependencies

Runtime npm dependencies are listed in `package.json` and locked in
`package-lock.json`. As of this release, the direct runtime dependency is:

- `ws` under the MIT license
