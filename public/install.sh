#!/usr/bin/env bash
# GWI POS Installer — one-line bootstrap
# Usage: curl -fsSL https://ordercontrolcenter.com/install | sudo bash
set -euo pipefail

TMPDIR=$(mktemp -d)
trap 'rm -rf "$TMPDIR"' EXIT

echo "Downloading GWI POS installer..."
curl -fsSL https://ordercontrolcenter.com/installer.run -o "$TMPDIR/installer.run"
chmod +x "$TMPDIR/installer.run"

exec "$TMPDIR/installer.run" "$@"
