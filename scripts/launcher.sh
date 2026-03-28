#!/usr/bin/env bash
# GWI POS Launcher — called by systemd ExecStart
# Lives inside each release at /opt/gwi-pos/releases/{releaseId}/launcher.sh
# Decoupled from layout: systemd points to /opt/gwi-pos/current/launcher.sh
set -euo pipefail

export NODE_ENV=production

# Resolve real path (follows current → releases/X symlink)
SCRIPT_DIR="$(cd "$(dirname "$(readlink -f "$0")")" && pwd)"
cd "$SCRIPT_DIR"

# Validate critical files exist
for f in server.js preload.js; do
    if [ ! -f "$f" ]; then
        echo "FATAL: $SCRIPT_DIR/$f not found — release may be incomplete" >&2
        exit 1
    fi
done

# Validate .env symlink exists (wired by deploy-release.sh)
if [ ! -e .env ]; then
    echo "FATAL: .env not found in $SCRIPT_DIR — shared symlinks may not be wired" >&2
    exit 1
fi

exec node -r ./preload.js server.js
