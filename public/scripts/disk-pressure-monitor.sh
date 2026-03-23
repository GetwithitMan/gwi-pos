#!/usr/bin/env bash
# GWI POS Disk Pressure Monitor
# Called by watchdog or cron. Checks disk, cleans if needed, writes alert state.
set -euo pipefail

STATE_DIR="/opt/gwi-pos/state"
ALERT_THRESHOLD_PERCENT=90  # Alert when >90% used
CLEANUP_THRESHOLD_PERCENT=85  # Start cleanup at >85% used
LOG_DIR="/opt/gwi-pos/logs"

log() { echo "[$(date -u +%FT%TZ)] DISK-MONITOR: $*"; }

get_disk_usage_percent() {
  df /opt/gwi-pos 2>/dev/null | awk 'NR==2 {gsub(/%/,""); print $5}'
}

get_disk_free_gb() {
  df -BG /opt/gwi-pos 2>/dev/null | awk 'NR==2 {gsub(/G/,""); print $4}'
}

get_disk_total_gb() {
  df -BG /opt/gwi-pos 2>/dev/null | awk 'NR==2 {gsub(/G/,""); print $2}'
}

cleanup_old_builds() {
  log "Cleaning old .next builds..."
  # Remove old .next directories (keep current)
  find /opt/gwi-pos -maxdepth 3 -name ".next" -type d -not -path "*/app/.next" -mtime +7 -exec rm -rf {} + 2>/dev/null || true
  # Remove app-previous if exists and old
  if [[ -d /opt/gwi-pos/app-previous ]]; then
    local age_hours
    age_hours=$(( ($(date +%s) - $(stat -c %Y /opt/gwi-pos/app-previous 2>/dev/null || echo "0")) / 3600 ))
    if [[ $age_hours -gt 2 ]]; then
      rm -rf /opt/gwi-pos/app-previous
      log "Removed app-previous (${age_hours}h old)"
    fi
  fi
}

cleanup_npm_cache() {
  log "Cleaning npm cache..."
  npm cache clean --force 2>/dev/null || true
}

cleanup_logs() {
  log "Rotating old logs..."
  # Truncate large log files
  find "$LOG_DIR" -name "*.log" -size +100M -exec truncate -s 50M {} \; 2>/dev/null || true
  # Remove old diagnostic dumps
  find /opt/gwi-pos/logs/watchdog-diagnostics -name "diag-*.txt" -mtime +7 -delete 2>/dev/null || true
  # Vacuum journal
  journalctl --vacuum-size=500M 2>/dev/null || true
}

cleanup_backups() {
  log "Rotating old backups..."
  # Keep only 3 most recent pre-update backups (instead of 5) when disk is tight
  local backup_dir="/opt/gwi-pos/backups/pre-update"
  if [[ -d "$backup_dir" ]]; then
    ls -t "$backup_dir"/*.dump 2>/dev/null | tail -n +4 | xargs rm -f 2>/dev/null || true
    ls -t "$backup_dir"/*.json 2>/dev/null | tail -n +4 | xargs rm -f 2>/dev/null || true
  fi
}

main() {
  local usage_pct
  usage_pct=$(get_disk_usage_percent)
  local free_gb
  free_gb=$(get_disk_free_gb)
  local total_gb
  total_gb=$(get_disk_total_gb)

  log "Disk usage: ${usage_pct}% (${free_gb}GB free of ${total_gb}GB)"

  local alert="false"
  local cleaned="false"

  # Cleanup if above threshold
  if [[ "$usage_pct" -ge "$CLEANUP_THRESHOLD_PERCENT" ]]; then
    log "Disk above ${CLEANUP_THRESHOLD_PERCENT}% — starting cleanup"
    cleanup_old_builds
    cleanup_npm_cache
    cleanup_logs
    cleaned="true"

    # Re-check after cleanup
    usage_pct=$(get_disk_usage_percent)
    free_gb=$(get_disk_free_gb)
    log "After cleanup: ${usage_pct}% (${free_gb}GB free)"

    # If still high, clean backups too
    if [[ "$usage_pct" -ge "$ALERT_THRESHOLD_PERCENT" ]]; then
      cleanup_backups
      usage_pct=$(get_disk_usage_percent)
      free_gb=$(get_disk_free_gb)
      log "After backup rotation: ${usage_pct}% (${free_gb}GB free)"
    fi
  fi

  # Alert if still above threshold
  if [[ "$usage_pct" -ge "$ALERT_THRESHOLD_PERCENT" ]]; then
    alert="true"
    log "ALERT: Disk still above ${ALERT_THRESHOLD_PERCENT}% after cleanup!"
  fi

  # Write state for heartbeat
  cat > "$STATE_DIR/disk-pressure.json" <<DPJSON
{
  "checkedAt": "$(date -u +%FT%TZ)",
  "usagePercent": $usage_pct,
  "freeGb": $free_gb,
  "totalGb": $total_gb,
  "alert": $alert,
  "cleaned": $cleaned
}
DPJSON
}

main "$@"
