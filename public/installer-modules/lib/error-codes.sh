#!/usr/bin/env bash
# GWI POS Installer — Error Code Library
# Usage: source this file, then use err_code() instead of bare echo/err for failures

declare -A GWI_ERROR_CODES

# Preflight errors (001-049)
GWI_ERROR_CODES[ERR-INST-001]="Not running as root"
GWI_ERROR_CODES[ERR-INST-002]="Unsupported OS (requires Ubuntu 22.04+)"
GWI_ERROR_CODES[ERR-INST-003]="Insufficient disk space"
GWI_ERROR_CODES[ERR-INST-004]="DNS resolution failed"
GWI_ERROR_CODES[ERR-INST-005]="System clock out of sync (>5 min drift)"
GWI_ERROR_CODES[ERR-INST-006]="Insufficient memory (<2GB)"
GWI_ERROR_CODES[ERR-INST-007]="Required port in use"
GWI_ERROR_CODES[ERR-INST-008]="NTP service not running"
GWI_ERROR_CODES[ERR-INST-009]="Essential package install failed"
GWI_ERROR_CODES[ERR-INST-010]="Invalid station role"

# Registration errors (050-099)
GWI_ERROR_CODES[ERR-INST-050]="MC registration failed"
GWI_ERROR_CODES[ERR-INST-051]="Invalid venue code"
GWI_ERROR_CODES[ERR-INST-052]="MC unreachable during registration"
GWI_ERROR_CODES[ERR-INST-053]="Hardware fingerprint mismatch"
GWI_ERROR_CODES[ERR-INST-054]="Registration key expired or invalid"
GWI_ERROR_CODES[ERR-INST-055]="Role transition not allowed"

# Secrets errors (100-119)
GWI_ERROR_CODES[ERR-INST-100]="RSA key generation failed"
GWI_ERROR_CODES[ERR-INST-101]="Backup encryption key generation failed"
GWI_ERROR_CODES[ERR-INST-102]="Git credential setup failed"

# Database errors (120-149)
GWI_ERROR_CODES[ERR-INST-120]="PostgreSQL installation failed"
GWI_ERROR_CODES[ERR-INST-121]="Database creation failed"
GWI_ERROR_CODES[ERR-INST-122]="Database user creation failed"
GWI_ERROR_CODES[ERR-INST-123]="PostgreSQL failed to start"
GWI_ERROR_CODES[ERR-INST-124]="Replication setup failed"
GWI_ERROR_CODES[ERR-INST-125]="pg_basebackup failed"
GWI_ERROR_CODES[ERR-INST-126]="Database connection test failed"

# Deploy errors (150-179)
GWI_ERROR_CODES[ERR-INST-150]="Git clone failed"
GWI_ERROR_CODES[ERR-INST-151]="Git pull/fetch failed"
GWI_ERROR_CODES[ERR-INST-152]="Git credential validation failed"
GWI_ERROR_CODES[ERR-INST-153]="npm ci failed"
GWI_ERROR_CODES[ERR-INST-154]="Prisma generate failed"
GWI_ERROR_CODES[ERR-INST-155]="Git repair failed — nuclear recovery needed"
GWI_ERROR_CODES[ERR-INST-156]="Git lock file stuck after repair attempts"

# Schema errors (180-209)
GWI_ERROR_CODES[ERR-INST-180]="prisma db push failed"
GWI_ERROR_CODES[ERR-INST-181]="Tables dropped during schema push"
GWI_ERROR_CODES[ERR-INST-182]="Critical tables missing after schema push"
GWI_ERROR_CODES[ERR-INST-183]="Seed script failed"
GWI_ERROR_CODES[ERR-INST-184]="Migration runner failed"
GWI_ERROR_CODES[ERR-INST-185]="Schema version mismatch — too many versions ahead"
GWI_ERROR_CODES[ERR-INST-186]="Build failed (next build)"
GWI_ERROR_CODES[ERR-INST-187]="Build OOM — insufficient memory"

# Services errors (210-239)
GWI_ERROR_CODES[ERR-INST-210]="systemd service creation failed"
GWI_ERROR_CODES[ERR-INST-211]="POS service failed to start"
GWI_ERROR_CODES[ERR-INST-212]="Health check failed after service start"
GWI_ERROR_CODES[ERR-INST-213]="Sync service failed to start"
GWI_ERROR_CODES[ERR-INST-214]="Kiosk service failed to start"
GWI_ERROR_CODES[ERR-INST-215]="Watchdog service installation failed"

# HA errors (240-259)
GWI_ERROR_CODES[ERR-INST-240]="keepalived installation failed"
GWI_ERROR_CODES[ERR-INST-241]="VIP failover test failed"
GWI_ERROR_CODES[ERR-INST-242]="Streaming replication setup failed"

# Remote access errors (260-279)
GWI_ERROR_CODES[ERR-INST-260]="VNC installation failed"
GWI_ERROR_CODES[ERR-INST-261]="RealVNC setup failed"
GWI_ERROR_CODES[ERR-INST-262]="TeamViewer installation failed"
GWI_ERROR_CODES[ERR-INST-263]="SSH hardening failed"

# Finalize errors (280-299)
GWI_ERROR_CODES[ERR-INST-280]="Install report generation failed"
GWI_ERROR_CODES[ERR-INST-281]="State recording failed"

# Hardening errors (300-329)
GWI_ERROR_CODES[ERR-INST-300]="Ansible bootstrap failed"
GWI_ERROR_CODES[ERR-INST-301]="Ansible playbook execution failed"
GWI_ERROR_CODES[ERR-INST-302]="Notification suppression failed"
GWI_ERROR_CODES[ERR-INST-303]="Kiosk hardening failed"

# Dashboard errors (330-349)
GWI_ERROR_CODES[ERR-INST-330]="Dashboard .deb installation failed"
GWI_ERROR_CODES[ERR-INST-331]="Dashboard systemd service failed"
GWI_ERROR_CODES[ERR-INST-332]="Dashboard auto-start setup failed"

# Update errors (400-449)
GWI_ERROR_CODES[ERR-UPD-400]="Pre-update backup failed"
GWI_ERROR_CODES[ERR-UPD-401]="Backup integrity verification failed"
GWI_ERROR_CODES[ERR-UPD-402]="Code snapshot failed"
GWI_ERROR_CODES[ERR-UPD-403]="Rollback failed"
GWI_ERROR_CODES[ERR-UPD-404]="Version compatibility check failed"
GWI_ERROR_CODES[ERR-UPD-405]="Insufficient disk for update"
GWI_ERROR_CODES[ERR-UPD-406]="Active payments detected — update blocked"
GWI_ERROR_CODES[ERR-UPD-407]="Health check failed after update"
GWI_ERROR_CODES[ERR-UPD-408]="Rolling restart failed"

# Watchdog errors (450-469)
GWI_ERROR_CODES[ERR-WDG-450]="POS health check failed"
GWI_ERROR_CODES[ERR-WDG-451]="Database unreachable"
GWI_ERROR_CODES[ERR-WDG-452]="Service restart failed"
GWI_ERROR_CODES[ERR-WDG-453]="Escalation to MC failed"

# Helper function to log with error code
err_code() {
  local code="${1:-UNKNOWN}"
  shift || true
  # Defensive: if GWI_ERROR_CODES isn't declared yet (subshell, sourced late), skip lookup
  local desc="Unknown error"
  if declare -p GWI_ERROR_CODES &>/dev/null; then
    desc="${GWI_ERROR_CODES[$code]:-Unknown error}"
  fi
  local detail="${*:-}"
  echo -e "\033[0;31m[$code] $desc${detail:+: $detail}\033[0m" >&2
  # Also log to structured event log
  local event_log="/opt/gwi-pos/state/install-events.jsonl"
  if [[ -d /opt/gwi-pos/state ]]; then
    echo "{\"ts\":\"$(date -u +%FT%TZ)\",\"code\":\"$code\",\"desc\":\"$desc\",\"detail\":\"$detail\"}" >> "$event_log" 2>/dev/null || true
  fi
}

# Helper to get description for a code
get_error_desc() {
  echo "${GWI_ERROR_CODES[$1]:-Unknown error code: $1}"
}

# Export for subshells
export -f err_code get_error_desc 2>/dev/null || true
