#!/usr/bin/env bash
# =============================================================================
# deploy-release.sh — DEPRECATED since v2.0.0
# =============================================================================
# gwi-node.sh is the canonical deploy agent. This script is a thin wrapper
# that delegates to gwi-node deploy. All original logic has been removed.
#
# The canonical deploy agent is: /opt/gwi-pos/gwi-node.sh
#   gwi-node deploy | rollback | converge | status
# =============================================================================

set -euo pipefail

echo "WARNING: deploy-release.sh is deprecated. Use gwi-node.sh instead." >&2

GWI_NODE="/opt/gwi-pos/gwi-node.sh"

if [[ -x "$GWI_NODE" ]]; then
  exec "$GWI_NODE" deploy "$@"
fi

echo "FATAL: gwi-node.sh not found at $GWI_NODE — cannot deploy." >&2
echo "Install gwi-node.sh (v2.0.0+) and retry." >&2
exit 1
