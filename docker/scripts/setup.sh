#!/bin/bash
# =============================================================================
# GWI POS - Initial Setup Script
# =============================================================================
# Run this script on a fresh server to set up the POS system.
#
# Usage:
#   chmod +x setup.sh
#   ./setup.sh
#
# Requirements:
#   - Ubuntu 22.04+ or Debian 12+
#   - Root or sudo access
#   - Internet connection
# =============================================================================

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Print with color
info() { echo -e "${BLUE}[INFO]${NC} $1"; }
success() { echo -e "${GREEN}[SUCCESS]${NC} $1"; }
warn() { echo -e "${YELLOW}[WARN]${NC} $1"; }
error() { echo -e "${RED}[ERROR]${NC} $1"; exit 1; }

# Check if running as root
check_root() {
    if [ "$EUID" -ne 0 ]; then
        error "Please run as root or with sudo"
    fi
}

# Detect OS
detect_os() {
    if [ -f /etc/os-release ]; then
        . /etc/os-release
        OS=$ID
        VERSION=$VERSION_ID
    else
        error "Cannot detect OS. Please install manually."
    fi
    info "Detected OS: $OS $VERSION"
}

# Install Docker
install_docker() {
    info "Installing Docker..."

    # Remove old versions
    apt-get remove -y docker docker-engine docker.io containerd runc 2>/dev/null || true

    # Install prerequisites
    apt-get update
    apt-get install -y \
        apt-transport-https \
        ca-certificates \
        curl \
        gnupg \
        lsb-release

    # Add Docker GPG key
    curl -fsSL https://download.docker.com/linux/$OS/gpg | gpg --dearmor -o /usr/share/keyrings/docker-archive-keyring.gpg

    # Add Docker repository
    echo \
        "deb [arch=$(dpkg --print-architecture) signed-by=/usr/share/keyrings/docker-archive-keyring.gpg] https://download.docker.com/linux/$OS \
        $(lsb_release -cs) stable" | tee /etc/apt/sources.list.d/docker.list > /dev/null

    # Install Docker
    apt-get update
    apt-get install -y docker-ce docker-ce-cli containerd.io docker-compose-plugin

    # Enable and start Docker
    systemctl enable docker
    systemctl start docker

    success "Docker installed successfully"
}

# Install Docker Compose (standalone)
install_docker_compose() {
    info "Installing Docker Compose..."

    COMPOSE_VERSION=$(curl -s https://api.github.com/repos/docker/compose/releases/latest | grep 'tag_name' | cut -d\" -f4)
    curl -L "https://github.com/docker/compose/releases/download/${COMPOSE_VERSION}/docker-compose-$(uname -s)-$(uname -m)" -o /usr/local/bin/docker-compose
    chmod +x /usr/local/bin/docker-compose

    success "Docker Compose installed: $COMPOSE_VERSION"
}

# Create gwi user
create_user() {
    info "Creating gwi user..."

    if id "gwi" &>/dev/null; then
        warn "User gwi already exists"
    else
        useradd -m -s /bin/bash gwi
        usermod -aG docker gwi
        success "User gwi created and added to docker group"
    fi
}

# Set up directory structure
setup_directories() {
    info "Setting up directory structure..."

    GWI_DIR="/opt/gwi-pos"

    mkdir -p $GWI_DIR/docker
    mkdir -p $GWI_DIR/docker/data
    mkdir -p $GWI_DIR/docker/backups
    mkdir -p $GWI_DIR/docker/config
    mkdir -p $GWI_DIR/docker/scripts

    # Copy files if we're in the docker directory
    if [ -f "docker-compose.yml" ]; then
        cp docker-compose.yml $GWI_DIR/docker/
        cp docker-compose.postgres.yml $GWI_DIR/docker/ 2>/dev/null || true
        cp .env.example $GWI_DIR/docker/
        cp Dockerfile* $GWI_DIR/docker/ 2>/dev/null || true
        cp -r scripts/* $GWI_DIR/docker/scripts/ 2>/dev/null || true
    fi

    # Set permissions
    chown -R gwi:gwi $GWI_DIR
    chmod +x $GWI_DIR/docker/scripts/*.sh 2>/dev/null || true

    success "Directories created at $GWI_DIR"
}

# Configure firewall
configure_firewall() {
    info "Configuring firewall..."

    if command -v ufw &> /dev/null; then
        ufw allow 3000/tcp comment "GWI POS"
        ufw allow 22/tcp comment "SSH"
        ufw --force enable
        success "UFW firewall configured"
    else
        warn "UFW not installed, skipping firewall configuration"
    fi
}

# Create systemd service
create_service() {
    info "Creating systemd service..."

    cat > /etc/systemd/system/gwi-pos.service << 'EOF'
[Unit]
Description=GWI POS System
Requires=docker.service
After=docker.service

[Service]
Type=oneshot
RemainAfterExit=yes
User=gwi
Group=gwi
WorkingDirectory=/opt/gwi-pos/docker
ExecStart=/usr/bin/docker compose up -d
ExecStop=/usr/bin/docker compose down
TimeoutStartSec=300

[Install]
WantedBy=multi-user.target
EOF

    systemctl daemon-reload
    systemctl enable gwi-pos.service

    success "Systemd service created"
}

# Generate secrets
generate_secrets() {
    info "Generating secrets..."

    ENV_FILE="/opt/gwi-pos/docker/.env"

    if [ -f "$ENV_FILE" ]; then
        warn ".env file already exists, skipping secret generation"
        return
    fi

    cp /opt/gwi-pos/docker/.env.example $ENV_FILE

    # Generate secure secret
    SECRET=$(openssl rand -base64 32)
    sed -i "s/your-secret-key-here-minimum-32-characters/$SECRET/" $ENV_FILE

    # Generate location ID
    LOCATION_ID="loc_$(openssl rand -hex 8)"
    sed -i "s/LOCATION_ID=loc_xxxxxxxxxxxxx/LOCATION_ID=$LOCATION_ID/" $ENV_FILE

    chown gwi:gwi $ENV_FILE
    chmod 600 $ENV_FILE

    success "Secrets generated. Edit /opt/gwi-pos/docker/.env to configure your location"
}

# Set up backup cron
setup_backup_cron() {
    info "Setting up automatic backups..."

    # Add cron job for gwi user
    (crontab -u gwi -l 2>/dev/null; echo "0 2 * * * /opt/gwi-pos/docker/scripts/backup.sh >> /opt/gwi-pos/docker/backups/backup.log 2>&1") | crontab -u gwi -

    success "Daily backup cron job created (2 AM)"
}

# Print final instructions
print_instructions() {
    echo ""
    echo "=============================================="
    echo -e "${GREEN}GWI POS Setup Complete!${NC}"
    echo "=============================================="
    echo ""
    echo "Next steps:"
    echo ""
    echo "1. Configure your location settings:"
    echo "   nano /opt/gwi-pos/docker/.env"
    echo ""
    echo "2. Start the POS system:"
    echo "   systemctl start gwi-pos"
    echo ""
    echo "3. Access the POS at:"
    echo "   http://$(hostname -I | awk '{print $1}'):3000"
    echo ""
    echo "Useful commands:"
    echo "  systemctl status gwi-pos    # Check status"
    echo "  systemctl restart gwi-pos   # Restart"
    echo "  systemctl stop gwi-pos      # Stop"
    echo "  docker compose logs -f      # View logs"
    echo ""
    echo "Backup location: /opt/gwi-pos/docker/backups/"
    echo ""
    echo "=============================================="
}

# Main execution
main() {
    echo ""
    echo "=============================================="
    echo "GWI POS - Server Setup"
    echo "=============================================="
    echo ""

    check_root
    detect_os

    # Check if Docker is already installed
    if command -v docker &> /dev/null; then
        info "Docker is already installed"
    else
        install_docker
    fi

    # Check if docker compose is available
    if ! docker compose version &> /dev/null; then
        install_docker_compose
    fi

    create_user
    setup_directories
    configure_firewall
    create_service
    generate_secrets
    setup_backup_cron

    print_instructions
}

main "$@"
