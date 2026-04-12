#!/usr/bin/env bash
# =============================================================================
# GWI POS — Promote Standby to Primary
# =============================================================================
# DEPRECATED — gwi-node.sh is the canonical lifecycle agent since v2.0.0.
# This script delegates to gwi-node promote. If gwi-node.sh does not exist,
# it exits with an error.
#
# Deployed to: /opt/gwi-pos/scripts/promote.sh
# =============================================================================

set -euo pipefail

GWI_NODE="/opt/gwi-pos/gwi-node.sh"

if [[ -x "$GWI_NODE" ]]; then
  echo "WARNING: promote.sh is deprecated. Delegating to gwi-node.sh promote." >&2
  exec "$GWI_NODE" promote "$@"
fi

echo "FATAL: gwi-node.sh not found at $GWI_NODE — cannot promote." >&2
echo "Install gwi-node.sh (v2.0.0+) and retry." >&2
exit 1
