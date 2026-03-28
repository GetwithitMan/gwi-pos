#!/usr/bin/env bash
# =============================================================================
# check-forbidden-domains.sh — CI gate: no POS asset URLs pointing to MC domain
# =============================================================================
# Fails if any POS asset/installer/deploy code references app.thepasspos.com
# for downloading POS assets. MC API calls to app.thepasspos.com are allowed
# (register, heartbeat, fleet commands) — only POS asset downloads are banned.
#
# Domain rules:
#   ordercontrolcenter.com — POS assets (installer, dashboard, manifests, schema)
#   app.thepasspos.com     — MC API only (register, heartbeat, fleet commands)
#
# Usage:
#   bash scripts/ci/check-forbidden-domains.sh
# =============================================================================
set -euo pipefail

echo "=== Forbidden Domain Check ==="

# Files to check — POS asset/installer/deploy code
CHECK_PATHS=(
    "public/installer-modules/"
    "public/scripts/"
    "public/installer.run"
    "public/install.sh"
    "public/setup-remote.sh"
    "public/uninstall.sh"
    "public/usb-remote-setup.sh"
    "public/usb-setup-remote.desktop"
    "scripts/build-nuc-artifact.sh"
    "deploy-tools/"
    "src/lib/update-agent.ts"
)

# Allowed patterns — MC API calls that legitimately use app.thepasspos.com
ALLOWED_PATTERNS=(
    "MC_URL="
    "mc_url="
    "api/fleet/"
    "api/admin/"
    "api/internal/"
    "/heartbeat"
    "mc.getwithitpos.com"
)

VIOLATIONS=0
VIOLATION_LIST=""

for check_path in "${CHECK_PATHS[@]}"; do
    [[ -e "$check_path" ]] || continue

    # Find all app.thepasspos.com references
    matches=$(grep -rn "app\.thepasspos\.com" "$check_path" 2>/dev/null || true)
    [[ -z "$matches" ]] && continue

    # Filter out allowed patterns
    while IFS= read -r line; do
        is_allowed=false
        for pattern in "${ALLOWED_PATTERNS[@]}"; do
            if echo "$line" | grep -q "$pattern"; then
                is_allowed=true
                break
            fi
        done
        if [[ "$is_allowed" == "false" ]]; then
            VIOLATIONS=$((VIOLATIONS + 1))
            VIOLATION_LIST="${VIOLATION_LIST}${line}\n"
        fi
    done <<< "$matches"
done

# Also check the installer orchestrator for POS_BASE_URL pointing to MC
installer_pos_base=$(grep -n "POS_BASE_URL.*app\.thepasspos\.com" public/installer.run 2>/dev/null || true)
if [[ -n "$installer_pos_base" ]]; then
    VIOLATIONS=$((VIOLATIONS + 1))
    VIOLATION_LIST="${VIOLATION_LIST}public/installer.run: POS_BASE_URL defaults to app.thepasspos.com\n"
fi

if [[ $VIOLATIONS -gt 0 ]]; then
    echo ""
    echo "FAIL: Found $VIOLATIONS POS asset reference(s) using the MC domain (app.thepasspos.com)"
    echo ""
    echo "Violations:"
    echo -e "$VIOLATION_LIST" | sed 's/^/  /'
    echo ""
    echo "POS assets MUST use ordercontrolcenter.com (the POS Vercel deployment)."
    echo "app.thepasspos.com is the MC domain — only allowed for MC API calls."
    exit 1
fi

echo "No forbidden domain references found — PASS"
exit 0
