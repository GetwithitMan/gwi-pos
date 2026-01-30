---
skill: 111
title: Docker Deployment
status: DONE
depends_on: []
---

# Skill 111: Docker Deployment

> **Status:** DONE
> **Dependencies:** None
> **Last Updated:** 2026-01-30

## Overview

Production-ready Docker deployment configuration for local restaurant servers. Supports both SQLite (simple) and PostgreSQL (advanced) database backends.

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                    LOCAL SERVER (Ubuntu Mini PC)                 │
│                                                                 │
│  Docker Compose:                                                │
│  ┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐ │
│  │   gwi-pos       │  │   watchtower    │  │   backup        │ │
│  │   (Next.js)     │  │ (auto-updates)  │  │  (cron)         │ │
│  │   Port 3000     │  │                 │  │                 │ │
│  └────────┬────────┘  └─────────────────┘  └────────┬────────┘ │
│           │                                          │          │
│           ▼                                          ▼          │
│  ┌─────────────────────────────────────────────────────────────┐│
│  │                     /opt/gwi-pos/docker/                    ││
│  │  data/pos.db          backups/              config/         ││
│  └─────────────────────────────────────────────────────────────┘│
└─────────────────────────────────────────────────────────────────┘
```

## Files Created

| File | Purpose |
|------|---------|
| `docker/Dockerfile` | Multi-stage build for SQLite |
| `docker/Dockerfile.postgres` | Multi-stage build for PostgreSQL |
| `docker/docker-compose.yml` | SQLite deployment |
| `docker/docker-compose.postgres.yml` | PostgreSQL deployment |
| `docker/.env.example` | Environment variable template |
| `docker/.dockerignore` | Files to exclude from build |
| `docker/scripts/setup.sh` | Server setup automation |
| `docker/scripts/backup.sh` | Database backup script |
| `docker/scripts/restore.sh` | Database restore script |
| `docker/README.md` | Deployment documentation |
| `src/app/api/health/route.ts` | Health check endpoint |

## Deployment Options

### SQLite (Default)

Best for most single-location deployments:

```bash
cd /opt/gwi-pos/docker
docker compose up -d
```

**Pros:**
- Simple setup, no separate database service
- Lower resource usage
- Easy backup (single file)
- Faster for small datasets

**Cons:**
- Single-writer limitation
- Not ideal for 10+ concurrent terminals

### PostgreSQL

For high-volume locations:

```bash
cd /opt/gwi-pos/docker
docker compose -f docker-compose.postgres.yml up -d
```

**Pros:**
- Better concurrency
- Advanced querying features
- Better for large datasets

**Cons:**
- More complex setup
- Higher resource usage
- Requires database management

## Quick Start

```bash
# 1. Run setup script (installs Docker, creates user, etc.)
sudo ./scripts/setup.sh

# 2. Configure location
nano /opt/gwi-pos/docker/.env

# 3. Start system
sudo systemctl start gwi-pos

# 4. Access POS
open http://192.168.1.100:3000
```

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `LOCATION_ID` | Yes | Unique location identifier |
| `LOCATION_NAME` | Yes | Display name |
| `NEXTAUTH_SECRET` | Yes | Session encryption key |
| `TZ` | No | Timezone (default: America/New_York) |
| `PORT` | No | Server port (default: 3000) |
| `SYNC_ENABLED` | No | Enable cloud sync |
| `EVENTS_PROVIDER` | No | local, pusher, or ably |

## Services

### gwi-pos

Main application container:
- Next.js with standalone output
- Prisma ORM
- Port 3000 exposed
- Health check at `/api/health`
- Runs as non-root user

### watchtower

Automatic update service:
- Checks for updates hourly
- Pulls and restarts automatically
- Only updates labeled containers

### backup (optional profile)

Automated backup service:
- Runs daily at 2 AM
- 30-day retention
- SQLite online backup (safe)

## Health Check API

`GET /api/health`

```json
{
  "status": "healthy",
  "timestamp": "2026-01-30T12:00:00Z",
  "version": "1.0.0",
  "uptime": 3600,
  "database": "connected",
  "checks": {
    "database": true,
    "memory": true
  }
}
```

Status codes:
- `200` - Healthy or degraded
- `503` - Unhealthy (database down)

## Backup & Restore

### Manual Backup

```bash
./scripts/backup.sh           # Create backup
./scripts/backup.sh --list    # List backups
./scripts/backup.sh --cleanup # Backup + clean old
```

### Restore

```bash
./scripts/restore.sh                # Latest backup
./scripts/restore.sh <backup-file>  # Specific backup
```

## Systemd Service

The setup script creates `/etc/systemd/system/gwi-pos.service`:

```bash
systemctl start gwi-pos     # Start
systemctl stop gwi-pos      # Stop
systemctl restart gwi-pos   # Restart
systemctl status gwi-pos    # Status
systemctl enable gwi-pos    # Enable on boot
```

## Next.js Configuration

Required `next.config.ts` settings:

```typescript
const nextConfig: NextConfig = {
  output: 'standalone',  // Creates self-contained build
  poweredByHeader: false,
  reactStrictMode: true,
}
```

## Security Features

| Feature | Description |
|---------|-------------|
| Non-root user | Container runs as `nextjs:nodejs` |
| Health checks | Monitors app and database |
| UFW firewall | Only port 3000 exposed |
| Secrets in env | Not baked into image |
| httpOnly cookies | Session security |

## Hardware Requirements

| Component | Minimum | Recommended |
|-----------|---------|-------------|
| CPU | 2 cores | 4 cores |
| RAM | 4GB | 8GB |
| Storage | 32GB SSD | 64GB SSD |
| Network | 100Mbps | Gigabit |

**Recommended hardware:** Intel NUC, Beelink Mini S, similar mini PC

## Related Skills

| Skill | Relation |
|-------|----------|
| 110 | Real-time Events - Socket.io for local deployment |
| 102 | KDS Device Security - Device authentication |

## Testing Checklist

- [ ] Docker build succeeds
- [ ] Container starts and is healthy
- [ ] POS accessible at localhost:3000
- [ ] Login with default PIN works
- [ ] Database persists after restart
- [ ] Backup script creates valid backup
- [ ] Restore script works
- [ ] Watchtower detects updates
- [ ] Health endpoint returns correct status
- [ ] Systemd service starts on boot
