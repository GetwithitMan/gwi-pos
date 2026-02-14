# GWI POS - Docker Deployment Guide

This guide covers deploying GWI POS to a local restaurant server using Docker.

## Overview

GWI POS is designed for **local deployment** on a mini PC at each restaurant location. This provides:

- **Speed**: Sub-50ms response times on local network
- **Reliability**: Works 100% offline, no internet dependency
- **Real-time**: Instant KDS updates via local WebSocket
- **Simplicity**: Single server manages all terminals

## Prerequisites

### Hardware Requirements

| Component | Minimum | Recommended |
|-----------|---------|-------------|
| CPU | 2 cores | 4 cores |
| RAM | 4GB | 8GB |
| Storage | 32GB SSD | 64GB SSD |
| Network | 100Mbps | Gigabit |

### Recommended Hardware

- **Intel NUC** or similar mini PC
- **Beelink Mini S** (~$150) - great budget option
- Any small form factor PC with Ubuntu support

### Software Requirements

- Ubuntu 22.04 LTS (recommended) or Debian 12
- Docker Engine 24+
- Docker Compose 2.20+

## Quick Start

### 1. Run Setup Script

```bash
# Download and run the setup script
curl -fsSL https://raw.githubusercontent.com/your-org/gwi-pos/main/docker/scripts/setup.sh | sudo bash
```

Or manually:

```bash
# Clone the repository
git clone https://github.com/your-org/gwi-pos.git
cd gwi-pos/docker

# Run setup
chmod +x scripts/setup.sh
sudo ./scripts/setup.sh
```

### 2. Configure Your Location

```bash
# Edit the configuration
sudo nano /opt/gwi-pos/docker/.env
```

Required settings:

```env
LOCATION_ID=loc_your_location_id
LOCATION_NAME="Your Restaurant Name"
TZ=America/New_York
NEXTAUTH_SECRET=<generated-by-setup>
```

### 3. Start the System

```bash
# Start via systemd
sudo systemctl start gwi-pos

# Or via docker compose
cd /opt/gwi-pos/docker
docker compose up -d
```

### 4. Access the POS

Open a browser to: `http://<server-ip>:3000`

Default login PIN: `1234` (Manager)

## Deployment Options

### Standard Deployment (Neon PostgreSQL)

The app connects to Neon PostgreSQL (cloud database-per-venue). Configure `DATABASE_URL` and `DIRECT_URL` in your `.env` file.

```bash
docker compose up -d
```

### Self-Hosted PostgreSQL (Optional)

For deployments with a local PostgreSQL instance instead of Neon:

```bash
# Configure PostgreSQL password in .env
echo "POSTGRES_PASSWORD=$(openssl rand -base64 16)" >> .env

# Start with local PostgreSQL
docker compose -f docker-compose.postgres.yml up -d
```

## Directory Structure

After setup, the directory structure is:

```
/opt/gwi-pos/
├── docker/
│   ├── docker-compose.yml       # Main compose file (Neon PostgreSQL)
│   ├── docker-compose.postgres.yml  # Self-hosted PostgreSQL option
│   ├── Dockerfile               # Production build
│   ├── .env                     # Your configuration
│   ├── .env.example             # Configuration template
│   ├── backups/                 # Automated backups
│   ├── config/                  # Optional config overrides
│   └── scripts/
│       ├── setup.sh             # Initial setup
│       ├── backup.sh            # Manual backup
│       └── restore.sh           # Restore from backup
```

## Management Commands

### Service Control

```bash
# Start the POS
sudo systemctl start gwi-pos

# Stop the POS
sudo systemctl stop gwi-pos

# Restart the POS
sudo systemctl restart gwi-pos

# Check status
sudo systemctl status gwi-pos
```

### Docker Commands

```bash
cd /opt/gwi-pos/docker

# View logs
docker compose logs -f

# View specific service logs
docker compose logs -f gwi-pos

# Restart containers
docker compose restart

# Stop everything
docker compose down

# Update to latest version
docker compose pull
docker compose up -d
```

### Database Management

```bash
cd /opt/gwi-pos/docker

# Create manual backup
./scripts/backup.sh

# List backups
./scripts/backup.sh --list

# Restore from latest backup
./scripts/restore.sh

# Restore from specific backup
./scripts/restore.sh backups/pos-20240115-020000.db.gz
```

## Automatic Updates (Watchtower)

The deployment includes Watchtower for automatic updates:

- Checks for updates every hour (configurable)
- Automatically pulls and restarts with new versions
- Creates backups before updates

Configure update frequency in `.env`:

```env
# Check every 6 hours (21600 seconds)
WATCHTOWER_INTERVAL=21600
```

To disable automatic updates:

```bash
# Stop watchtower
docker compose stop watchtower
```

## Automatic Backups

Backups are configured to run automatically:

- **Schedule**: Daily at 2 AM (configurable)
- **Retention**: 30 days (configurable)
- **Location**: `/opt/gwi-pos/docker/backups/`

Configure in `.env`:

```env
# Backup at 3 AM
BACKUP_SCHEDULE=0 3 * * *

# Keep 60 days of backups
BACKUP_RETENTION_DAYS=60
```

### Enable Backup Service

The backup service runs as a separate container:

```bash
# Start with backup service
docker compose --profile backup up -d
```

## Network Configuration

### Static IP (Recommended)

Assign a static IP to the server for reliable terminal connections:

```bash
# Edit netplan configuration
sudo nano /etc/netplan/00-installer-config.yaml
```

```yaml
network:
  version: 2
  ethernets:
    eth0:
      addresses:
        - 192.168.1.100/24
      gateway4: 192.168.1.1
      nameservers:
        addresses:
          - 8.8.8.8
          - 8.8.4.4
```

```bash
sudo netplan apply
```

### Firewall

The setup script configures UFW. Manual configuration:

```bash
sudo ufw allow 3000/tcp comment "GWI POS"
sudo ufw allow 22/tcp comment "SSH"
sudo ufw enable
```

## Printer Configuration

Thermal and kitchen printers connect via network:

1. Configure printer IP addresses in POS admin: `/settings/hardware`
2. Ensure printers are on the same network subnet
3. Common printer ports: 9100 (raw), 515 (LPR)

### Printer Firewall Rules

If using a separate printer VLAN:

```bash
# Allow outbound to printers
sudo ufw allow out to 192.168.2.0/24 port 9100
```

## Troubleshooting

### POS Won't Start

```bash
# Check container status
docker compose ps

# View detailed logs
docker compose logs gwi-pos

# Check disk space
df -h

# Check memory
free -m
```

### Database Issues

```bash
# Check database integrity
psql "$DATABASE_URL" -c "SELECT 1;"  # Verify database connectivity

# Restore from backup
./scripts/restore.sh
```

### Network Issues

```bash
# Check if port is listening
ss -tlnp | grep 3000

# Test from terminal device
curl http://192.168.1.100:3000/api/health
```

### Container Won't Build

```bash
# Clear Docker cache and rebuild
docker compose build --no-cache

# Check for disk space
docker system prune -a
```

## Security Considerations

### Default Credentials

**Change these immediately after setup:**

| Role | Default PIN | Description |
|------|-------------|-------------|
| Manager | 1234 | Full access |
| Server | 2345 | Order entry |
| Bartender | 3456 | Bar access |

### Network Security

1. **Isolate POS network**: Use a separate VLAN for POS devices
2. **Disable internet access**: Block outbound traffic (optional)
3. **Use WPA3**: Secure WiFi for wireless terminals
4. **Firewall**: Only expose required ports

### Physical Security

1. Lock the server in a secure location
2. Use BIOS password
3. Enable full disk encryption (LUKS)

## Monitoring

### Health Check Endpoint

The POS provides a health endpoint:

```bash
curl http://localhost:3000/api/health
```

Response:
```json
{
  "status": "healthy",
  "timestamp": "2024-01-15T12:00:00Z",
  "version": "1.0.0",
  "database": "connected"
}
```

### Log Monitoring

```bash
# Real-time logs
docker compose logs -f --tail=100

# Filter by time
docker compose logs --since="2024-01-15T12:00:00"
```

## Upgrading

### Manual Update

```bash
cd /opt/gwi-pos/docker

# Create backup first
./scripts/backup.sh

# Pull latest images
docker compose pull

# Restart with new version
docker compose up -d
```

### Rollback

If an update causes issues:

```bash
# Stop current version
docker compose down

# Restore database
./scripts/restore.sh

# Use previous image tag
# Edit docker-compose.yml to specify version
docker compose up -d
```

## Support

- **Documentation**: [docs.gwipos.com](https://docs.gwipos.com)
- **Issues**: [GitHub Issues](https://github.com/your-org/gwi-pos/issues)
- **Email**: support@gwipos.com

## License

Copyright (c) 2024 GWI POS. All rights reserved.
