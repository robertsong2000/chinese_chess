#!/usr/bin/env bash
# Download Pikafish WASM build into this directory.
#
# Usage:
#   ./download-pikafish.sh                # default source: pikafish-vue
#   ./download-pikafish.sh pikafish-vue   # explicit
#   ./download-pikafish.sh local-build    # skip download, expect files placed manually
#
# Exit codes:
#   0  success
#   1  unknown source
#   2  download failed (network / HTTP)
#   3  size mismatch (file truncated or wrong artifact)

set -euo pipefail

SOURCE="${1:-pikafish-vue}"
DIR="$(cd "$(dirname "$0")" && pwd)"

case "$SOURCE" in
  pikafish-vue)
    BASE="https://raw.githubusercontent.com/rtrtsdfsdf/pikafish-vue/main/public/engine"
    declare -A SIZES=( ["pikafish.js"]=37842 ["pikafish.wasm"]=701758 )
    ;;
  local-build)
    echo "[download-pikafish.sh] local-build: skipping network, expecting files in $DIR"
    if [[ ! -f "$DIR/pikafish.js" || ! -f "$DIR/pikafish.wasm" ]]; then
      echo "[download-pikafish.sh] ERROR: pikafish.js and pikafish.wasm must be placed manually" >&2
      exit 3
    fi
    exit 0
    ;;
  *)
    echo "[download-pikafish.sh] ERROR: unknown source '$SOURCE'" >&2
    echo "  available: pikafish-vue, local-build" >&2
    exit 1
    ;;
esac

for f in pikafish.js pikafish.wasm; do
  url="$BASE/$f"
  tmp="$DIR/$f.tmp"
  echo "[download-pikafish.sh] fetching $url"
  if ! curl -sSL --fail --retry 3 --retry-delay 1 -o "$tmp" "$url"; then
    echo "[download-pikafish.sh] ERROR: curl failed for $url" >&2
    rm -f "$tmp"
    exit 2
  fi
  actual=$(stat -c %s "$tmp" 2>/dev/null || stat -f %z "$tmp")
  expected=${SIZES[$f]}
  if [[ "$actual" != "$expected" ]]; then
    echo "[download-pikafish.sh] ERROR: $f size $actual != expected $expected" >&2
    rm -f "$tmp"
    exit 3
  fi
  mv "$tmp" "$DIR/$f"
  echo "[download-pikafish.sh] $f OK ($actual bytes)"
done

echo "[download-pikafish.sh] done."
