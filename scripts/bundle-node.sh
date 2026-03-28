#!/usr/bin/env bash
# Download and cache Node.js binary for pre-staged installer bundling
set -euo pipefail

NODE_VERSION="${1:-22.14.0}"
NODE_ARCH="${2:-linux-x64}"
CACHE_DIR="${HOME}/.cache/gwi-pos-build"
NODE_URL="https://nodejs.org/dist/v${NODE_VERSION}/node-v${NODE_VERSION}-${NODE_ARCH}.tar.gz"
OUTPUT="$CACHE_DIR/node-v${NODE_VERSION}-${NODE_ARCH}.tar.gz"

mkdir -p "$CACHE_DIR"

if [[ -f "$OUTPUT" ]]; then
  echo "Node.js ${NODE_VERSION} already cached at $OUTPUT"
else
  echo "Downloading Node.js ${NODE_VERSION} for ${NODE_ARCH}..."
  curl -fsSL "$NODE_URL" -o "$OUTPUT"
  echo "Cached at $OUTPUT"
fi

echo "$OUTPUT"
