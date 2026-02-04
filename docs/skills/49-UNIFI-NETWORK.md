# 49 - Unifi Network Setup

**Status:** Planning
**Priority:** Critical (Infrastructure)
**Dependencies:** 34-Device-Management, 42-Local-Server

---

## Overview

The Unifi Network skill provides comprehensive guidance and configuration for setting up a reliable, high-performance network infrastructure using Ubiquiti Unifi equipment. Covers network topology, static IP assignment for POS devices, VLAN segmentation, printer routing, and failover configuration.

**Primary Goal:** Rock-solid network infrastructure that ensures POS devices, kitchen displays, and printers communicate reliably with zero downtime.

---

## User Stories

### As an Installer...
- I want a standard network topology to follow
- I want clear IP addressing schemes
- I want quick device provisioning
- I want documentation for troubleshooting

### As a Manager...
- I want network status visibility
- I want alerts when devices go offline
- I want simple device reconnection
- I want secure guest WiFi separation

### As IT Support...
- I want remote management access
- I want device health monitoring
- I want traffic analysis
- I want firmware management

---

## Features

### Network Topology

#### Recommended Setup
```
                    ┌─────────────────────┐
                    │   Internet/ISP      │
                    └──────────┬──────────┘
                               │
                    ┌──────────▼──────────┐
                    │  Unifi Dream Machine │
                    │     Pro (UDM-Pro)    │
                    │  Router + Controller │
                    └──────────┬──────────┘
                               │
              ┌────────────────┼────────────────┐
              │                │                │
    ┌─────────▼─────────┐     │      ┌─────────▼─────────┐
    │  USW-Pro-24-PoE   │     │      │   USW-Lite-8-PoE  │
    │   Main Switch     │     │      │   Kitchen Switch  │
    └─────────┬─────────┘     │      └─────────┬─────────┘
              │               │                │
     ┌────────┼────────┐      │       ┌────────┼────────┐
     │        │        │      │       │        │        │
   [POS]   [POS]   [Printer] [AP]   [KDS]    [KDS]  [Printer]
```

#### Equipment List
```yaml
recommended_equipment:
  router:
    model: "UDM-Pro or UDM-SE"
    purpose: "Router, firewall, controller"

  main_switch:
    model: "USW-Pro-24-PoE or USW-Enterprise-24-PoE"
    purpose: "Main distribution, PoE for devices"

  kitchen_switch:
    model: "USW-Lite-8-PoE"
    purpose: "Kitchen area devices"

  access_points:
    model: "U6-Pro or U6-Enterprise"
    count: "1 per 1500 sq ft"
    purpose: "Wireless coverage"

  backup:
    model: "USW-Flex-Mini"
    purpose: "Backup switch on hand"
```

### IP Addressing Scheme

#### Standard IP Layout
```yaml
network_ranges:
  management:
    network: "10.0.0.0/24"
    gateway: "10.0.0.1"
    description: "Network devices, Unifi controller"

  pos_devices:
    network: "10.0.10.0/24"
    gateway: "10.0.10.1"
    description: "POS terminals, tablets"
    static_range: "10.0.10.10 - 10.0.10.99"
    dhcp_range: "10.0.10.100 - 10.0.10.200"

  kitchen:
    network: "10.0.20.0/24"
    gateway: "10.0.20.1"
    description: "KDS screens, kitchen printers"
    static_range: "10.0.20.10 - 10.0.20.50"

  printers:
    network: "10.0.30.0/24"
    gateway: "10.0.30.1"
    description: "All receipt and label printers"
    static_range: "10.0.30.10 - 10.0.30.50"

  back_office:
    network: "10.0.40.0/24"
    gateway: "10.0.40.1"
    description: "Office computers, local server"

  guest_wifi:
    network: "10.0.100.0/24"
    gateway: "10.0.100.1"
    description: "Customer WiFi, isolated"
```

### Static IP Assignments

#### Device IP Template
```yaml
static_assignments:
  # POS Terminals (10.0.10.x)
  pos_terminal_1:
    ip: "10.0.10.11"
    mac: "XX:XX:XX:XX:XX:XX"
    name: "POS-Main-Bar"
    location: "Main Bar"

  pos_terminal_2:
    ip: "10.0.10.12"
    mac: "XX:XX:XX:XX:XX:XX"
    name: "POS-Front"
    location: "Front Counter"

  pos_terminal_3:
    ip: "10.0.10.13"
    mac: "XX:XX:XX:XX:XX:XX"
    name: "POS-Patio"
    location: "Patio Station"

  # Kitchen Displays (10.0.20.x)
  kds_grill:
    ip: "10.0.20.11"
    mac: "XX:XX:XX:XX:XX:XX"
    name: "KDS-Grill"
    location: "Grill Station"

  kds_fry:
    ip: "10.0.20.12"
    mac: "XX:XX:XX:XX:XX:XX"
    name: "KDS-Fry"
    location: "Fry Station"

  kds_expo:
    ip: "10.0.20.13"
    mac: "XX:XX:XX:XX:XX:XX"
    name: "KDS-Expo"
    location: "Expo Window"

  # Printers (10.0.30.x)
  printer_receipt_bar:
    ip: "10.0.30.11"
    mac: "XX:XX:XX:XX:XX:XX"
    name: "PRN-Receipt-Bar"
    location: "Main Bar"

  printer_receipt_front:
    ip: "10.0.30.12"
    mac: "XX:XX:XX:XX:XX:XX"
    name: "PRN-Receipt-Front"
    location: "Front Counter"

  printer_kitchen:
    ip: "10.0.30.21"
    mac: "XX:XX:XX:XX:XX:XX"
    name: "PRN-Kitchen"
    location: "Kitchen"

  printer_bar:
    ip: "10.0.30.22"
    mac: "XX:XX:XX:XX:XX:XX"
    name: "PRN-Bar-Tickets"
    location: "Bar Service"

  # Local Server (10.0.40.x)
  local_server:
    ip: "10.0.40.10"
    mac: "XX:XX:XX:XX:XX:XX"
    name: "GWI-Local-Server"
    location: "Back Office"
```

### VLAN Configuration

#### VLAN Setup
```yaml
vlans:
  vlan_10:
    id: 10
    name: "POS-Devices"
    network: "10.0.10.0/24"
    purpose: "Point of sale terminals"
    isolate_clients: false

  vlan_20:
    id: 20
    name: "Kitchen"
    network: "10.0.20.0/24"
    purpose: "Kitchen displays and printers"
    isolate_clients: false

  vlan_30:
    id: 30
    name: "Printers"
    network: "10.0.30.0/24"
    purpose: "All printers"
    isolate_clients: false

  vlan_40:
    id: 40
    name: "Back-Office"
    network: "10.0.40.0/24"
    purpose: "Office and server"
    isolate_clients: false

  vlan_100:
    id: 100
    name: "Guest-WiFi"
    network: "10.0.100.0/24"
    purpose: "Customer internet access"
    isolate_clients: true
    bandwidth_limit: "25 Mbps down, 10 Mbps up"
```

#### Firewall Rules
```yaml
firewall_rules:
  # Allow POS to printers
  - name: "POS to Printers"
    source: "VLAN 10"
    destination: "VLAN 30"
    action: "allow"
    ports: "9100, 515, 631"

  # Allow POS to kitchen
  - name: "POS to Kitchen"
    source: "VLAN 10"
    destination: "VLAN 20"
    action: "allow"

  # Allow kitchen to printers
  - name: "Kitchen to Printers"
    source: "VLAN 20"
    destination: "VLAN 30"
    action: "allow"
    ports: "9100"

  # All VLANs to local server
  - name: "All to Local Server"
    source: "VLAN 10, 20, 30"
    destination: "10.0.40.10"
    action: "allow"

  # Block guest from internal
  - name: "Isolate Guest"
    source: "VLAN 100"
    destination: "10.0.0.0/8"
    action: "drop"
```

### Switch Port Configuration

#### Port Assignments
```
USW-Pro-24-PoE (Main Switch)
├── Port 1:  Uplink to UDM-Pro (Trunk)
├── Port 2:  Local Server (VLAN 40)
├── Port 3:  Access Point 1 (All VLANs)
├── Port 4:  Access Point 2 (All VLANs)
├── Port 5:  Kitchen Switch Uplink (Trunk)
├── Port 6:  POS Terminal 1 (VLAN 10)
├── Port 7:  POS Terminal 2 (VLAN 10)
├── Port 8:  POS Terminal 3 (VLAN 10)
├── Port 9:  Receipt Printer - Bar (VLAN 30)
├── Port 10: Receipt Printer - Front (VLAN 30)
├── Port 11: Customer Display 1 (VLAN 10)
├── Port 12: Customer Display 2 (VLAN 10)
├── Port 13-24: Reserved/Expansion
└── SFP+: Future high-speed uplink

USW-Lite-8-PoE (Kitchen Switch)
├── Port 1:  Uplink to Main Switch (Trunk)
├── Port 2:  KDS Grill (VLAN 20)
├── Port 3:  KDS Fry (VLAN 20)
├── Port 4:  KDS Expo (VLAN 20)
├── Port 5:  Kitchen Printer (VLAN 30)
├── Port 6:  Bar Ticket Printer (VLAN 30)
├── Port 7:  Reserved
└── Port 8:  Reserved
```

### WiFi Configuration

#### Wireless Networks
```yaml
wifi_networks:
  pos_wifi:
    ssid: "GWI-POS"
    security: "WPA3-Enterprise"  # Or WPA2 with strong PSK
    vlan: 10
    band: "5GHz preferred"
    hidden: false
    client_isolation: false
    purpose: "Handheld POS tablets"

  staff_wifi:
    ssid: "GWI-Staff"
    security: "WPA2-PSK"
    vlan: 40
    band: "Both"
    purpose: "Staff personal devices"

  guest_wifi:
    ssid: "Guest-WiFi"
    security: "WPA2-PSK"
    vlan: 100
    band: "Both"
    bandwidth: "25/10 Mbps"
    client_isolation: true
    captive_portal: optional
    purpose: "Customer internet"
```

---

## UI/UX Specifications

### Network Status Dashboard

```
+------------------------------------------------------------------+
| NETWORK STATUS                                    [Refresh]       |
+------------------------------------------------------------------+
|                                                                   |
| OVERVIEW                                                          |
| +------------------+ +------------------+ +------------------+    |
| | Internet         | | Devices Online   | | Alerts           |   |
| | [====] 245 Mbps  | | 18 / 18          | | 0 Critical       |   |
| | Uptime: 47 days  | | All Connected    | | 1 Warning        |   |
| +------------------+ +------------------+ +------------------+    |
|                                                                   |
| DEVICE STATUS                                                     |
| +--------------------------------------------------------------+ |
| | Device              | IP           | Status    | Last Seen   | |
| +--------------------------------------------------------------+ |
| | POS-Main-Bar        | 10.0.10.11   | [Online]  | Now         | |
| | POS-Front           | 10.0.10.12   | [Online]  | Now         | |
| | POS-Patio           | 10.0.10.13   | [Online]  | Now         | |
| | KDS-Grill           | 10.0.20.11   | [Online]  | Now         | |
| | KDS-Fry             | 10.0.20.12   | [Online]  | Now         | |
| | KDS-Expo            | 10.0.20.13   | [Online]  | Now         | |
| | PRN-Receipt-Bar     | 10.0.30.11   | [Online]  | Now         | |
| | PRN-Receipt-Front   | 10.0.30.12   | [Online]  | Now         | |
| | PRN-Kitchen         | 10.0.30.21   | [Online]  | Now         | |
| +--------------------------------------------------------------+ |
|                                                                   |
| [View Full Network Map]  [Unifi Controller]  [Run Diagnostics]   |
+------------------------------------------------------------------+
```

### Device Registration

```
+------------------------------------------------------------------+
| REGISTER NEW DEVICE                                               |
+------------------------------------------------------------------+
|                                                                   |
| DEVICE TYPE                                                       |
| ( ) POS Terminal                                                  |
| ( ) Kitchen Display (KDS)                                         |
| (•) Printer                                                       |
| ( ) Customer Display                                              |
| ( ) Other                                                         |
|                                                                   |
| DEVICE DETAILS                                                    |
| Name:     [PRN-Patio-Receipt_____________________]               |
| Location: [Patio________________________] [Select ▼]             |
|                                                                   |
| MAC Address: [XX:XX:XX:XX:XX:XX_____]                            |
| (Found on device label or printed config page)                   |
|                                                                   |
| NETWORK ASSIGNMENT                                                |
| VLAN: [Printers (30)_____] [▼]                                   |
|                                                                   |
| IP Assignment:                                                    |
| (•) Auto-assign next available: 10.0.30.23                       |
| ( ) Manual: [_____________]                                       |
|                                                                   |
| [Cancel]                              [Register Device]           |
+------------------------------------------------------------------+
```

### Troubleshooting Guide

```
+------------------------------------------------------------------+
| NETWORK TROUBLESHOOTING                                           |
+------------------------------------------------------------------+
|                                                                   |
| QUICK DIAGNOSTICS                                                 |
| +--------------------------------------------------------------+ |
| | Issue                        | Check              | Action    | |
| +--------------------------------------------------------------+ |
| | Device offline               | [Run Ping Test]    |           | |
| | Printer not responding       | [Test Port 9100]   |           | |
| | Slow connection              | [Speed Test]       |           | |
| | Cannot reach internet        | [Check Gateway]    |           | |
| +--------------------------------------------------------------+ |
|                                                                   |
| COMMON ISSUES                                                     |
|                                                                   |
| [!] Printer Offline                                               |
|     1. Check printer power and network cable                     |
|     2. Verify IP address on printer config page                  |
|     3. Ping printer from POS: ping 10.0.30.XX                   |
|     4. Check switch port status in Unifi                        |
|     5. Restart printer if needed                                 |
|                                                                   |
| [!] POS Cannot Print                                              |
|     1. Verify printer is online (see above)                      |
|     2. Check firewall rules (VLAN 10 → VLAN 30)                 |
|     3. Verify printer IP in POS settings                        |
|     4. Test print from Printer Settings                         |
|                                                                   |
| [!] KDS Not Receiving Orders                                      |
|     1. Check KDS network connection                              |
|     2. Verify local server is reachable                         |
|     3. Check WebSocket connection status                        |
|     4. Restart KDS application                                  |
|                                                                   |
+------------------------------------------------------------------+
```

---

## Installation Checklist

### Pre-Installation
```
[ ] Verify internet service is active
[ ] Confirm electrical outlets at equipment locations
[ ] Plan cable runs (Cat6 recommended)
[ ] Gather all device MAC addresses
[ ] Create IP address spreadsheet
```

### Equipment Setup
```
[ ] Install UDM-Pro/router in secure location
[ ] Mount and connect main switch
[ ] Mount and connect kitchen switch
[ ] Mount access points (ceiling preferred)
[ ] Run and terminate all network cables
[ ] Label all cables and ports
```

### Unifi Configuration
```
[ ] Complete initial UDM-Pro setup
[ ] Adopt all switches and APs
[ ] Create VLANs per specification
[ ] Configure switch port profiles
[ ] Set up WiFi networks
[ ] Create firewall rules
[ ] Configure DHCP reservations
```

### Device Registration
```
[ ] Register all POS terminals
[ ] Register all KDS displays
[ ] Register all printers
[ ] Configure static IPs
[ ] Test connectivity to each device
[ ] Test printing from each POS to each printer
```

### Final Verification
```
[ ] All devices show online in dashboard
[ ] Cross-VLAN communication working
[ ] Guest WiFi isolated properly
[ ] Failover tested (if applicable)
[ ] Documentation completed
[ ] Staff trained on basic troubleshooting
```

---

## Data Model

### Network Devices
```sql
network_devices {
  id: UUID PRIMARY KEY
  location_id: UUID (FK)

  -- Device info
  name: VARCHAR(100)
  device_type: VARCHAR(50) (pos, kds, printer, server, switch, ap)
  mac_address: VARCHAR(17) UNIQUE

  -- Network
  ip_address: INET
  vlan_id: INTEGER
  switch_port: VARCHAR(50) (nullable)

  -- Status
  is_online: BOOLEAN DEFAULT false
  last_seen: TIMESTAMP

  -- Location
  physical_location: VARCHAR(200)

  created_at: TIMESTAMP
  updated_at: TIMESTAMP
}
```

### Network Configuration
```sql
network_config {
  location_id: UUID PRIMARY KEY (FK)

  -- Ranges
  pos_network: CIDR
  kitchen_network: CIDR
  printer_network: CIDR
  server_ip: INET

  -- Unifi
  unifi_controller_url: VARCHAR(500) (nullable)

  updated_at: TIMESTAMP
}
```

---

## API Endpoints

### Network Status
```
GET    /api/network/status
GET    /api/network/devices
GET    /api/network/devices/{id}
POST   /api/network/devices
PUT    /api/network/devices/{id}
DELETE /api/network/devices/{id}
```

### Diagnostics
```
POST   /api/network/ping/{ip}
POST   /api/network/port-check/{ip}/{port}
GET    /api/network/topology
```

---

## Business Rules

1. **Static IPs Required:** All POS devices must have static IP assignments
2. **VLAN Segmentation:** Printers on separate VLAN for security
3. **Guest Isolation:** Guest WiFi cannot access internal networks
4. **Redundancy:** Kitchen switch provides backup path
5. **Documentation:** All devices registered with MAC and location

---

## Permissions

| Action | Installer | Manager | Admin |
|--------|-----------|---------|-------|
| View network status | No | Yes | Yes |
| Register devices | Yes | No | Yes |
| Modify IP assignments | Yes | No | Yes |
| Access Unifi controller | Yes | No | Yes |
| Run diagnostics | No | Yes | Yes |

---

## Configuration Options

```yaml
network:
  monitoring:
    poll_interval_seconds: 30
    alert_offline_after_seconds: 60

  display:
    show_network_status: true
    show_ip_addresses: false  # Hide from non-admin

  diagnostics:
    allow_ping: true
    allow_port_check: true

  unifi:
    controller_url: "https://10.0.0.1:443"
    enable_integration: false  # Future feature
```

---

*Last Updated: January 27, 2026*
