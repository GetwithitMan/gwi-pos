# GWI POS Hardware & Infrastructure Guide

> **Mission-Critical "Fortress" Architecture**
>
> This document is the single source of truth for deploying GWI POS at a restaurant/bar location. Building a mission-critical POS requires a "fortress" mindset - local-first resilience, network segmentation, and rapid recovery procedures.

---

## Table of Contents

1. [System Architecture](#system-architecture)
2. [Core Server (The Brain)](#core-server-the-brain)
3. [Network Topology (UniFi Setup)](#network-topology-unifi-setup)
4. [Hardware Bill of Materials](#hardware-bill-of-materials)
5. [Deployment Workflow](#deployment-workflow)
6. [Printer Configuration](#printer-configuration)
7. [KDS Configuration](#kds-configuration)
8. [Physical Installation](#physical-installation)
9. [Security Checklist](#security-checklist)
10. [Failure & Recovery Procedures](#failure--recovery-procedures)
11. [Maintenance & Monitoring](#maintenance--monitoring)
12. [Cost Estimates](#cost-estimates)

---

## System Architecture

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                        CLOUD (Optional - For Sync)                           │
│              Vercel + PostgreSQL (Neon) + Admin Console                      │
│                    Only used for reporting & licensing                       │
└─────────────────────────────────────────────────────────────────────────────┘
                                    ▲
                                    │ Background Sync (when online)
                                    │ NOT required for floor operations
                                    ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                    LOCAL SERVER - THE FORTRESS                               │
│           Intel NUC / Beelink Mini PC + UPS Battery Backup                  │
│                                                                             │
│   ┌─────────────┐  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐       │
│   │   Next.js   │  │ PostgreSQL  │  │   Redis     │  │  Socket.io  │       │
│   │   (Docker)  │  │  (Docker)   │  │  (Docker)   │  │  (< 10ms)   │       │
│   └─────────────┘  └─────────────┘  └─────────────┘  └─────────────┘       │
│                                                                             │
│   ┌─────────────┐  ┌─────────────┐                                         │
│   │  Watchtower │  │ Cloud Sync  │  ← Background worker pushes to cloud    │
│   │(Auto-update)│  │   Worker    │                                         │
│   └─────────────┘  └─────────────┘                                         │
└─────────────────────────────────────────────────────────────────────────────┘
                                    │
                    UNIFI DREAM MACHINE PRO
                    ┌───────────────┼───────────────┐
                    ▼               ▼               ▼
            ┌─────────────┐ ┌─────────────┐ ┌─────────────┐
            │  VLAN 10    │ │  VLAN 20    │ │  VLAN 30    │
            │  POS-CORE   │ │  POS-PRINT  │ │   GUEST     │
            │Server,Terms,│ │  Printers   │ │Customer WiFi│
            │    KDS      │ │  (Isolated) │ │ (Isolated)  │
            └──────┬──────┘ └──────┬──────┘ └─────────────┘
                   │               │
    ┌──────────────┼───────────────┼──────────────┐
    ▼              ▼               ▼              ▼
┌────────┐  ┌────────────┐  ┌──────────┐   ┌──────────┐
│  POS   │  │    KDS     │  │ Kitchen  │   │ Receipt  │
│Terminals│  │  Tablets   │  │ Printer  │   │ Printer  │
│ (iPads) │  │(Fire/iPad) │  │ (Impact) │   │(Thermal) │
└────────┘  └────────────┘  └──────────┘   └──────────┘
```

### Why Local-First?

| Benefit | Details |
|---------|---------|
| **Speed** | < 10ms response (vs 100-500ms cloud) |
| **Reliability** | Works 100% when internet is down |
| **Real-time** | Socket.io on local network = instant KDS updates |
| **Security** | No external attack surface during operations |

---

## Core Server (The Brain)

The server handles ALL traffic without needing internet for floor operations. Cloud sync happens in the background.

### Recommended Hardware

| Component | Minimum | Recommended | Notes |
|-----------|---------|-------------|-------|
| **Device** | Intel NUC 12 | Beelink SER5 Pro | Fanless/quiet preferred |
| **CPU** | Intel i5 / Ryzen 5 | Intel i7 / Ryzen 7 | 8+ cores ideal |
| **RAM** | 8GB DDR4 | 16GB DDR4 | PostgreSQL + Redis need headroom |
| **Storage** | 128GB NVMe SSD | 256GB NVMe SSD | Fast writes for transactions |
| **Network** | Gigabit Ethernet | Gigabit Ethernet | WiFi disabled |
| **OS** | Ubuntu 24.04 LTS | Ubuntu 24.04 LTS | Headless (no desktop) |

### Recommended Mini PCs

| Model | CPU | RAM | Storage | Price | Notes |
|-------|-----|-----|---------|-------|-------|
| **Beelink SER5 Pro** | Ryzen 7 5800H | 16GB | 500GB | $449 | Best value |
| **Intel NUC 12 Pro** | i7-1260P | 16GB | 256GB | $599 | Reliable, good support |
| **Minisforum UM790 Pro** | Ryzen 9 7940HS | 32GB | 512GB | $649 | Overkill but future-proof |
| **Beelink EQ12** | Intel N100 | 16GB | 500GB | $259 | Budget option (small venues) |

### Power Protection (CRITICAL)

> **WARNING**: Power flickers WILL corrupt your database without UPS protection!

| Model | Capacity | Runtime | Price | Notes |
|-------|----------|---------|-------|-------|
| **APC Back-UPS 600VA** | 600VA/330W | 5-10 min | $79 | Minimum for small setup |
| **APC Back-UPS Pro 1500VA** | 1500VA/900W | 15-20 min | $249 | Recommended - covers server + switch |
| **CyberPower CP1500PFCLCD** | 1500VA/1000W | 12-15 min | $229 | Alternative, pure sine wave |

**UPS Must Protect:**
- Local server (CRITICAL)
- Network switch (CRITICAL)
- Dream Machine (CRITICAL)
- Receipt printer (recommended)

### Software Stack

```
┌─────────────────────────────────────────────────┐
│              Docker Engine                       │
├─────────────┬─────────────┬─────────────────────┤
│   Next.js   │ PostgreSQL  │   Redis (Cache)     │
│   App       │  Database   │                     │
├─────────────┼─────────────┼─────────────────────┤
│  Socket.io  │  Watchtower │   Cloud Sync        │
│  (Real-time)│ (Auto-update)│   Worker           │
└─────────────┴─────────────┴─────────────────────┘
```

---

## Network Topology (UniFi Setup)

Network segmentation prevents guest WiFi from affecting POS operations and provides security isolation.

### VLAN Configuration

| VLAN ID | Name | Subnet | Purpose | Internet Access |
|---------|------|--------|---------|-----------------|
| **10** | POS-CORE | 192.168.10.0/24 | Server, Terminals, KDS | Sync only (optional) |
| **20** | POS-PRINT | 192.168.20.0/24 | Printers only | None |
| **30** | GUEST | 192.168.30.0/24 | Customer WiFi | Yes (throttled) |
| **40** | MGMT | 192.168.40.0/24 | Admin access | Yes |

### Static IP Assignments

#### VLAN 10 - POS-CORE (192.168.10.x)

| IP Address | Device | MAC Reservation |
|------------|--------|-----------------|
| 192.168.10.1 | Gateway (UniFi) | - |
| 192.168.10.10 | **Local Server** | Required |
| 192.168.10.20 | POS Terminal 1 | Recommended |
| 192.168.10.21 | POS Terminal 2 | Recommended |
| 192.168.10.22 | POS Terminal 3 | Recommended |
| 192.168.10.23 | POS Terminal 4 | Recommended |
| 192.168.10.24-29 | Additional Terminals | As needed |
| 192.168.10.30 | KDS - Kitchen | Required |
| 192.168.10.31 | KDS - Bar | Required |
| 192.168.10.32 | KDS - Expo | Required |
| 192.168.10.33-39 | Additional KDS | As needed |

#### VLAN 20 - POS-PRINT (192.168.20.x)

| IP Address | Device | Notes |
|------------|--------|-------|
| 192.168.20.1 | Gateway | - |
| 192.168.20.100 | Kitchen Printer 1 (Impact) | Primary hot line |
| 192.168.20.101 | Kitchen Printer 2 (Impact) | Cold/prep line |
| 192.168.20.102 | Bar Printer (Thermal) | Drink tickets |
| 192.168.20.103 | Expo Printer (Impact) | Expeditor station |
| 192.168.20.110 | Receipt Printer 1 (Thermal) | Front register |
| 192.168.20.111 | Receipt Printer 2 (Thermal) | Bar register |

### UniFi Controller Setup

#### 1. Create Networks (VLANs)

```
Settings → Networks → Create New Network

Network 1: POS-CORE
  Name: POS-CORE
  VLAN ID: 10
  Gateway/Subnet: 192.168.10.1/24
  DHCP Range: 192.168.10.100-199 (for unknown devices)
  DHCP Name Server: Auto

Network 2: POS-PRINT
  Name: POS-PRINT
  VLAN ID: 20
  Gateway/Subnet: 192.168.20.1/24
  DHCP Mode: None (Static only!)

Network 3: GUEST
  Name: Guest WiFi
  VLAN ID: 30
  Gateway/Subnet: 192.168.30.1/24
  DHCP Range: 192.168.30.10-250
  Purpose: Guest Hotspot
  Guest Policies:
    - Client Isolation: Enabled
    - Bandwidth Limit: 25 Mbps down / 10 Mbps up
```

#### 2. Create WiFi Networks

```
Settings → WiFi → Create New

WiFi 1: POS-CORE
  Name: [Restaurant]-POS
  Password: [Strong 20+ char password]
  Network: POS-CORE (VLAN 10)
  Band: 5GHz only (less interference)
  Security: WPA3
  Hide SSID: Optional (security through obscurity)

WiFi 2: Guest
  Name: [Restaurant]-Guest
  Password: [Simple password or open]
  Network: GUEST (VLAN 30)
  Band: 2.4GHz + 5GHz
  Security: WPA2 (compatibility)
```

#### 3. Firewall Rules

```
Settings → Firewall & Security → Create Rules

Rule 1: Block Guest → POS
  Type: LAN In
  Source: GUEST network
  Destination: POS-CORE network
  Action: Block

Rule 2: Block Guest → Print
  Type: LAN In
  Source: GUEST network
  Destination: POS-PRINT network
  Action: Block

Rule 3: Allow POS → Print
  Type: LAN In
  Source: POS-CORE network
  Destination: POS-PRINT network
  Ports: 9100 (raw print), 631 (IPP)
  Action: Allow

Rule 4: Allow POS → Internet (Sync only)
  Type: LAN Out
  Source: POS-CORE network
  Destination: Any
  Action: Allow
  Note: Can restrict to specific IPs if paranoid
```

#### 4. Static IP Reservations

```
For each device:
1. Connect device to network
2. Clients → Find device by MAC
3. Click → Settings → Use Fixed IP Address
4. Enter assigned IP from table above
5. Save
```

---

## Hardware Bill of Materials

### Network Infrastructure

| Item | Model | Qty | Price | Purpose |
|------|-------|-----|-------|---------|
| **Router/Firewall** | UniFi Dream Machine Pro | 1 | $379 | Gateway, VLANs, controller |
| **PoE Switch** | UniFi Switch Pro 24 PoE | 1 | $699 | Powers APs, connects devices |
| **Access Point** | UniFi U6 Pro | 2-3 | $159 ea | WiFi coverage |
| **Patch Panel** | 24-port Cat6 | 1 | $49 | Clean cable management |

**Alternative (Smaller Venues):**
| Item | Model | Qty | Price |
|------|-------|-----|-------|
| Router | UniFi Dream Machine SE | 1 | $499 |
| Switch | UniFi Switch Lite 16 PoE | 1 | $199 |
| AP | UniFi U6 Lite | 1-2 | $99 ea |

### POS Terminals

| Item | Model | Qty | Price | Notes |
|------|-------|-----|-------|-------|
| **Tablet** | iPad 10th Gen (10.9") | 2-4 | $449 ea | Recommended |
| **Tablet** | Samsung Galaxy Tab A8 | 2-4 | $229 ea | Budget alternative |
| **Stand** | Heckler WindFall Stand | 2-4 | $99 ea | Secure, sleek |
| **Stand** | Bouncepad Counter | 2-4 | $149 ea | Premium option |
| **Card Reader** | Square Terminal | 2-4 | $299 ea | All-in-one |
| **Card Reader** | Square Reader | 2-4 | $49 ea | Budget (needs phone/tablet) |

### Kitchen Display System (KDS)

| Item | Model | Qty | Price | Notes |
|------|-------|-----|-------|-------|
| **Display** | Samsung Smart Monitor M5 22" | 2-3 | $199 ea | Built-in browser |
| **Tablet** | Amazon Fire HD 10 | 2-3 | $149 ea | Budget option |
| **Tablet** | iPad 10th Gen | 2-3 | $449 ea | Premium option |
| **Wall Mount** | VESA 100x100 bracket | 2-3 | $25 ea | Standard mount |
| **PoE Adapter** | PoE to USB-C splitter | 2-3 | $35 ea | **Prevents battery swelling!** |
| **Bump Bar** | Logic Controls KB1700 | 1-2 | $149 ea | Physical bump buttons |

> **IMPORTANT**: Use PoE adapters for KDS tablets! Constant charging causes battery swelling. PoE provides clean power without battery degradation.

### Printers

| Item | Model | Qty | Price | Purpose |
|------|-------|-----|-------|---------|
| **Kitchen** | Epson TM-U220B (Impact) | 2-3 | $299 ea | Heat resistant, 2-color ribbon |
| **Receipt** | Epson TM-T88VII (Thermal) | 1-2 | $399 ea | Fast, quiet, Ethernet/USB/BT |
| **Bar** | Epson TM-T88VII or TM-U220B | 1 | $299-399 | Depends on environment |
| **Label** | Dymo LabelWriter 450 | 1 | $129 | To-go labels (optional) |

**Printer Notes:**
- **TM-U220B (Impact)**: Ribbons don't fade in heat, 2-color for modifiers
- **TM-T88VII (Thermal)**: Fast, quiet, best for customer-facing
- All printers MUST have Ethernet interface (not USB-only)

### Cash Handling

| Item | Model | Qty | Price | Notes |
|------|-------|-----|-------|-------|
| **Cash Drawer** | Star Micronics CD3-1616 | 1-2 | $129 ea | Printer-driven (RJ11) |
| **Cash Drawer** | APG Vasario VB320 | 1-2 | $99 ea | Budget alternative |
| **Drawer Cable** | RJ12 to printer | 1-2 | $15 ea | Opens via printer kick |

### Cabling & Accessories

| Item | Qty | Price | Notes |
|------|-----|-------|-------|
| Cat6 Ethernet (various lengths) | 20+ | $5-15 ea | All wired connections |
| Cat6 Keystone Jacks | 10+ | $3 ea | Wall outlets |
| Cable ties / Velcro | 1 lot | $30 | Cable management |
| Ethernet crimping kit | 1 | $40 | For custom lengths |
| Label maker | 1 | $30 | Cable labeling |

---

## Deployment Workflow

### Docker Compose Configuration

```yaml
# /opt/gwi-pos/docker/docker-compose.yml

version: '3.8'

services:
  # Main POS Application
  pos-app:
    image: ghcr.io/gwi-pos/app:latest
    container_name: gwi-pos
    restart: always
    ports:
      - "3000:3000"      # HTTP
      - "3001:3001"      # WebSocket
    environment:
      - NODE_ENV=production
      - DATABASE_URL=postgresql://pos:${DB_PASSWORD}@db:5432/gwi_pos
      - REDIS_URL=redis://redis:6379
      - NEXTAUTH_SECRET=${NEXTAUTH_SECRET}
      - NEXTAUTH_URL=http://192.168.10.10:3000
      - NEXT_PUBLIC_WS_URL=ws://192.168.10.10:3001
      - LOCATION_ID=${LOCATION_ID}
      - LOCATION_NAME=${LOCATION_NAME}
      - TZ=${TZ:-America/New_York}
    depends_on:
      - db
      - redis
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:3000/api/health"]
      interval: 30s
      timeout: 10s
      retries: 3
    networks:
      - pos-network
    labels:
      - "com.centurylinklabs.watchtower.enable=true"

  # PostgreSQL Database
  db:
    image: postgres:16-alpine
    container_name: gwi-pos-db
    restart: always
    environment:
      - POSTGRES_USER=pos
      - POSTGRES_PASSWORD=${DB_PASSWORD}
      - POSTGRES_DB=gwi_pos
    volumes:
      - pgdata:/var/lib/postgresql/data
      - ./backups:/backups
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U pos -d gwi_pos"]
      interval: 10s
      timeout: 5s
      retries: 5
    networks:
      - pos-network

  # Redis Cache
  redis:
    image: redis:7-alpine
    container_name: gwi-pos-redis
    restart: always
    command: redis-server --appendonly yes
    volumes:
      - redisdata:/data
    healthcheck:
      test: ["CMD", "redis-cli", "ping"]
      interval: 10s
      timeout: 5s
      retries: 5
    networks:
      - pos-network

  # Automatic Updates
  watchtower:
    image: containrrr/watchtower
    container_name: gwi-pos-watchtower
    restart: always
    volumes:
      - /var/run/docker.sock:/var/run/docker.sock
    command: --interval 3600 --cleanup --label-enable
    environment:
      - TZ=${TZ:-America/New_York}
    networks:
      - pos-network

  # Cloud Sync Worker (Optional)
  sync-worker:
    image: ghcr.io/gwi-pos/sync-worker:latest
    container_name: gwi-pos-sync
    restart: always
    environment:
      - DATABASE_URL=postgresql://pos:${DB_PASSWORD}@db:5432/gwi_pos
      - CLOUD_API_URL=${CLOUD_API_URL}
      - CLOUD_API_KEY=${CLOUD_API_KEY}
      - SYNC_INTERVAL=300
    depends_on:
      - db
    profiles:
      - cloud-sync
    networks:
      - pos-network

networks:
  pos-network:
    driver: bridge

volumes:
  pgdata:
  redisdata:
```

### Environment File

```bash
# /opt/gwi-pos/docker/.env

# Location Identity
LOCATION_ID=loc_abc123
LOCATION_NAME="My Restaurant"
TZ=America/New_York

# Database
DB_PASSWORD=your-super-secure-password-here

# Authentication
NEXTAUTH_SECRET=generate-with-openssl-rand-base64-32

# Cloud Sync (Optional)
CLOUD_API_URL=https://admin.gwi-pos.com/api
CLOUD_API_KEY=your-api-key

# Ports (rarely changed)
PORT=3000
WS_PORT=3001
```

### Installation Script

```bash
#!/bin/bash
# /opt/gwi-pos/docker/scripts/setup.sh

set -e

echo "=== GWI POS Server Setup ==="

# Update system
sudo apt update && sudo apt upgrade -y

# Install Docker
curl -fsSL https://get.docker.com | sudo sh
sudo usermod -aG docker $USER

# Install Docker Compose plugin
sudo apt install -y docker-compose-plugin

# Create directories
sudo mkdir -p /opt/gwi-pos/docker/{backups,data,config}
sudo chown -R $USER:$USER /opt/gwi-pos

# Clone/copy files
cd /opt/gwi-pos
# git clone https://github.com/your-repo/gwi-pos.git .
# OR copy files manually

# Configure environment
cp docker/.env.example docker/.env
nano docker/.env  # Edit with your values

# Generate secrets
echo "NEXTAUTH_SECRET=$(openssl rand -base64 32)" >> docker/.env
echo "DB_PASSWORD=$(openssl rand -base64 24)" >> docker/.env

# Start services
cd docker
docker compose up -d

# Wait for health
sleep 30
docker compose ps
docker compose logs --tail 50 pos-app

# Create systemd service
sudo tee /etc/systemd/system/gwi-pos.service > /dev/null <<EOF
[Unit]
Description=GWI POS System
Requires=docker.service
After=docker.service

[Service]
Type=oneshot
RemainAfterExit=yes
WorkingDirectory=/opt/gwi-pos/docker
ExecStart=/usr/bin/docker compose up -d
ExecStop=/usr/bin/docker compose down
User=$USER

[Install]
WantedBy=multi-user.target
EOF

sudo systemctl daemon-reload
sudo systemctl enable gwi-pos
sudo systemctl start gwi-pos

echo "=== Setup Complete ==="
echo "Access POS at: http://192.168.10.10:3000"
echo "Default PIN: 1234 (Manager)"
```

---

## Printer Configuration

### Network Printer Setup

#### Epson Printer Configuration

```
1. Connect printer to POS-PRINT VLAN (port on switch)
2. Print network status (hold feed button during power-on)
3. Note default IP address
4. Access web interface: http://[printer-ip]
5. Configure:
   - IP Address: 192.168.20.1XX (from assignment table)
   - Subnet Mask: 255.255.255.0
   - Gateway: 192.168.20.1
   - DHCP: Disabled
6. Save and restart printer
```

#### GWI POS Printer Setup

```
Admin → Settings → Hardware → Printers → Add

Kitchen Printer 1:
  Name: Hot Line
  Type: impact
  IP Address: 192.168.20.100
  Port: 9100
  Roles: kitchen
  Red Ribbon: Enabled
  Backup Printer: Receipt Printer 1

Receipt Printer 1:
  Name: Front Register
  Type: thermal
  IP Address: 192.168.20.110
  Port: 9100
  Roles: receipt
  Cash Drawer: Enabled

Bar Printer:
  Name: Bar
  Type: thermal
  IP Address: 192.168.20.102
  Port: 9100
  Roles: bar
```

### Print Routing

```
Admin → Settings → Hardware → Print Routing

Route 1: Kitchen Food
  Type: category
  Categories: Appetizers, Entrees, Sides, Desserts
  Primary: Hot Line (192.168.20.100)
  Backup: Receipt Printer 1

Route 2: Bar Drinks
  Type: category
  Categories: Beer, Wine, Cocktails, Spirits
  Primary: Bar (192.168.20.102)
  Backup: Hot Line

Route 3: Pizza Station
  Type: category
  Categories: Pizza
  Primary: Pizza Station (192.168.20.101)
  Settings: Large headers, red modifiers
```

---

## KDS Configuration

### Device Setup Options

#### Option 1: Fire Tablet (Budget)

```
1. Factory reset tablet
2. Skip Amazon account (tap "Skip" rapidly)
3. Connect to POS-CORE WiFi
4. Install "Fully Kiosk Browser" from Amazon Appstore
5. Configure Fully Kiosk:
   - Start URL: http://192.168.10.10:3000/kds
   - Kiosk Mode: Enabled
   - Status Bar: Hidden
   - Navigation Bar: Hidden
   - Screen Saver: Disabled
   - Keep Screen On: Enabled
```

#### Option 2: Smart Monitor

```
1. Connect to POS-CORE network (Ethernet preferred)
2. Open built-in browser (Samsung/LG)
3. Navigate to: http://192.168.10.10:3000/kds
4. Bookmark / Set as homepage
5. Enable "Kiosk Mode" if available
```

#### Option 3: iPad with PoE

```
1. Connect PoE adapter (USB-C to Ethernet + Power)
2. Disable WiFi (Settings → WiFi → Off)
3. Install "Kiosk Pro" or use Safari
4. Configure Guided Access (Settings → Accessibility)
5. Navigate to KDS URL and lock
```

### KDS Pairing

```
1. Admin → Settings → Hardware → KDS Screens → Add
2. Configure:
   - Name: Kitchen Display
   - Station: Hot Line
   - Save
3. Click key icon → Generate Pairing Code
4. On KDS device: http://192.168.10.10:3000/kds/pair
5. Enter 6-digit code
6. Device paired!

Optional - Static IP Enforcement:
1. Edit KDS Screen
2. Enter Static IP: 192.168.10.30
3. Enable "Enforce IP Address"
4. Save
```

---

## Physical Installation

### Server Room / Closet

```
Requirements:
✓ Climate controlled (68-75°F / 20-24°C)
✓ NOT in kitchen (heat + grease = death)
✓ Lockable (physical security)
✓ Near network switch
✓ Dedicated circuit (20A recommended)
✓ UPS protected

Ideal Locations:
- Manager's office closet
- Dedicated IT closet
- Back office corner
- Under bar (ONLY if climate controlled)
```

### Wiring Diagram

```
                            [Server Closet]
                                  │
    ┌─────────────────────────────┼─────────────────────────────┐
    │                             │                             │
    ▼                             ▼                             ▼
┌────────┐                  ┌──────────┐                  ┌──────────┐
│  UPS   │                  │ PoE      │                  │  Dream   │
│1500VA  │                  │ Switch   │                  │ Machine  │
└───┬────┘                  └────┬─────┘                  └────┬─────┘
    │                            │                              │
    ├── Local Server             ├── Kitchen Printer ───────────┤
    ├── PoE Switch               ├── Bar Printer                │
    └── Dream Machine            ├── Receipt Printer            │
                                 ├── KDS Kitchen ◄──────────────┤
                                 ├── KDS Bar                    │
                                 ├── Access Point 1             │
                                 └── Access Point 2 ────────────┘
                                       │
                                       ▼
                              [POS Terminals via WiFi]
```

### Cable Labeling Standard

```
Format: [VLAN]-[LOCATION]-[DEVICE]-[PORT]

Examples:
  10-KITCHEN-KDS-ETH0
  20-KITCHEN-PRINTER-ETH0
  10-BAR-TERMINAL1-ETH0
  10-SERVER-CLOSET-SERVER-ETH0

Label BOTH ends of every cable!
```

---

## Security Checklist

### Network Security

- [ ] Change default UniFi admin password
- [ ] Enable 2FA on UniFi controller
- [ ] Guest VLAN isolated from POS VLANs
- [ ] POS WiFi uses WPA3 with strong password
- [ ] Firewall rules block cross-VLAN traffic
- [ ] Printer VLAN has no internet access
- [ ] Remote management via VPN only (or disabled)

### Device Security

- [ ] All KDS screens paired with tokens
- [ ] Static IPs enforced for KDS
- [ ] All employee PINs are unique
- [ ] Manager PIN is NOT 1234 in production
- [ ] Card readers are PCI compliant
- [ ] Tablets have screen lock enabled

### Physical Security

- [ ] Server in locked location
- [ ] UPS battery backup installed
- [ ] Tablets in secure stands (anti-theft)
- [ ] Cash drawer under counter / locked
- [ ] Security cameras on register areas

### Data Security

- [ ] Daily database backups configured
- [ ] Backup restore tested successfully
- [ ] 30-day backup retention
- [ ] Offsite backup (cloud sync or manual)
- [ ] NEXTAUTH_SECRET is randomly generated
- [ ] Database password is strong (24+ chars)

---

## Failure & Recovery Procedures

### Database Backup (Daily Automated)

```bash
#!/bin/bash
# /opt/gwi-pos/docker/scripts/backup.sh
# Run via cron: 0 2 * * * /opt/gwi-pos/docker/scripts/backup.sh

BACKUP_DIR="/opt/gwi-pos/docker/backups"
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
BACKUP_FILE="$BACKUP_DIR/gwi_pos_$TIMESTAMP.sql.gz"

# Create backup
docker exec gwi-pos-db pg_dump -U pos gwi_pos | gzip > "$BACKUP_FILE"

# Upload to cloud (S3/R2/Backblaze)
# aws s3 cp "$BACKUP_FILE" s3://your-bucket/backups/
# OR
# rclone copy "$BACKUP_FILE" r2:your-bucket/backups/

# Cleanup old backups (keep 30 days)
find "$BACKUP_DIR" -name "*.sql.gz" -mtime +30 -delete

echo "Backup complete: $BACKUP_FILE"
```

### Database Restore

```bash
#!/bin/bash
# /opt/gwi-pos/docker/scripts/restore.sh

BACKUP_FILE=$1

if [ -z "$BACKUP_FILE" ]; then
  echo "Usage: ./restore.sh <backup-file.sql.gz>"
  exit 1
fi

echo "WARNING: This will overwrite the current database!"
read -p "Continue? (yes/no): " confirm
if [ "$confirm" != "yes" ]; then
  echo "Aborted."
  exit 1
fi

# Stop application
docker compose stop pos-app

# Restore database
gunzip -c "$BACKUP_FILE" | docker exec -i gwi-pos-db psql -U pos -d gwi_pos

# Restart application
docker compose start pos-app

echo "Restore complete!"
```

### Printer Failure

**If Kitchen Printer fails:**
1. POS UI shows warning: "Kitchen Printer Offline"
2. Option to redirect to backup printer (Receipt or Expo)
3. Fix or replace printer
4. Clear print queue if needed

**Temporary Workaround:**
```
Admin → Settings → Hardware → Printers
Edit failed printer → Set "Backup Printer"
All jobs automatically redirect
```

### KDS Failure

**If KDS tablet fails:**
1. Kitchen still receives printed tickets (if configured)
2. Replace tablet or use spare
3. Pair new device with same screen config
4. Previous screen auto-disconnects

### Server Failure (Disaster Recovery)

**Recovery Time Objective: < 10 minutes**

```bash
# On backup laptop or new mini PC:

1. Install Docker (if not present)
   curl -fsSL https://get.docker.com | sudo sh

2. Copy docker-compose files
   scp user@backup-location:/opt/gwi-pos/docker/* ./

3. Download latest backup
   # From S3/R2/local backup drive
   aws s3 cp s3://your-bucket/backups/latest.sql.gz ./

4. Start database first
   docker compose up -d db
   sleep 30

5. Restore backup
   gunzip -c latest.sql.gz | docker exec -i gwi-pos-db psql -U pos -d gwi_pos

6. Start application
   docker compose up -d

7. Update IP if needed (UniFi DHCP reservation)

8. Verify all terminals can connect
```

### Internet Outage

**Impact: NONE for floor operations!**

- POS terminals continue working (local server)
- KDS continues receiving orders (Socket.io local)
- Printers continue printing (local network)
- Card payments may switch to offline mode

**Only affected:**
- Cloud sync pauses (resumes when online)
- Remote management unavailable
- Software updates delayed

---

## Maintenance & Monitoring

### Daily Checks

```
□ All terminals show "Connected" in footer
□ KDS screens showing current time (not frozen)
□ Test print from each station
□ Cash drawer opens properly
□ End-of-day report generates
```

### Weekly Checks

```bash
# SSH into server
ssh gwiadmin@192.168.10.10

# Check disk space
df -h
# Should have >20% free

# Check memory
free -h
# Should have >2GB available

# Check Docker status
docker compose ps
# All services should be "healthy"

# Review logs for errors
docker compose logs --since 7d | grep -i error

# Check backup files exist
ls -la /opt/gwi-pos/docker/backups/
```

### Monthly Checks

```
□ Test full backup restore (on test machine!)
□ Review user access (remove ex-employees)
□ Check UPS battery status / test
□ Clean printer heads (impact printers)
□ Check for POS software updates
□ Review security logs in UniFi
□ Update UniFi firmware if available
□ Verify static IP reservations still correct
```

### Health Check Endpoint

```bash
# Check POS health
curl http://192.168.10.10:3000/api/health

# Expected response:
{
  "status": "healthy",
  "timestamp": "2026-01-30T12:00:00Z",
  "version": "1.0.0",
  "uptime": 864000,
  "database": "connected",
  "redis": "connected",
  "checks": {
    "database": true,
    "redis": true,
    "memory": true,
    "disk": true
  }
}
```

### External Monitoring (Recommended)

```
Set up alerts for:
- Health endpoint down (UptimeRobot, Pingdom)
- Disk space < 20% (custom script → Slack/email)
- Database backup missing (check S3 bucket daily)
- UPS on battery (UPS monitoring software)
```

---

## Cost Estimates

### Small Setup (1-2 Terminals, 1 KDS)

| Category | Items | Cost |
|----------|-------|------|
| Network | UDM SE, 1 AP | $600 |
| Server | Beelink Mini PC | $450 |
| UPS | APC 600VA | $80 |
| Terminals | 2 iPads + stands | $1,100 |
| Card Reader | 2 Square Readers | $100 |
| Printers | 1 thermal + 1 impact | $700 |
| KDS | 1 Fire Tablet + PoE | $200 |
| Cash | 1 drawer + cable | $145 |
| Cabling | Cables, jacks, etc. | $150 |
| **TOTAL** | | **~$3,500** |

### Medium Setup (3-4 Terminals, 2-3 KDS)

| Category | Items | Cost |
|----------|-------|------|
| Network | UDM Pro, Switch 24 PoE, 2 APs | $1,250 |
| Server | Beelink SER5 Pro | $450 |
| UPS | APC 1500VA | $250 |
| Terminals | 4 iPads + stands | $2,200 |
| Card Reader | 4 Square Terminals | $1,200 |
| Printers | 2 thermal + 2 impact | $1,400 |
| KDS | 3 tablets + PoE adapters | $600 |
| Cash | 2 drawers + cables | $290 |
| Cabling | Full install kit | $300 |
| **TOTAL** | | **~$7,900** |

### Large Setup (5+ Terminals, 4+ KDS)

| Category | Items | Cost |
|----------|-------|------|
| Network | UDM Pro, Switch 48 PoE, 3 APs | $2,000 |
| Server | High-end Mini PC + hot spare | $900 |
| UPS | 2x APC 1500VA | $500 |
| Terminals | 6 iPads + stands | $3,300 |
| Card Reader | 6 Square Terminals | $1,800 |
| Printers | 2 thermal + 3 impact + 1 label | $2,200 |
| KDS | 4 tablets/monitors + bump bars | $1,200 |
| Cash | 3 drawers + cables | $435 |
| Cabling | Professional install | $500 |
| **TOTAL** | | **~$12,800** |

---

## Quick Reference Card

```
┌─────────────────────────────────────────────────────────┐
│                 GWI POS QUICK REFERENCE                  │
├─────────────────────────────────────────────────────────┤
│                                                         │
│  SERVER IP:     192.168.10.10                          │
│  POS URL:       http://192.168.10.10:3000              │
│  KDS URL:       http://192.168.10.10:3000/kds          │
│                                                         │
│  SSH ACCESS:    ssh gwiadmin@192.168.10.10             │
│  UNIFI:         https://192.168.10.1                   │
│                                                         │
│  MANAGER PIN:   _____________ (change from 1234!)      │
│  SERVER PIN:    _____________                          │
│                                                         │
│  KITCHEN PRINTER: 192.168.20.100                       │
│  BAR PRINTER:     192.168.20.102                       │
│  RECEIPT PRINTER: 192.168.20.110                       │
│                                                         │
│  WIFI (POS):    _______________  PW: ______________    │
│  WIFI (GUEST):  _______________  PW: ______________    │
│                                                         │
│  SUPPORT:       support@gwi-pos.com                    │
│                                                         │
└─────────────────────────────────────────────────────────┘
```

---

*Document Version: 2.0*
*Last Updated: January 30, 2026*
*Architecture: Local-First Fortress*
