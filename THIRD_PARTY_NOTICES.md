# Third-party notices

## GenericAgent / TMWebDriver extension

This project vendors the Chrome/Edge unpacked extension source in `extension/`.
The extension is derived from:

- Project: `lsdefine/GenericAgent`
- Repository: `https://github.com/lsdefine/GenericAgent.git`
- Upstream extension path: `assets/tmwd_cdp_bridge`
- License: MIT
- Copyright: `Copyright (c) 2025 lsdefine`

`UPSTREAM.lock.json` records the upstream commit and file hashes used for the
vendored extension snapshot. Refresh that lock only after intentionally syncing
from GenericAgent.

Keep this attribution, the following upstream license text, and the vendored
hash lock when redistributing browser67 or its extension snapshot.

### GenericAgent MIT license

```text
MIT License

Copyright (c) 2025 lsdefine

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

## npm dependencies

Runtime npm dependencies are listed in `package.json` and locked in
`package-lock.json`. As of this release, the direct runtime dependency is:

- `ws` under the MIT license
