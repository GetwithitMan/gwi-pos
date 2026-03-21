#!/usr/bin/env bash
# =============================================================================
# 02-register.sh — Station configuration prompts, MC registration, identity
# =============================================================================
# Entry: run_register
# Expects: POSUSER, POSUSER_HOME, APP_BASE, ENV_FILE, MC_URL, MC_REGISTER_URL,
#          KEY_DIR, BACKUP_SCRIPT, BACKOFFICE_API_URL, GIT_REPO
# Sets: STATION_ROLE, ALREADY_REGISTERED, REG_CODE, VNC_PASSWORD, SERVER_URL,
#       PRIMARY_NUC_IP, VIRTUAL_IP, PREV_ROLE, SERVER_NODE_ID, SERVER_API_KEY,
#       HARDWARE_FINGERPRINT, DATABASE_URL, DIRECT_URL, DEPLOY_TOKEN,
#       USE_LOCAL_PG, NEON_DATABASE_URL, NEON_DIRECT_URL, SYNC_ENABLED,
#       LOCATION_ID, MC_LOCATION_ID, CLOUD_ORGANIZATION_ID, CLOUD_ENTERPRISE_ID,
#       VENUE_SLUG, GIT_REPO
# =============================================================================

run_register() {
  local _start=$(date +%s)
  log "Stage: register — starting"

  # ─────────────────────────────────────────────────────────────────────────────
  # Prompts — Station Configuration
  # ─────────────────────────────────────────────────────────────────────────────

  header "Station Configuration"

  # ─────────────────────────────────────────────────────────────────────────────
  # Role Reference:
  #   Server:   Owns local PostgreSQL, runs POS app + sync workers + heartbeat.
  #             Registered with MC. Has NEON_DATABASE_URL for cloud sync.
  #   Backup:   Streaming PG replica + keepalived VIP failover. Does NOT sync
  #             to Neon. Promotes to primary via promote.sh on failover.
  #   Terminal: Kiosk-only. No local DB. Connects to a server's URL.
  #
  # Role Transitions:
  #   Server -> Terminal: removes DB credentials, MC identity, sync config.
  #   Backup -> Terminal: removes HA config, PG standby, keepalived.
  #   Terminal -> Server: requires fresh registration, PG setup, MC identity.
  #   Any role switch re-runs registration if needed.
  # ─────────────────────────────────────────────────────────────────────────────

  # 1. Role
  echo "What role is this station?"
  echo "  1) Server  — Runs POS app + database + kiosk"
  echo "  2) Terminal — Kiosk only (connects to a server)"
  echo "  3) Backup  — Hot standby (PG replication + VIP failover)"
  echo ""
  while true; do
    read -rp "Select (1, 2, or 3): " role_choice < /dev/tty
    case $role_choice in
      1) STATION_ROLE="server"; break ;;
      2) STATION_ROLE="terminal"; break ;;
      3) STATION_ROLE="backup"; break ;;
      *) echo "Please enter 1, 2, or 3." ;;
    esac
  done
  log "Role: $STATION_ROLE"

  # 2. Check if already registered/configured
  # For servers: SERVER_NODE_ID + SERVER_API_KEY indicate MC registration
  # For terminals: STATION_ROLE=terminal + SERVER_URL indicate prior configuration
  ALREADY_REGISTERED=false
  if [[ -f "$ENV_FILE" ]]; then
    if grep -q "^SERVER_NODE_ID=" "$ENV_FILE" && grep -q "^SERVER_API_KEY=" "$ENV_FILE"; then
      ALREADY_REGISTERED=true
      log "Existing server/backup registration found in $ENV_FILE"
    elif grep -q "^STATION_ROLE=terminal" "$ENV_FILE" && grep -q "^SERVER_URL=" "$ENV_FILE"; then
      ALREADY_REGISTERED=true
      log "Existing terminal configuration found in $ENV_FILE"
    fi

    if [[ "$ALREADY_REGISTERED" == "true" ]]; then
      echo ""
      echo "This station is already configured."
      echo "  1) Keep existing configuration (update only)"
      echo "  2) Re-register with a new code"
      echo ""
      while true; do
        read -rp "Select (1 or 2): " reg_choice < /dev/tty
        case $reg_choice in
          1) break ;;
          2) ALREADY_REGISTERED=false
             # Clean old identity so re-registration starts fresh
             if [[ -f "$ENV_FILE" ]]; then
               sed -i '/^SERVER_NODE_ID=/d; /^SERVER_API_KEY=/d; /^HARDWARE_FINGERPRINT=/d; /^POS_LOCATION_ID=/d; /^LOCATION_ID=/d; /^CLOUD_LOCATION_ID=/d; /^NEON_DATABASE_URL=/d; /^NEON_DIRECT_URL=/d' "$ENV_FILE" 2>/dev/null || true
               log "Cleared old registration credentials + venue identity from .env"
             fi
             # Rotate RSA keys — MC will issue new identity
             rm -f "$KEY_DIR/private.pem" "$KEY_DIR/public.pem" 2>/dev/null || true
             log "Removed old RSA keypair (new keys will be generated)"
             # Wipe local database for clean venue — old venue data must not leak
             # into the new venue. The new venue's data will come via provisioning + sync.
             # DB_NAME/DB_USER are hardcoded here because they aren't set yet at this
             # point in the installer (they're set later in the .env canonicalization).
             if command -v psql >/dev/null 2>&1; then
               log "WARNING: Re-registration will DROP and recreate the local database."
               log "All local data will be lost. Cloud data in Neon is preserved."
               echo ""
               read -rp "Type YES to confirm database wipe: " CONFIRM_WIPE < /dev/tty
               if [[ "$CONFIRM_WIPE" != "YES" ]]; then
                 err "Database wipe cancelled. Re-registration aborted."
                 return 1
               fi
               log "Wiping local database for clean re-registration..."
               # DROP may fail if DB doesn't exist or has active connections — that's OK
               sudo -u postgres psql -c "DROP DATABASE IF EXISTS thepasspos;" 2>/dev/null || {
                 warn "DROP DATABASE failed (may have active connections). Attempting with force..."
                 sudo -u postgres psql -c "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname='thepasspos' AND pid <> pg_backend_pid();" 2>/dev/null || true
                 sudo -u postgres psql -c "DROP DATABASE IF EXISTS thepasspos;" 2>/dev/null || true
               }
               sudo -u postgres psql -c "CREATE DATABASE thepasspos OWNER thepasspos;" 2>/dev/null || true
               sudo -u postgres psql -d "thepasspos" -c "
                 GRANT ALL ON ALL TABLES IN SCHEMA public TO thepasspos;
                 GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO thepasspos;
                 ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO thepasspos;
                 ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO thepasspos;
               " 2>/dev/null || true
               log "Local database wiped and recreated for new venue."
             fi
             break ;;
          *) echo "Please enter 1 or 2." ;;
        esac
      done
    fi
  fi

  # 3. Registration code (if not already registered and server/backup role)
  REG_CODE=""
  if [[ "$ALREADY_REGISTERED" == "false" ]] && [[ "$STATION_ROLE" == "server" || "$STATION_ROLE" == "backup" ]]; then
    echo ""
    echo "Enter the registration code from Mission Control."
    echo "(Generate one at: Settings > Venue > NUC Registration)"
    echo ""
    read -rp "Registration code: " REG_CODE < /dev/tty
    if [[ -z "$REG_CODE" ]]; then
      err "Registration code is required for new server/backup installations."
      return 1
    fi
    # Validate UUID format (MC expects a UUID v4)
    UUID_REGEX='^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
    if [[ ! "$REG_CODE" =~ $UUID_REGEX ]]; then
      err "Invalid registration code format. Expected UUID (e.g., 550e8400-e29b-41d4-a716-446655440000)"
      return 1
    fi
  fi

  # 4. VNC password (for remote desktop access via x11vnc)
  echo ""
  read -rsp "VNC remote access password [press Enter to auto-generate]: " VNC_PASSWORD < /dev/tty
  echo ""
  if [[ -z "$VNC_PASSWORD" ]]; then
    VNC_PASSWORD=$(openssl rand -base64 20 | tr '+/' '-_' | cut -c1-20)
    log "VNC password auto-generated."
  fi

  # 5. Terminal: server URL
  SERVER_URL=""
  if [[ "$STATION_ROLE" == "terminal" ]]; then
    echo ""
    read -rp "Server URL (e.g., 192.168.1.50:3005): " SERVER_URL < /dev/tty
    if [[ -z "$SERVER_URL" ]]; then
      err "Server URL is required for terminal stations."
      return 1
    fi
    # Auto-prepend http:// if user just typed an IP or hostname
    if [[ ! "$SERVER_URL" =~ ^https?:// ]]; then
      SERVER_URL="http://$SERVER_URL"
      log "Using: $SERVER_URL"
    fi
    # Validate URL format (prevent injection into systemd ExecStart)
    URL_REGEX='^https?://[A-Za-z0-9._:-]+(/[A-Za-z0-9._/-]*)?$'
    if [[ ! "$SERVER_URL" =~ $URL_REGEX ]]; then
      err "Invalid server URL format. Example: 192.168.1.50:3005"
      return 1
    fi
  fi

  # 6. Backup: primary NUC IP + virtual IP
  PRIMARY_NUC_IP=""
  VIRTUAL_IP=""
  IP_REGEX='^[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}$'
  if [[ "$STATION_ROLE" == "backup" ]]; then
    echo ""
    echo "Enter the PRIMARY server NUC's IP address."
    echo "(This is the server NUC this backup will replicate from)"
    echo ""
    read -rp "Primary NUC IP (e.g., 192.168.1.50): " PRIMARY_NUC_IP < /dev/tty
    if [[ -z "$PRIMARY_NUC_IP" ]]; then
      err "Primary NUC IP is required for backup stations."
      return 1
    fi
    if [[ ! "$PRIMARY_NUC_IP" =~ $IP_REGEX ]]; then
      err "Invalid IP address format. Example: 192.168.1.50"
      return 1
    fi

    echo ""
    echo "Enter the Virtual IP (VIP) address for HA failover."
    echo "(This shared IP floats between primary and backup, e.g., 10.10.10.50)"
    echo ""
    read -rp "Virtual IP: " VIRTUAL_IP < /dev/tty
    if [[ -z "$VIRTUAL_IP" ]]; then
      err "Virtual IP is required for backup stations."
      return 1
    fi
    if [[ ! "$VIRTUAL_IP" =~ $IP_REGEX ]]; then
      err "Invalid IP address format. Example: 10.10.10.50"
      return 1
    fi
  fi

  # 7. Server: optional VIP for HA (skip if solo NUC)
  if [[ "$STATION_ROLE" == "server" ]] && [[ "$ALREADY_REGISTERED" == "false" ]]; then
    echo ""
    echo "High Availability setup (optional)"
    echo "  If this server will be paired with a backup NUC, enter the Virtual IP."
    echo "  Press Enter to skip (solo NUC — no HA)."
    echo ""
    read -rp "Virtual IP (or press Enter to skip): " VIRTUAL_IP < /dev/tty
    if [[ -n "$VIRTUAL_IP" ]]; then
      if [[ ! "$VIRTUAL_IP" =~ $IP_REGEX ]]; then
        err "Invalid IP address format. Example: 10.10.10.50"
        return 1
      fi
      log "HA mode: Virtual IP = $VIRTUAL_IP"
    else
      log "Solo NUC mode (no HA)."
    fi
  fi

  # ─────────────────────────────────────────────────────────────────────────────
  # Existing Install Detection (Idempotent)
  # ─────────────────────────────────────────────────────────────────────────────

  PREV_ROLE=""
  if [[ -d "$APP_BASE" ]]; then
    header "Existing Installation Detected"
    log "Found existing install at $APP_BASE"

    # Detect previous role from .env
    if [[ -f "$ENV_FILE" ]]; then
      PREV_ROLE=$(grep -oP '(?<=^STATION_ROLE=).*' "$ENV_FILE" 2>/dev/null || echo "")
    fi

    if [[ "$STATION_ROLE" == "server" ]] && [[ -f "$BACKUP_SCRIPT" ]]; then
      log "Running pre-update backup..."
      bash "$BACKUP_SCRIPT" || warn "Backup failed — continuing anyway."
    fi

    # Role change: disable services from old role
    if [[ -n "$PREV_ROLE" ]] && [[ "$PREV_ROLE" != "$STATION_ROLE" ]]; then
      warn "Role change detected: $PREV_ROLE -> $STATION_ROLE"
      if [[ "$PREV_ROLE" == "server" ]] && [[ "$STATION_ROLE" == "terminal" ]]; then
        log "Disabling server services..."
        systemctl disable --now thepasspos 2>/dev/null || true
        systemctl disable --now thepasspos-sync 2>/dev/null || true
        systemctl disable --now keepalived 2>/dev/null || true
        # Fully remove PostgreSQL — terminal doesn't need it
        systemctl disable --now postgresql 2>/dev/null || true
        systemctl mask postgresql 2>/dev/null || true
        apt-get purge -y --auto-remove postgresql* postgresql-contrib* 2>/dev/null || true
        rm -rf /var/lib/postgresql /etc/postgresql 2>/dev/null || true
        rm -f "$POSUSER_HOME/.pgpass" 2>/dev/null || true
        log "PostgreSQL fully removed (service, data, config, .pgpass)."
        # Remove server-only cron entries
        crontab -u "$POSUSER" -l 2>/dev/null | grep -vF -e "/opt/gwi-pos/heartbeat.sh" -e "/opt/gwi-pos/backup-pos.sh" | crontab -u "$POSUSER" - 2>/dev/null || true
        log "Removed heartbeat and backup cron entries from previous server role"
        # Scrub server-only identity keys from .env — terminal must not carry stale server metadata
        sed -i '/^SERVER_NODE_ID=/d; /^SERVER_API_KEY=/d; /^HARDWARE_FINGERPRINT=/d' "$ENV_FILE" 2>/dev/null || true
        sed -i '/^MISSION_CONTROL_URL=/d; /^LOCATION_ID=/d; /^CLOUD_LOCATION_ID=/d' "$ENV_FILE" 2>/dev/null || true
        sed -i '/^CLOUD_ORGANIZATION_ID=/d; /^CLOUD_ENTERPRISE_ID=/d' "$ENV_FILE" 2>/dev/null || true
        sed -i '/^DATABASE_URL=/d; /^DIRECT_URL=/d; /^NEON_DATABASE_URL=/d; /^NEON_DIRECT_URL=/d' "$ENV_FILE" 2>/dev/null || true
        sed -i '/^SYNC_ENABLED=/d; /^BACKOFFICE_API_URL=/d; /^INTERNAL_API_SECRET=/d' "$ENV_FILE" 2>/dev/null || true
        sed -i '/^NEXT_PUBLIC_EVENT_PROVIDER=/d; /^VIRTUAL_IP=/d; /^PRIMARY_NUC_IP=/d' "$ENV_FILE" 2>/dev/null || true
        # Scrub ALL secrets — stale secrets from old role must not persist into terminal
        sed -i '/^DB_PASSWORD=/d; /^REPL_PASSWORD=/d; /^VRRP_AUTH_PASS=/d; /^CELLULAR_TOKEN_SECRET=/d; /^SESSION_SECRET=/d; /^TENANT_SIGNING_KEY=/d; /^POS_VENUE_SLUG=/d' "$ENV_FILE" 2>/dev/null || true
        log "Scrubbed server-only identity, database keys, and secrets from .env"
      elif [[ "$PREV_ROLE" == "terminal" ]] && [[ "$STATION_ROLE" == "server" ]]; then
        log "Disabling terminal-only services..."
        systemctl disable --now thepasspos-kiosk 2>/dev/null || true
        systemctl disable --now thepasspos-exit-kiosk 2>/dev/null || true
        rm -f /opt/gwi-pos/exit-kiosk-server.py
      elif [[ "$PREV_ROLE" == "backup" ]] && [[ "$STATION_ROLE" == "server" ]]; then
        log "Promoting backup -> server: removing standby config..."
        systemctl disable --now keepalived 2>/dev/null || true
        PG_VER_DETECTED=$(pg_lsclusters -h 2>/dev/null | awk 'NR==1{print $1}' || echo "16")
        rm -f "/var/lib/postgresql/${PG_VER_DETECTED}/main/standby.signal" 2>/dev/null || true
        sed -i '/^PRIMARY_NUC_IP=/d' "$ENV_FILE" 2>/dev/null || true
        log "Removed standby.signal and PRIMARY_NUC_IP (will reconfigure as primary)"
      elif [[ "$PREV_ROLE" == "server" ]] && [[ "$STATION_ROLE" == "backup" ]]; then
        log "Demoting server -> backup: will reconfigure PG as standby..."
        systemctl disable --now thepasspos 2>/dev/null || true
        systemctl disable --now thepasspos-sync 2>/dev/null || true
        systemctl disable --now thepasspos-kiosk 2>/dev/null || true
      elif [[ "$PREV_ROLE" == "backup" ]] && [[ "$STATION_ROLE" == "terminal" ]]; then
        log "Disabling backup services..."
        systemctl disable --now thepasspos 2>/dev/null || true
        systemctl disable --now thepasspos-sync 2>/dev/null || true
        systemctl disable --now keepalived 2>/dev/null || true
        systemctl disable --now postgresql 2>/dev/null || true
        systemctl mask postgresql 2>/dev/null || true
        apt-get purge -y --auto-remove postgresql* postgresql-contrib* 2>/dev/null || true
        rm -rf /var/lib/postgresql /etc/postgresql 2>/dev/null || true
        rm -f "$POSUSER_HOME/.pgpass" 2>/dev/null || true
        sed -i '/^SERVER_NODE_ID=/d; /^SERVER_API_KEY=/d; /^HARDWARE_FINGERPRINT=/d' "$ENV_FILE" 2>/dev/null || true
        sed -i '/^MISSION_CONTROL_URL=/d; /^LOCATION_ID=/d; /^CLOUD_LOCATION_ID=/d' "$ENV_FILE" 2>/dev/null || true
        sed -i '/^CLOUD_ORGANIZATION_ID=/d; /^CLOUD_ENTERPRISE_ID=/d' "$ENV_FILE" 2>/dev/null || true
        sed -i '/^DATABASE_URL=/d; /^DIRECT_URL=/d; /^NEON_DATABASE_URL=/d; /^NEON_DIRECT_URL=/d' "$ENV_FILE" 2>/dev/null || true
        sed -i '/^SYNC_ENABLED=/d; /^BACKOFFICE_API_URL=/d; /^INTERNAL_API_SECRET=/d' "$ENV_FILE" 2>/dev/null || true
        sed -i '/^NEXT_PUBLIC_EVENT_PROVIDER=/d; /^VIRTUAL_IP=/d; /^PRIMARY_NUC_IP=/d' "$ENV_FILE" 2>/dev/null || true
        # Scrub ALL secrets — stale secrets from old role must not persist into terminal
        sed -i '/^DB_PASSWORD=/d; /^REPL_PASSWORD=/d; /^VRRP_AUTH_PASS=/d; /^CELLULAR_TOKEN_SECRET=/d; /^SESSION_SECRET=/d; /^TENANT_SIGNING_KEY=/d; /^POS_VENUE_SLUG=/d' "$ENV_FILE" 2>/dev/null || true
        log "Scrubbed backup identity, database keys, and secrets from .env"
      elif [[ "$PREV_ROLE" == "terminal" ]] && [[ "$STATION_ROLE" == "backup" ]]; then
        log "Disabling terminal-only services..."
        systemctl disable --now thepasspos-kiosk 2>/dev/null || true
        systemctl disable --now thepasspos-exit-kiosk 2>/dev/null || true
        rm -f /opt/gwi-pos/exit-kiosk-server.py
      fi
      # Persist new role to .env so future re-runs see the correct STATION_ROLE
      if grep -q "^STATION_ROLE=" "$ENV_FILE" 2>/dev/null; then
        sed -i "s|^STATION_ROLE=.*|STATION_ROLE=$STATION_ROLE|" "$ENV_FILE"
      else
        echo "STATION_ROLE=$STATION_ROLE" >> "$ENV_FILE"
      fi
      log "Updated STATION_ROLE=$STATION_ROLE in .env"
    fi

    # Disable new service names if re-running installer (will re-enable relevant ones later)
    systemctl disable --now thepasspos 2>/dev/null || true
    systemctl disable --now thepasspos-sync 2>/dev/null || true
    systemctl disable --now thepasspos-kiosk 2>/dev/null || true
    systemctl disable --now thepasspos-exit-kiosk 2>/dev/null || true
    systemctl stop keepalived 2>/dev/null || true

    # Clean up legacy pulse-* services from pre-rebrand installs
    systemctl disable --now pulse-pos 2>/dev/null || true
    systemctl disable --now pulse-sync 2>/dev/null || true
    systemctl disable --now pulse-kiosk 2>/dev/null || true
    systemctl disable --now pulse-exit-kiosk 2>/dev/null || true
    rm -f /etc/systemd/system/pulse-pos.service /etc/systemd/system/pulse-kiosk.service /etc/systemd/system/pulse-sync.service /etc/systemd/system/pulse-exit-kiosk.service
    systemctl daemon-reload

    log "Updating existing installation..."
  else
    log "Fresh installation."
  fi

  # ─────────────────────────────────────────────────────────────────────────────
  # Mission Control Registration (Server Role Only)
  # ─────────────────────────────────────────────────────────────────────────────

  # Variables populated by registration or loaded from existing .env
  DEPLOY_TOKEN=""
  DATABASE_URL=""
  DIRECT_URL=""
  HARDWARE_FINGERPRINT=""
  USE_LOCAL_PG=false

  if [[ "$ALREADY_REGISTERED" == "false" ]] && [[ "$STATION_ROLE" == "server" || "$STATION_ROLE" == "backup" ]]; then
    header "Registering with Mission Control"

    # ── Generate hardware fingerprint (SHA-256 of machine-id + MAC addresses) ──
    MACHINE_ID=$(cat /etc/machine-id 2>/dev/null || echo "no-machine-id")
    MAC_ADDRS=$(ip link show 2>/dev/null | awk '/ether/{print $2}' | sort | tr '\n' ':')
    HARDWARE_FINGERPRINT=$(printf '%s:%s' "$MACHINE_ID" "$MAC_ADDRS" | sha256sum | cut -d' ' -f1)
    log "Hardware fingerprint: ${HARDWARE_FINGERPRINT:0:16}..."

    # ── Generate RSA 2048-bit keypair (skip if already exists) ──
    mkdir -p "$APP_BASE" "$KEY_DIR"
    chmod 700 "$KEY_DIR"
    if [[ ! -f "$KEY_DIR/private.pem" ]]; then
      log "Generating RSA keypair..."
      openssl genrsa -out "$KEY_DIR/private.pem" 2048 2>/dev/null
      openssl rsa -in "$KEY_DIR/private.pem" -pubout -out "$KEY_DIR/public.pem" 2>/dev/null
    fi
    chmod 600 "$KEY_DIR/private.pem"
    # App directory owned by POSUSER, but sensitive files carved out to root
    chown -R "$POSUSER":"$POSUSER" "$APP_BASE"
    chown -R root:root "$KEY_DIR" && chmod 700 "$KEY_DIR"
    PUBLIC_KEY=$(cat "$KEY_DIR/public.pem")
    log "RSA keypair ready."

    # ── Build registration payload ──
    REG_PAYLOAD=$(jq -n \
      --arg token "$REG_CODE" \
      --arg fp "$HARDWARE_FINGERPRINT" \
      --arg pk "$PUBLIC_KEY" \
      --arg role "$STATION_ROLE" \
      '{registrationToken: $token, hardwareFingerprint: $fp, fingerprintVersion: 1, publicKey: $pk, role: $role}')

    log "Calling $MC_REGISTER_URL..."

    REG_RESP_FILE=$(mktemp)
    REG_ERR_FILE=$(mktemp)
    HTTP_CODE=$(curl -sS --max-time 30 -X POST \
      "$MC_REGISTER_URL" \
      -H "Content-Type: application/json" \
      -d "$REG_PAYLOAD" \
      -o "$REG_RESP_FILE" \
      -w "%{http_code}" 2>"$REG_ERR_FILE") || HTTP_CODE="000"

    REG_RESPONSE=$(cat "$REG_RESP_FILE" 2>/dev/null || echo "{}")
    rm -f "$REG_RESP_FILE" "$REG_ERR_FILE"

    if [[ "$HTTP_CODE" != "201" ]] && [[ "$HTTP_CODE" != "200" ]]; then
      err "Mission Control registration failed (HTTP $HTTP_CODE)."
      # Try to extract error message from response
      ERR_MSG=$(echo "$REG_RESPONSE" | jq -r '.error // .message // empty' 2>/dev/null || echo "")
      if [[ -n "$ERR_MSG" ]]; then
        err "  $ERR_MSG"
      else
        err "  Response: $REG_RESPONSE"
      fi
      err ""
      err "Check:"
      err "  - Registration code is a valid UUID from Mission Control"
      err "  - Code has not expired (24-hour window)"
      err "  - Code has not already been used"
      err "  - Network can reach $MC_URL"
      return 1
    fi

    # ── Parse response ──
    SERVER_NODE_ID=$(echo "$REG_RESPONSE" | jq -r '.data.serverNodeId // empty')
    # posLocationId is the POS-side Location.id (used for query filtering)
    # locationId is the MC CloudLocation.id (used for fleet management)
    POS_LOCATION_ID=$(echo "$REG_RESPONSE" | jq -r '.data.posLocationId // empty')
    MC_LOCATION_ID=$(echo "$REG_RESPONSE" | jq -r '.data.locationId // empty')
    CLOUD_ORGANIZATION_ID=$(echo "$REG_RESPONSE" | jq -r '.data.organizationId // empty')
    CLOUD_ENTERPRISE_ID=$(echo "$REG_RESPONSE" | jq -r '.data.enterpriseId // empty')
    VENUE_SLUG=$(echo "$REG_RESPONSE" | jq -r '.data.venueSlug // empty')
    LOCATION_ID="${POS_LOCATION_ID:-$MC_LOCATION_ID}"
    ENCRYPTED_API_KEY=$(echo "$REG_RESPONSE" | jq -r '.data.encryptedApiKey // empty')
    ENCRYPTED_DB_URL=$(echo "$REG_RESPONSE" | jq -r '.data.encryptedDatabaseUrl // empty')
    ENCRYPTED_DIRECT_URL=$(echo "$REG_RESPONSE" | jq -r '.data.encryptedDirectUrl // empty')
    ENCRYPTED_DEPLOY_TOKEN=$(echo "$REG_RESPONSE" | jq -r '.data.encryptedDeployToken // empty')
    # Repo URL from MC (avoids hardcoding in public script)
    ENCRYPTED_REPO_URL=$(echo "$REG_RESPONSE" | jq -r '.data.encryptedRepoUrl // empty')

    if [[ -z "$SERVER_NODE_ID" ]] || [[ -z "$ENCRYPTED_API_KEY" ]]; then
      err "Invalid response from Mission Control (missing serverNodeId or encryptedApiKey)."
      err "Response: $REG_RESPONSE"
      return 1
    fi

    log "Registration successful! Server node: $SERVER_NODE_ID"

    # ── Decrypt secrets using RSA private key (OAEP-SHA256) ──
    # MC encrypts with: crypto.publicEncrypt({ key, oaepHash: 'sha256', padding: RSA_PKCS1_OAEP_PADDING })
    # NUC decrypts with matching: openssl pkeyutl with OAEP + SHA-256 for both digest and MGF1
    decrypt_rsa() {
      local encrypted_b64="$1"
      local label="$2"
      if [[ -z "$encrypted_b64" ]] || [[ "$encrypted_b64" == "null" ]]; then
        echo ""
        return
      fi
      local decrypted
      decrypted=$(echo "$encrypted_b64" | base64 -d 2>/dev/null | openssl pkeyutl -decrypt \
        -inkey "$KEY_DIR/private.pem" \
        -pkeyopt rsa_padding_mode:oaep \
        -pkeyopt rsa_oaep_md:sha256 \
        -pkeyopt rsa_mgf1_md:sha256 2>&1) || {
        warn "  RSA decrypt failed for: ${label:-unknown}"
        warn "  This may indicate a padding mismatch between MC and NUC."
        warn "  Expected: RSA-OAEP with SHA-256 digest + SHA-256 MGF1"
        echo ""
        return
      }
      echo "$decrypted"
    }

    log "Decrypting secrets..."
    SERVER_API_KEY=$(decrypt_rsa "$ENCRYPTED_API_KEY" "serverApiKey")
    DATABASE_URL=$(decrypt_rsa "$ENCRYPTED_DB_URL" "databaseUrl")
    DIRECT_URL=$(decrypt_rsa "$ENCRYPTED_DIRECT_URL" "directUrl")
    DEPLOY_TOKEN=$(decrypt_rsa "$ENCRYPTED_DEPLOY_TOKEN" "deployToken")

    # Decrypt repo URL (if provided by Mission Control — avoids hardcoding in public script)
    if [[ -n "$ENCRYPTED_REPO_URL" ]]; then
      DECRYPTED_REPO_URL=$(decrypt_rsa "$ENCRYPTED_REPO_URL" "repoUrl")
      if [[ -n "$DECRYPTED_REPO_URL" ]]; then
        GIT_REPO="$DECRYPTED_REPO_URL"
        log "Git repo URL from registration."
      fi
    fi
    # Fallback: if MC didn't provide repoUrl and no override was set
    if [[ -z "$GIT_REPO" ]]; then
      GIT_REPO="https://github.com/GetwithitMan/gwi-pos.git"
      log "Using default Git repo URL (MC did not provide encryptedRepoUrl)."
    fi

    # Decrypt backoffice URL (if provided by Mission Control)
    ENCRYPTED_BACKOFFICE_URL=$(echo "$REG_RESPONSE" | jq -r '.data.encryptedBackofficeUrl // empty')
    if [[ -n "$ENCRYPTED_BACKOFFICE_URL" ]]; then
      DECRYPTED_BO_URL=$(decrypt_rsa "$ENCRYPTED_BACKOFFICE_URL" "backofficeUrl")
      if [[ -n "$DECRYPTED_BO_URL" ]]; then
        BACKOFFICE_API_URL="$DECRYPTED_BO_URL"
        log "Backoffice URL from registration: $BACKOFFICE_API_URL"
      else
        log "Backoffice URL decryption failed — using default: $BACKOFFICE_API_URL"
      fi
    fi

    if [[ -z "$SERVER_API_KEY" ]]; then
      err "Failed to decrypt server API key."
      err ""
      err "Possible causes:"
      err "  1. RSA padding mismatch — MC must use OAEP with SHA-256 (oaepHash: 'sha256')"
      err "  2. Key rotation — MC encrypted with a different public key than this NUC's"
      err "  3. Corrupted response — base64 data was truncated or malformed"
      err ""
      err "Fix: delete $KEY_DIR and re-run the installer to generate a new keypair."
      return 1
    fi

    log "Secrets decrypted successfully."

    # ── Offline-first: local PG is primary, Neon is canonical cloud DB ──
    # If a cloud DATABASE_URL was provided, store it as NEON_DATABASE_URL for sync + cellular ingress
    NEON_DATABASE_URL=""
    NEON_DIRECT_URL=""
    SYNC_ENABLED="false"
    if [[ -n "$DATABASE_URL" ]] && [[ "$DATABASE_URL" != *"localhost"* ]] && [[ "$DATABASE_URL" != *"127.0.0.1"* ]]; then
      NEON_DATABASE_URL="$DATABASE_URL"
      NEON_DIRECT_URL="$DIRECT_URL"
      SYNC_ENABLED="true"
      log "Cloud database URL provided — storing as NEON_DATABASE_URL for sync + cellular ingress."
      log "Local PostgreSQL will be primary (offline-first mode)."
      # Clear cloud URLs — local PG will be set up in the PostgreSQL section
      DATABASE_URL=""
      DIRECT_URL=""
    fi
    USE_LOCAL_PG=true

  elif [[ "$ALREADY_REGISTERED" == "false" ]] && [[ "$STATION_ROLE" == "terminal" ]]; then
    # Fresh terminal install — handled by secrets module
    :
  else
    # Already registered — handled by secrets module
    :
  fi

  log "Stage: register — completed in $(( $(date +%s) - _start ))s"
  return 0
}
