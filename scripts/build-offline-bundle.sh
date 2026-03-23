#!/usr/bin/env bash
# GWI POS Offline Installer Bundle Builder
# Produces a self-contained installer that needs NO internet access on the NUC
# Output: dist/gwi-pos-offline-installer-VERSION.run
#
# Prerequisites (on build machine):
# - Node.js 20+
# - git
# - PostgreSQL client (for pg_dump format in the seed)
# - tar, gzip
#
# What's bundled:
# - Pre-built .next/ directory (server + static)
# - node_modules/ (production only)
# - Node.js 20 Linux x64 binary
# - All installer modules + libs
# - Prisma client (pre-generated)
# - Dashboard .deb package
# - Ansible roles + playbook
# - All monitoring scripts
# - Schema SQL + version contract
#
# Total size: ~180-250MB compressed

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
DIST_DIR="$PROJECT_DIR/dist"
BUNDLE_DIR="$DIST_DIR/bundle-staging"
NODE_VERSION="20.18.1"
NODE_ARCH="linux-x64"
NODE_URL="https://nodejs.org/dist/v${NODE_VERSION}/node-v${NODE_VERSION}-${NODE_ARCH}.tar.gz"
NODE_CACHE_DIR="$HOME/.cache/gwi-pos-build"

log() { echo "[$(date -u +%FT%TZ)] BUILD: $*"; }
err() { echo "[$(date -u +%FT%TZ)] BUILD ERROR: $*" >&2; }

# Read version from package.json
VERSION=$(node -e "console.log(require('./package.json').version)" 2>/dev/null || echo "0.0.0")
GIT_SHA=$(git rev-parse --short HEAD 2>/dev/null || echo "unknown")
INSTALLER_NAME="gwi-pos-offline-installer-${VERSION}"

log "Building offline installer v${VERSION} (${GIT_SHA})"

# Clean previous builds
rm -rf "$BUNDLE_DIR"
mkdir -p "$BUNDLE_DIR" "$DIST_DIR" "$NODE_CACHE_DIR"

# ── Step 1: Download Node.js binary ──────────────────────────────────
log "Step 1: Caching Node.js ${NODE_VERSION} ${NODE_ARCH}..."
NODE_TARBALL="$NODE_CACHE_DIR/node-v${NODE_VERSION}-${NODE_ARCH}.tar.gz"
if [[ ! -f "$NODE_TARBALL" ]]; then
  log "Downloading Node.js from $NODE_URL"
  curl -fsSL "$NODE_URL" -o "$NODE_TARBALL" || {
    err "Failed to download Node.js"
    exit 1
  }
else
  log "Using cached Node.js tarball"
fi
mkdir -p "$BUNDLE_DIR/node"
tar xzf "$NODE_TARBALL" -C "$BUNDLE_DIR/node" --strip-components=1

# ── Step 2: Install production dependencies ──────────────────────────
log "Step 2: Installing production dependencies..."
cd "$PROJECT_DIR"
# Full install first (need dev deps for build)
npm ci 2>&1 | tail -5

# ── Step 3: Generate Prisma client ────────────────────────────────────
log "Step 3: Generating Prisma client..."
npx prisma generate 2>&1 | tail -3

# ── Step 4: Build the application ─────────────────────────────────────
log "Step 4: Building Next.js application..."
SKIP_TYPECHECK=1 NODE_OPTIONS="--max-old-space-size=8192" npm run build 2>&1 | tail -10 || {
  err "Next.js build failed"
  exit 1
}

# ── Step 5: Build custom server ───────────────────────────────────────
log "Step 5: Building custom server..."
npm run build:server 2>&1 | tail -5 || {
  err "Custom server build failed"
  exit 1
}

# ── Step 6: Copy application files ────────────────────────────────────
log "Step 6: Assembling application bundle..."
APP_BUNDLE="$BUNDLE_DIR/app"
mkdir -p "$APP_BUNDLE"

# Core application
cp -a .next "$APP_BUNDLE/.next"
cp -a public "$APP_BUNDLE/public"
cp -a prisma "$APP_BUNDLE/prisma"
cp package.json package-lock.json "$APP_BUNDLE/"
cp next.config.ts "$APP_BUNDLE/" 2>/dev/null || cp next.config.js "$APP_BUNDLE/" 2>/dev/null || true
cp server.js "$APP_BUNDLE/" 2>/dev/null || true
cp tsconfig.json "$APP_BUNDLE/" 2>/dev/null || true

# Prisma generated client
if [[ -d src/generated ]]; then
  mkdir -p "$APP_BUNDLE/src/generated"
  cp -a src/generated "$APP_BUNDLE/src/"
fi
# Alternative location
if [[ -d node_modules/.prisma ]]; then
  mkdir -p "$APP_BUNDLE/node_modules/.prisma"
  cp -a node_modules/.prisma "$APP_BUNDLE/node_modules/"
fi
if [[ -d node_modules/@prisma ]]; then
  mkdir -p "$APP_BUNDLE/node_modules/@prisma"
  cp -a node_modules/@prisma "$APP_BUNDLE/node_modules/"
fi

# Scripts
cp -a scripts "$APP_BUNDLE/scripts"

# ── Step 7: Production node_modules ──────────────────────────────────
log "Step 7: Installing production-only dependencies..."
cd "$APP_BUNDLE"
# Use the bundled node to install prod deps (ensures compatibility)
"$BUNDLE_DIR/node/bin/npm" ci --production --ignore-scripts 2>&1 | tail -5 || {
  # Fallback: use host npm
  npm ci --production --ignore-scripts 2>&1 | tail -5
}
cd "$PROJECT_DIR"

# ── Step 8: Copy installer modules ───────────────────────────────────
log "Step 8: Copying installer infrastructure..."
cp -a public/installer-modules "$BUNDLE_DIR/installer-modules"
cp public/installer.run "$BUNDLE_DIR/installer.run"
chmod +x "$BUNDLE_DIR/installer.run"

# Monitoring scripts
mkdir -p "$BUNDLE_DIR/scripts"
for script in watchdog.sh; do
  [[ -f "public/$script" ]] && cp "public/$script" "$BUNDLE_DIR/scripts/"
done
for script in hardware-inventory.sh disk-pressure-monitor.sh version-compat.sh rolling-restart.sh pre-update-backup.sh; do
  [[ -f "public/scripts/$script" ]] && cp "public/scripts/$script" "$BUNDLE_DIR/scripts/"
done
chmod +x "$BUNDLE_DIR/scripts/"*.sh 2>/dev/null || true

# Sync agent
cp public/sync-agent.js "$BUNDLE_DIR/sync-agent.js"

# ── Step 9: Copy Ansible infrastructure ──────────────────────────────
log "Step 9: Copying Ansible roles..."
if [[ -d installer ]]; then
  cp -a installer "$BUNDLE_DIR/installer"
fi

# ── Step 10: Copy Dashboard .deb ──────────────────────────────────────
log "Step 10: Copying Dashboard package..."
if [[ -f public/gwi-nuc-dashboard.deb ]]; then
  cp public/gwi-nuc-dashboard.deb "$BUNDLE_DIR/gwi-nuc-dashboard.deb"
fi

# ── Step 11: Version contract + schema ────────────────────────────────
log "Step 11: Copying version metadata..."
[[ -f public/version-contract.json ]] && cp public/version-contract.json "$BUNDLE_DIR/"
[[ -f public/schema.sql ]] && cp public/schema.sql "$BUNDLE_DIR/"

# ── Step 12: Create offline installer wrapper ─────────────────────────
log "Step 12: Creating self-extracting installer..."

cat > "$BUNDLE_DIR/install-offline.sh" <<'OFFLINE_INSTALLER'
#!/usr/bin/env bash
# GWI POS Offline Installer — Self-contained, no internet required
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
BUNDLE_DIR="$SCRIPT_DIR"
APP_DIR="/opt/gwi-pos/app"
NODE_DIR="/opt/gwi-pos/node"
export PATH="$NODE_DIR/bin:$PATH"

log() { echo -e "\033[0;32m[$(date -u +%FT%TZ)] OFFLINE-INSTALL: $*\033[0m"; }
err() { echo -e "\033[0;31m[$(date -u +%FT%TZ)] OFFLINE-INSTALL ERROR: $*\033[0m" >&2; }

if [[ $EUID -ne 0 ]]; then
  err "Must run as root"
  exit 1
fi

log "GWI POS Offline Installer"
log "========================="

# Install Node.js
log "Installing Node.js..."
rm -rf "$NODE_DIR"
cp -a "$BUNDLE_DIR/node" "$NODE_DIR"
ln -sf "$NODE_DIR/bin/node" /usr/local/bin/node
ln -sf "$NODE_DIR/bin/npm" /usr/local/bin/npm
ln -sf "$NODE_DIR/bin/npx" /usr/local/bin/npx
log "Node.js $(node --version) installed"

# Deploy application
log "Deploying application..."
mkdir -p /opt/gwi-pos
if [[ -d "$APP_DIR" ]]; then
  log "Existing installation found — backing up..."
  rm -rf /opt/gwi-pos/app.last-good
  mv "$APP_DIR" /opt/gwi-pos/app.last-good
fi
cp -a "$BUNDLE_DIR/app" "$APP_DIR"

# Symlink .env
[[ -f /opt/gwi-pos/.env ]] && ln -sf /opt/gwi-pos/.env "$APP_DIR/.env"

# Deploy sync agent
cp "$BUNDLE_DIR/sync-agent.js" /opt/gwi-pos/sync-agent.js 2>/dev/null || true

# Deploy monitoring scripts
mkdir -p /opt/gwi-pos/scripts /opt/gwi-pos/installer-modules/lib
cp "$BUNDLE_DIR/scripts/"*.sh /opt/gwi-pos/scripts/ 2>/dev/null || true
chmod +x /opt/gwi-pos/scripts/*.sh 2>/dev/null || true

# Deploy installer modules + libs
cp -a "$BUNDLE_DIR/installer-modules/"* /opt/gwi-pos/installer-modules/ 2>/dev/null || true
chmod +x /opt/gwi-pos/installer-modules/lib/*.sh 2>/dev/null || true

# Deploy Dashboard
if [[ -f "$BUNDLE_DIR/gwi-nuc-dashboard.deb" ]]; then
  log "Installing Dashboard..."
  dpkg -i "$BUNDLE_DIR/gwi-nuc-dashboard.deb" 2>/dev/null || apt-get install -f -y 2>/dev/null || true
fi

# Deploy Ansible
if [[ -d "$BUNDLE_DIR/installer" ]]; then
  cp -a "$BUNDLE_DIR/installer" /opt/gwi-pos/installer 2>/dev/null || true
fi

# Version metadata
[[ -f "$BUNDLE_DIR/version-contract.json" ]] && cp "$BUNDLE_DIR/version-contract.json" "$APP_DIR/public/" 2>/dev/null || true
[[ -f "$BUNDLE_DIR/schema.sql" ]] && cp "$BUNDLE_DIR/schema.sql" "$APP_DIR/public/" 2>/dev/null || true

# Now delegate to the main installer for registration, database, services, etc.
log ""
log "Application files deployed. Running main installer for system setup..."
log "(The installer will handle registration, database, services, etc.)"
log ""

# Set offline mode flag
export GWI_OFFLINE_INSTALL=1
export SKIP_GIT_CLONE=1
export SKIP_NPM_INSTALL=1
export SKIP_BUILD=1

if [[ -f "$BUNDLE_DIR/installer.run" ]]; then
  chmod +x "$BUNDLE_DIR/installer.run"
  exec bash "$BUNDLE_DIR/installer.run" --resume-from=register "$@"
else
  log "Main installer not found — manual setup required"
  log "Application deployed to $APP_DIR"
  log "Run the registration and service setup manually"
fi
OFFLINE_INSTALLER
chmod +x "$BUNDLE_DIR/install-offline.sh"

# ── Step 13: Create tarball ───────────────────────────────────────────
log "Step 13: Creating compressed archive..."
cd "$DIST_DIR"
tar czf "${INSTALLER_NAME}.tar.gz" -C bundle-staging .

# ── Step 14: Create self-extracting .run file ─────────────────────────
log "Step 14: Creating self-extracting .run file..."
cat > "$DIST_DIR/${INSTALLER_NAME}.run" <<'RUN_HEADER'
#!/usr/bin/env bash
# GWI POS Offline Installer — Self-extracting archive
set -euo pipefail
echo "GWI POS Offline Installer"
echo "Extracting..."
TMPDIR=$(mktemp -d /tmp/gwi-pos-install.XXXXXX)
ARCHIVE_START=$(awk '/^__ARCHIVE_BELOW__/ {print NR + 1; exit 0; }' "$0")
tail -n+${ARCHIVE_START} "$0" | tar xz -C "$TMPDIR"
echo "Running installer..."
cd "$TMPDIR"
exec bash install-offline.sh "$@"
__ARCHIVE_BELOW__
RUN_HEADER
cat "$DIST_DIR/${INSTALLER_NAME}.tar.gz" >> "$DIST_DIR/${INSTALLER_NAME}.run"
chmod +x "$DIST_DIR/${INSTALLER_NAME}.run"

# ── Step 15: Summary ──────────────────────────────────────────────────
TARBALL_SIZE=$(du -sh "$DIST_DIR/${INSTALLER_NAME}.tar.gz" | cut -f1)
RUN_SIZE=$(du -sh "$DIST_DIR/${INSTALLER_NAME}.run" | cut -f1)

# Clean up staging
rm -rf "$BUNDLE_DIR"

log ""
log "═══════════════════════════════════════════════════════"
log "  Offline Installer Built Successfully!"
log "═══════════════════════════════════════════════════════"
log "  Version:    ${VERSION} (${GIT_SHA})"
log "  Tarball:    dist/${INSTALLER_NAME}.tar.gz (${TARBALL_SIZE})"
log "  Installer:  dist/${INSTALLER_NAME}.run (${RUN_SIZE})"
log ""
log "  Deploy to NUC:"
log "    scp dist/${INSTALLER_NAME}.run gwipos@NUC_IP:/tmp/"
log "    ssh gwipos@NUC_IP 'sudo bash /tmp/${INSTALLER_NAME}.run'"
log "═══════════════════════════════════════════════════════"
