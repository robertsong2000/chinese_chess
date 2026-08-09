# Pikafish WASM Vendor Notice

This directory holds the Pikafish engine compiled to WebAssembly, used by
chinese_chess v2 to provide grandmaster-level (Elo 2600+) play.

## Status

**Files `pikafish.js` and `pikafish.wasm` are NOT committed** — they must be
obtained by running `./download-pikafish.sh` (see below). They are ignored by
`.gitignore` until the project decides on a long-term distribution source.

## Why not bundled

The official Pikafish project (`Official-Pikafish/Pikafish`) does not publish a
WebAssembly build in its releases — only native binaries for Windows / Linux /
macOS. A WASM build requires an Emscripten toolchain and is currently produced
by community forks. The cron-driven dev agent was not authorized to download
binaries from unverified community forks, so the wrapper architecture is
shipped first and the binary is plugged in by the user after review.

## Source options (pick one, then run `download-pikafish.sh <source>`)

| Source ID | Repo | Notes |
|-----------|------|-------|
| `official-native` | `Official-Pikafish/Pikafish` | Native binary only (no WASM). Used for headless test fixtures, not the browser. |
| `pikafish-vue` | `rtrtsdfsdf/pikafish-vue` | Pre-built `pikafish.js` (37 KB) + `pikafish.wasm` (701 KB) under `public/engine/`. Single-threaded. |
| `xiangqiai-com` | `xiangqiai.com` assets | Used by the official pikafish web UI; binary URLs are not public. |
| `local-build` | user-supplied | Place the two files in this directory manually. |

`download-pikafish.sh pikafish-vue` is the current default because it is a
plain `curl` from a public GitHub raw URL with a verifiable file size.

## License

Pikafish is licensed under the GNU General Public License v3. The compiled
WASM/JS artifacts inherit that license. Redistribution terms for combined
works (this project + Pikafish) must respect GPLv3 — see
https://www.gnu.org/licenses/gpl-3.0.html and `../../LICENSE` for the
project-level notice.

## Verification

After running the download script:

```bash
ls -la vendor/pikafish/
# Expect: pikafish.js (~37 KB), pikafish.wasm (~700 KB-5 MB), NOTICE.md, download-pikafish.sh

head -c 200 vendor/pikafish/pikafish.js   # should start with: var Pikafish = (() => {
file vendor/pikafish/pikafish.wasm         # should report: WebAssembly (wasm) binary module
```
