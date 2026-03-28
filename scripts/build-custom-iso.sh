#!/usr/bin/env bash
# GWI POS Custom Ubuntu ISO Builder
# Produces a custom Ubuntu 24.04 ISO with GWI POS installer pre-baked
# Output: dist/gwi-pos-ubuntu-VERSION.iso
#
# Prerequisites (on build machine):
# - Ubuntu/Debian with: xorriso, squashfs-tools, genisoimage
# - wget or curl
# - sudo access
#
# The resulting ISO:
# - Auto-installs Ubuntu 24.04 (unattended)
# - Configures 'gwipos' user with auto-login
# - Runs GWI POS installer on first boot
# - Prompts for 6-digit registration code (or manual setup)

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
DIST_DIR="$PROJECT_DIR/dist"
ISO_WORK="$DIST_DIR/iso-work"
UBUNTU_VERSION="24.04.1"
UBUNTU_ISO_URL="https://releases.ubuntu.com/${UBUNTU_VERSION}/ubuntu-${UBUNTU_VERSION}-live-server-amd64.iso"
UBUNTU_ISO_CACHE="$HOME/.cache/gwi-pos-build/ubuntu-${UBUNTU_VERSION}-live-server-amd64.iso"

# Read version
VERSION=$(node -e "console.log(require('./package.json').version)" 2>/dev/null || echo "0.0.0")
OUTPUT_ISO="$DIST_DIR/gwi-pos-ubuntu-${VERSION}.iso"

log() { echo "[$(date -u +%FT%TZ)] ISO-BUILD: $*"; }
err() { echo "[$(date -u +%FT%TZ)] ISO-BUILD ERROR: $*" >&2; }

# Check prerequisites
for cmd in xorriso mksquashfs genisoimage wget; do
  if ! command -v "$cmd" &>/dev/null; then
    err "Missing required tool: $cmd"
    err "Install with: sudo apt-get install -y xorriso squashfs-tools genisoimage wget"
    exit 1
  fi
done

# Clean up
rm -rf "$ISO_WORK"
mkdir -p "$ISO_WORK" "$DIST_DIR" "$(dirname "$UBUNTU_ISO_CACHE")"

# ── Step 1: Download Ubuntu ISO ──────────────────────────────────────
log "Step 1: Getting Ubuntu ${UBUNTU_VERSION} ISO..."
if [[ -f "$UBUNTU_ISO_CACHE" ]]; then
  log "Using cached ISO"
else
  log "Downloading Ubuntu ISO (this may take a while)..."
  wget -q --show-progress "$UBUNTU_ISO_URL" -O "$UBUNTU_ISO_CACHE" || {
    err "Failed to download Ubuntu ISO"
    exit 1
  }
fi

# ── Step 2: Extract ISO ──────────────────────────────────────────────
log "Step 2: Extracting ISO..."
mkdir -p "$ISO_WORK/source"
xorriso -osirrox on -indev "$UBUNTU_ISO_CACHE" -extract / "$ISO_WORK/source" 2>/dev/null || {
  # Fallback: mount and copy
  mkdir -p /tmp/gwi-iso-mount
  sudo mount -o loop "$UBUNTU_ISO_CACHE" /tmp/gwi-iso-mount
  cp -a /tmp/gwi-iso-mount/* "$ISO_WORK/source/"
  sudo umount /tmp/gwi-iso-mount
}

# ── Step 3: Create autoinstall config ─────────────────────────────────
log "Step 3: Creating autoinstall configuration..."
mkdir -p "$ISO_WORK/source/autoinstall"

cat > "$ISO_WORK/source/autoinstall/user-data" <<'USERDATA'
#cloud-config
autoinstall:
  version: 1
  locale: en_US.UTF-8
  keyboard:
    layout: us

  # Auto-select the largest disk
  storage:
    layout:
      name: lvm
      sizing-policy: all

  # Network: DHCP on all interfaces
  network:
    network:
      version: 2
      ethernets:
        id0:
          match:
            name: "en*"
          dhcp4: true
        id1:
          match:
            name: "eth*"
          dhcp4: true

  # Create gwipos user with auto-login
  identity:
    hostname: gwi-pos-nuc
    username: gwipos
    # Password: 123 (must be changed on first login — see chpasswd below)
    password: "$6$rounds=4096$gwi$5rGzp5mTYQj3GmXKGnQH.BF3YJqKZ3L2qJGhQOxWEI8KZ0wZ8rFb3gXQ8z.YL9UpZ7e.K4QJ5N8iJD.Jf3Yp/"

  # Force password change on first login
  chpasswd:
    expire: true

  # SSH
  ssh:
    install-server: true
    allow-pw: true

  # Packages to install
  packages:
    - openssh-server
    - curl
    - git
    - jq
    - openssl
    - chrony
    - ufw
    - htop
    - unzip
    - net-tools
    - lsb-release
    - apt-transport-https
    - ca-certificates
    - gnupg

  # Late commands run after install, before first reboot
  late-commands:
    # Copy GWI installer to target
    - mkdir -p /target/opt/gwi-pos
    - cp -a /cdrom/gwi-installer/* /target/opt/gwi-pos/ 2>/dev/null || true

    # Create first-boot service that runs the GWI installer
    - |
      cat > /target/etc/systemd/system/gwi-first-boot.service <<'SVC'
      [Unit]
      Description=GWI POS First Boot Installer
      After=network-online.target
      Wants=network-online.target
      ConditionPathExists=!/opt/gwi-pos/.first-boot-done

      [Service]
      Type=oneshot
      ExecStart=/opt/gwi-pos/first-boot.sh
      RemainAfterExit=yes
      StandardOutput=journal+console
      StandardError=journal+console
      TimeoutStartSec=3600

      [Install]
      WantedBy=multi-user.target
      SVC
    - curtin in-target -- systemctl enable gwi-first-boot.service

    # Enable auto-login for gwipos user (console)
    - mkdir -p /target/etc/systemd/system/getty@tty1.service.d
    - |
      cat > /target/etc/systemd/system/getty@tty1.service.d/override.conf <<'AUTOLOGIN'
      [Service]
      ExecStart=
      ExecStart=-/sbin/agetty --autologin gwipos --noclear %I $TERM
      AUTOLOGIN

    # Set timezone
    - curtin in-target -- timedatectl set-timezone America/Denver

    # Disable unattended-upgrades during first boot (installer handles this)
    - curtin in-target -- systemctl disable unattended-upgrades.service || true
USERDATA

cat > "$ISO_WORK/source/autoinstall/meta-data" <<'METADATA'
instance-id: gwi-pos-autoinstall
METADATA

# ── Step 4: Create first-boot script ─────────────────────────────────
log "Step 4: Creating first-boot installer script..."
mkdir -p "$ISO_WORK/source/gwi-installer"

cat > "$ISO_WORK/source/gwi-installer/first-boot.sh" <<'FIRSTBOOT'
#!/usr/bin/env bash
# GWI POS First Boot Script
# Runs on first boot after Ubuntu auto-install
# Downloads and runs the latest GWI POS installer
set -euo pipefail

LOG="/var/log/gwi-first-boot.log"
exec > >(tee -a "$LOG") 2>&1

echo ""
echo "╔════════════════════════════════════════════════════╗"
echo "║                                                    ║"
echo "║     GWI POS — First Boot Auto-Configuration        ║"
echo "║                                                    ║"
echo "╚════════════════════════════════════════════════════╝"
echo ""
echo "[$(date)] Starting first-boot setup..."

# Wait for network
echo "Waiting for network..."
for i in $(seq 1 30); do
  if ping -c1 -W2 8.8.8.8 &>/dev/null; then
    echo "Network available"
    break
  fi
  echo "  Attempt $i/30..."
  sleep 2
done

# Check if offline installer is bundled
if [[ -f /opt/gwi-pos/gwi-pos-offline-installer.run ]]; then
  echo "Offline installer found — running..."
  chmod +x /opt/gwi-pos/gwi-pos-offline-installer.run
  bash /opt/gwi-pos/gwi-pos-offline-installer.run
elif [[ -f /opt/gwi-pos/installer.run ]]; then
  echo "Installer found — running..."
  chmod +x /opt/gwi-pos/installer.run
  bash /opt/gwi-pos/installer.run
else
  echo "No bundled installer found — downloading latest..."
  # Download from MC or GitHub
  MC_URL="${MC_URL:-https://mc.getwithitpos.com}"
  curl -fsSL "${MC_URL}/api/fleet/installer/latest" -o /opt/gwi-pos/installer.run || {
    echo "ERROR: Failed to download installer"
    echo "Please run the installer manually:"
    echo "  curl -fsSL ${MC_URL}/api/fleet/installer/latest -o /opt/gwi-pos/installer.run"
    echo "  sudo bash /opt/gwi-pos/installer.run"
    exit 1
  }
  chmod +x /opt/gwi-pos/installer.run
  bash /opt/gwi-pos/installer.run
fi

# Mark first boot as done
touch /opt/gwi-pos/.first-boot-done
echo ""
echo "[$(date)] First boot setup complete!"
echo "The NUC will now reboot to apply all changes."
echo ""
sleep 5
reboot
FIRSTBOOT
chmod +x "$ISO_WORK/source/gwi-installer/first-boot.sh"

# ── Step 5: Bundle the offline installer (if available) ───────────────
log "Step 5: Bundling offline installer (if available)..."
OFFLINE_INSTALLER=$(ls -t "$DIST_DIR"/gwi-pos-offline-installer-*.run 2>/dev/null | head -1)
if [[ -n "$OFFLINE_INSTALLER" ]]; then
  cp "$OFFLINE_INSTALLER" "$ISO_WORK/source/gwi-installer/gwi-pos-offline-installer.run"
  log "Bundled offline installer: $(basename "$OFFLINE_INSTALLER")"
else
  log "No offline installer found — ISO will download on first boot"
  # Copy the online installer as fallback
  if [[ -f "$PROJECT_DIR/public/installer.run" ]]; then
    cp "$PROJECT_DIR/public/installer.run" "$ISO_WORK/source/gwi-installer/installer.run"
    # Copy modules
    cp -a "$PROJECT_DIR/public/installer-modules" "$ISO_WORK/source/gwi-installer/" 2>/dev/null || true
  fi
fi

# ── Step 6: Modify GRUB for autoinstall ───────────────────────────────
log "Step 6: Configuring GRUB for autoinstall..."

# Find and modify grub.cfg
GRUB_CFG=$(find "$ISO_WORK/source" -name "grub.cfg" -path "*/boot/grub/*" | head -1)
if [[ -n "$GRUB_CFG" ]]; then
  # Add autoinstall entry as default
  cat > "$GRUB_CFG" <<'GRUBCFG'
set timeout=10
set default=0

menuentry "GWI POS — Auto Install Ubuntu" {
    linux /casper/vmlinuz autoinstall ds=nocloud\;s=/cdrom/autoinstall/ quiet ---
    initrd /casper/initrd
}

menuentry "GWI POS — Install Ubuntu (Manual)" {
    linux /casper/vmlinuz quiet ---
    initrd /casper/initrd
}

menuentry "Boot from Hard Disk" {
    exit
}
GRUBCFG
  log "GRUB configured"
else
  log "WARNING: grub.cfg not found — manual GRUB config may be needed"
fi

# ── Step 7: Rebuild ISO ───────────────────────────────────────────────
log "Step 7: Building custom ISO..."

cd "$ISO_WORK/source"
xorriso -as mkisofs \
  -r -V "GWI-POS-INSTALLER" \
  -o "$OUTPUT_ISO" \
  -J -joliet-long \
  -b boot/grub/i386-pc/eltorito.img \
  -c boot.catalog \
  -no-emul-boot -boot-load-size 4 -boot-info-table \
  --grub2-boot-info --grub2-mbr /usr/lib/grub/i386-pc/boot_hybrid.img \
  -eltorito-alt-boot \
  -e EFI/boot/bootx64.efi -no-emul-boot \
  -isohybrid-gpt-basdat \
  . 2>/dev/null || {
    # Fallback: simpler ISO creation
    genisoimage -r -V "GWI-POS-INSTALLER" -cache-inodes \
      -J -l -b boot/grub/i386-pc/eltorito.img \
      -c boot.catalog -no-emul-boot -boot-load-size 4 -boot-info-table \
      -o "$OUTPUT_ISO" . 2>/dev/null || {
        err "ISO creation failed — try installing xorriso"
        exit 1
      }
  }

# ── Step 8: Make ISO hybrid (bootable from USB) ──────────────────────
log "Step 8: Making ISO hybrid-bootable..."
if command -v isohybrid &>/dev/null; then
  isohybrid --uefi "$OUTPUT_ISO" 2>/dev/null || true
fi

# ── Cleanup ───────────────────────────────────────────────────────────
rm -rf "$ISO_WORK"

ISO_SIZE=$(du -sh "$OUTPUT_ISO" | cut -f1)

log ""
log "═══════════════════════════════════════════════════════"
log "  Custom Ubuntu ISO Built Successfully!"
log "═══════════════════════════════════════════════════════"
log "  Version:  ${VERSION}"
log "  ISO:      dist/$(basename "$OUTPUT_ISO") (${ISO_SIZE})"
log ""
log "  Write to USB:"
log "    sudo dd if=$OUTPUT_ISO of=/dev/sdX bs=4M status=progress"
log "    # or use Balena Etcher / Rufus"
log ""
log "  Boot the NUC from USB → auto-installs Ubuntu + GWI POS"
log "═══════════════════════════════════════════════════════"
