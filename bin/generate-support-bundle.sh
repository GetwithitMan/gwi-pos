#!/usr/bin/env bash
# generate-support-bundle.sh — Package diagnostics into a support tarball
# Part of the GWI POS Node Baseline Enforcement System
# Installed to /opt/gwi-pos/bin/generate-support-bundle.sh
#
# Usage: sudo ./generate-support-bundle.sh
# Output: /opt/gwi-pos/support-bundle-YYYYMMDD-HHMMSS.tar.gz

set -euo pipefail

readonly TOOL_VERSION="1.0.0"
readonly BASE_DIR="/opt/gwi-pos"
readonly STATE_DIR="${BASE_DIR}/state"
readonly ENV_FILE="${BASE_DIR}/.env"
readonly BUNDLE_TIMESTAMP=$(date +%Y%m%d-%H%M%S)
readonly BUNDLE_NAME="support-bundle-${BUNDLE_TIMESTAMP}"
readonly BUNDLE_OUTPUT="${BASE_DIR}/${BUNDLE_NAME}.tar.gz"
readonly JOURNAL_LINE_LIMIT=10000

# --- Read node identity ---

NODE_ID="unknown"
if [[ -f "$ENV_FILE" ]]; then
    NODE_ID=$(grep -E '^SERVER_NODE_ID=' "$ENV_FILE" | cut -d'=' -f2- | tr -d '"' | tr -d "'" || echo "unknown")
fi

HOST_BOOT_ID="unknown"
if [[ -f /proc/sys/kernel/random/boot_id ]]; then
    HOST_BOOT_ID=$(cat /proc/sys/kernel/random/boot_id)
fi

# --- Create temp dir for bundle assembly ---

BUNDLE_TMP=$(mktemp -d "/tmp/${BUNDLE_NAME}.XXXXXX")
trap 'rm -rf "$BUNDLE_TMP"' EXIT

BUNDLE_ROOT="${BUNDLE_TMP}/${BUNDLE_NAME}"
mkdir -p "${BUNDLE_ROOT}/state" "${BUNDLE_ROOT}/logs" "${BUNDLE_ROOT}/system"

# --- Track included files and truncated logs ---

declare -a INCLUDED_FILES=()
declare -a TRUNCATED_LOGS=()

# Helper: copy file and track it
copy_file() {
    local src="$1"
    local dest="$2"
    local label="$3"
    if [[ -f "$src" ]]; then
        cp "$src" "$dest"
        INCLUDED_FILES+=("$label")
        return 0
    fi
    return 1
}

# Helper: capture command output to file
capture_cmd() {
    local dest="$1"
    local label="$2"
    shift 2
    if "$@" > "$dest" 2>/dev/null; then
        INCLUDED_FILES+=("$label")
    else
        # Still include partial output if any was written
        if [[ -s "$dest" ]]; then
            INCLUDED_FILES+=("$label")
        fi
    fi
}

# --- Copy state JSON files ---

echo "Collecting state files..."
if [[ -d "$STATE_DIR" ]]; then
    for json_file in "${STATE_DIR}"/*.json; do
        if [[ -f "$json_file" ]]; then
            basename_file=$(basename "$json_file")
            cp "$json_file" "${BUNDLE_ROOT}/state/${basename_file}"
            INCLUDED_FILES+=("state/${basename_file}")
        fi
    done
fi

# --- Copy Ansible artifacts if they exist ---

copy_file "${STATE_DIR}/ansible-result.json" "${BUNDLE_ROOT}/state/ansible-result.json" "state/ansible-result.json" || true
copy_file "${STATE_DIR}/ansible-stderr.log" "${BUNDLE_ROOT}/state/ansible-stderr.log" "state/ansible-stderr.log" || true

# --- Capture journal logs (truncated to limit) ---

echo "Capturing journal logs..."

journalctl -u thepasspos --since "24 hours ago" --no-pager 2>/dev/null \
    | head -${JOURNAL_LINE_LIMIT} \
    > "${BUNDLE_ROOT}/logs/thepasspos.journal" || true
if [[ -s "${BUNDLE_ROOT}/logs/thepasspos.journal" ]]; then
    INCLUDED_FILES+=("logs/thepasspos.journal")
    line_count=$(wc -l < "${BUNDLE_ROOT}/logs/thepasspos.journal" || echo "0")
    if [[ "$line_count" -ge "$JOURNAL_LINE_LIMIT" ]]; then
        TRUNCATED_LOGS+=("thepasspos.journal")
    fi
fi

journalctl -u thepasspos-kiosk --since "24 hours ago" --no-pager 2>/dev/null \
    | head -${JOURNAL_LINE_LIMIT} \
    > "${BUNDLE_ROOT}/logs/thepasspos-kiosk.journal" || true
if [[ -s "${BUNDLE_ROOT}/logs/thepasspos-kiosk.journal" ]]; then
    INCLUDED_FILES+=("logs/thepasspos-kiosk.journal")
    line_count=$(wc -l < "${BUNDLE_ROOT}/logs/thepasspos-kiosk.journal" || echo "0")
    if [[ "$line_count" -ge "$JOURNAL_LINE_LIMIT" ]]; then
        TRUNCATED_LOGS+=("thepasspos-kiosk.journal")
    fi
fi

# --- Capture system diagnostics ---

echo "Capturing system diagnostics..."

capture_cmd "${BUNDLE_ROOT}/system/services-running.txt" "system/services-running.txt" \
    systemctl list-units --type=service --state=running --no-pager

capture_cmd "${BUNDLE_ROOT}/system/ufw-status.txt" "system/ufw-status.txt" \
    ufw status verbose

capture_cmd "${BUNDLE_ROOT}/system/chronyc-tracking.txt" "system/chronyc-tracking.txt" \
    chronyc tracking

# lsusb -v can be noisy; capture what we can
lsusb -v 2>/dev/null > "${BUNDLE_ROOT}/system/lsusb.txt" || true
if [[ -s "${BUNDLE_ROOT}/system/lsusb.txt" ]]; then
    INCLUDED_FILES+=("system/lsusb.txt")
fi

capture_cmd "${BUNDLE_ROOT}/system/lsblk.txt" "system/lsblk.txt" \
    lsblk -f

dmesg 2>/dev/null | tail -200 > "${BUNDLE_ROOT}/system/dmesg-tail.txt" || true
if [[ -s "${BUNDLE_ROOT}/system/dmesg-tail.txt" ]]; then
    INCLUDED_FILES+=("system/dmesg-tail.txt")
fi

capture_cmd "${BUNDLE_ROOT}/system/ip-addr.txt" "system/ip-addr.txt" \
    ip addr

# --- Copy .env with secrets redacted ---

echo "Redacting .env..."
if [[ -f "$ENV_FILE" ]]; then
    # Redact values for keys matching sensitive patterns
    # Pattern: any key containing SECRET, TOKEN, PASSWORD, PRIVATE, KEY, or API_KEY
    # Replace the value (everything after =) with [REDACTED]
    sed -E 's/^([^#]*_(SECRET|TOKEN|PASSWORD|PRIVATE|KEY|API_KEY)[^=]*)=.*/\1=[REDACTED]/I; s/^((SECRET|TOKEN|PASSWORD|PRIVATE|KEY|API_KEY)[^=]*)=.*/\1=[REDACTED]/I' \
        "$ENV_FILE" > "${BUNDLE_ROOT}/env-redacted.txt"
    INCLUDED_FILES+=("env-redacted.txt")
fi

# --- Generate bundle manifest ---

echo "Generating bundle manifest..."

# Build JSON arrays for included_files and truncated_logs
included_json="["
first=true
for f in "${INCLUDED_FILES[@]}"; do
    if [[ "$first" == true ]]; then
        first=false
    else
        included_json+=","
    fi
    included_json+="\"$f\""
done
included_json+="]"

truncated_json="["
first=true
for f in "${TRUNCATED_LOGS[@]}"; do
    if [[ "$first" == true ]]; then
        first=false
    else
        truncated_json+=","
    fi
    truncated_json+="\"$f\""
done
truncated_json+="]"

cat > "${BUNDLE_ROOT}/bundle-manifest.json" <<MANIFEST_EOF
{
  "schema_version": "1.0",
  "created_at": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
  "node_id": "${NODE_ID}",
  "host_boot_id": "${HOST_BOOT_ID}",
  "redaction_applied": true,
  "included_files": ${included_json},
  "truncated_logs": ${truncated_json},
  "tool_version": "${TOOL_VERSION}"
}
MANIFEST_EOF

# --- Create tarball ---

echo "Creating support bundle..."
tar czf "$BUNDLE_OUTPUT" -C "$BUNDLE_TMP" "$BUNDLE_NAME"

echo ""
echo "Support bundle created: ${BUNDLE_OUTPUT}"
echo "  Files included: ${#INCLUDED_FILES[@]}"
echo "  Truncated logs: ${#TRUNCATED_LOGS[@]}"
echo "  Size: $(du -h "$BUNDLE_OUTPUT" | cut -f1)"
