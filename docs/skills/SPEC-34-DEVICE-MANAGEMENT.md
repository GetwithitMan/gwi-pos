# 34 - Device Management

**Status:** Planning
**Priority:** High
**Dependencies:** 09-Features-Config

---

## Overview

The Device Management skill handles all hardware configuration - terminals, printers, payment devices, handhelds, kiosks, and kitchen displays. Includes discovery, pairing, configuration, and monitoring.

**Primary Goal:** Simplify hardware setup and maintenance with centralized device management.

---

## User Stories

### As a Manager...
- I want to set up new devices easily
- I want to see device status at a glance
- I want to configure printer routing
- I want to troubleshoot connectivity issues

### As a Tech/IT...
- I want to manage all devices from one place
- I want remote configuration capabilities
- I want alerts when devices go offline
- I want firmware update management

---

## Features

### Device Types

#### Terminals
- [ ] Main POS terminals
- [ ] Server handhelds
- [ ] Tableside tablets
- [ ] Self-service kiosks
- [ ] Kitchen display screens

#### Printers
- [ ] Receipt printers
- [ ] Kitchen printers
- [ ] Label printers
- [ ] Report printers

#### Payment Devices
- [ ] Credit card terminals
- [ ] Contactless readers
- [ ] Mobile payment devices
- [ ] Cash drawers

#### Displays
- [ ] Customer-facing displays
- [ ] Kitchen display systems
- [ ] Order status boards

### Device Discovery

#### Auto-Discovery
- [ ] Scan network for devices
- [ ] Identify device types
- [ ] Suggest configuration
- [ ] One-click pairing

#### Manual Setup
- [ ] Enter IP address
- [ ] Serial number entry
- [ ] USB connection
- [ ] Bluetooth pairing

### Terminal Configuration

#### Terminal Settings
- [ ] Terminal name
- [ ] Location/station assignment
- [ ] Default order type
- [ ] Assigned printers
- [ ] Assigned payment device
- [ ] Customer display pairing

#### Terminal Profiles
```yaml
terminal_profiles:
  - name: "Front Counter"
    order_type: "quick_service"
    printers:
      receipt: "Receipt-1"
      kitchen: "Kitchen-Main"
    payment_device: "PAX-1"
    customer_display: "CFD-1"

  - name: "Server Handheld"
    order_type: "table_service"
    printers:
      receipt: "Receipt-Bar"
      kitchen: "Kitchen-Main"
    features:
      - tableside_ordering
      - payment_at_table
```

### Printer Management

#### Printer Configuration
- [ ] Printer name
- [ ] Connection type (network, USB, Bluetooth)
- [ ] IP address/port
- [ ] Paper width (58mm, 80mm)
- [ ] Character set

#### Print Routing
- [ ] Route by category
- [ ] Route by item
- [ ] Route by revenue center
- [ ] Multi-destination printing

#### Print Routing Rules
```yaml
print_routing:
  - destination: "Kitchen-Hot"
    routes:
      - category: "Entrees"
      - category: "Appetizers"
      - tag: "grill"

  - destination: "Kitchen-Cold"
    routes:
      - category: "Salads"
      - category: "Desserts"

  - destination: "Bar"
    routes:
      - category: "Drinks"
      - category: "Cocktails"
```

### Payment Device Management

#### Device Pairing
- [ ] Connection wizard
- [ ] Test transaction
- [ ] Configuration sync
- [ ] Encryption key management

#### Supported Devices
- [ ] PAX terminals
- [ ] Verifone devices
- [ ] Clover devices
- [ ] Square readers
- [ ] Custom integrations

### Device Monitoring

#### Status Dashboard
- [ ] Online/offline status
- [ ] Last communication
- [ ] Error alerts
- [ ] Connection quality

#### Alerts
- [ ] Device offline
- [ ] Connection issues
- [ ] Paper low (printers)
- [ ] Maintenance needed

### Remote Management

#### Remote Actions
- [ ] Restart device
- [ ] Update configuration
- [ ] Push firmware update
- [ ] Clear cache/reset

#### Bulk Operations
- [ ] Update all terminals
- [ ] Push configuration to group
- [ ] Firmware rollout

---

## UI/UX Specifications

### Device Dashboard

```
+------------------------------------------------------------------+
| DEVICE MANAGEMENT                                                |
+------------------------------------------------------------------+
|                                                                  |
| TERMINALS (4)                                      [+ Add Device] |
| +--------------------------------------------------------------+|
| | Front Counter 1     | Online ✓  | Last seen: Just now        ||
| | iPad Pro 12.9       | IP: 192.168.1.101                       ||
| |                     | Printer: Receipt-1, Kitchen-Main        ||
| |                     |                    [Configure] [Restart]||
| +--------------------------------------------------------------+|
| | Front Counter 2     | Online ✓  | Last seen: Just now        ||
| | iPad Pro 12.9       | IP: 192.168.1.102                       ||
| +--------------------------------------------------------------+|
| | Server Handheld 1   | Online ✓  | Last seen: 2 min ago       ||
| | iPad Mini           | Bluetooth | Battery: 78%               ||
| +--------------------------------------------------------------+|
| | Server Handheld 2   | Offline ⚠️ | Last seen: 15 min ago      ||
| | iPad Mini           |                                         ||
| +--------------------------------------------------------------+|
|                                                                  |
| PRINTERS (5)                                                     |
| +--------------------------------------------------------------+|
| | Receipt-1           | Online ✓  | Epson TM-T88VI            ||
| | Receipt-Bar         | Online ✓  | Epson TM-T88VI            ||
| | Kitchen-Main        | Online ✓  | Epson TM-U220B            ||
| | Kitchen-Expo        | Online ✓  | Epson TM-U220B            ||
| | Label Printer       | Offline ⚠️ | Zebra ZD420               ||
| +--------------------------------------------------------------+|
|                                                                  |
| PAYMENT DEVICES (2)                                              |
| +--------------------------------------------------------------+|
| | PAX-1               | Online ✓  | PAX A920                  ||
| | PAX-2               | Online ✓  | PAX A920                  ||
| +--------------------------------------------------------------+|
|                                                                  |
+------------------------------------------------------------------+
```

### Printer Configuration

```
+------------------------------------------------------------------+
| PRINTER: Kitchen-Main                              [Save] [Test] |
+------------------------------------------------------------------+
|                                                                  |
| BASIC SETTINGS                                                   |
| Name: [Kitchen-Main__________]                                   |
| Type: [Kitchen Printer ▼]                                       |
| Model: [Epson TM-U220B ▼]                                       |
|                                                                  |
| CONNECTION                                                       |
| Type: (•) Network  ( ) USB  ( ) Bluetooth                       |
| IP Address: [192.168.1.201]  Port: [9100]                       |
| [Test Connection]  Status: Connected ✓                          |
|                                                                  |
| PRINT SETTINGS                                                   |
| Paper Width: [80mm ▼]                                           |
| Characters per Line: [42]                                        |
| Font Size: [Normal ▼]                                           |
| [✓] Print item prices                                           |
| [✓] Print modifiers                                             |
| [✓] Bold item names                                             |
|                                                                  |
| ROUTING                                                          |
| This printer receives orders for:                               |
| [✓] Entrees                                                     |
| [✓] Appetizers                                                  |
| [✓] Sides                                                       |
| [ ] Salads (→ Kitchen-Cold)                                     |
| [ ] Desserts (→ Kitchen-Cold)                                   |
| [ ] Drinks (→ Bar)                                              |
|                                                                  |
+------------------------------------------------------------------+
```

### Payment Device Setup

```
+------------------------------------------------------------------+
| SETUP PAYMENT DEVICE                                             |
+------------------------------------------------------------------+
|                                                                  |
| STEP 1: Select Device Type                                       |
| +------------------+ +------------------+ +------------------+   |
| |   PAX A920       | |  Verifone P400  | |  Custom/Other    |   |
| +------------------+ +------------------+ +------------------+   |
|                                                                  |
| STEP 2: Connect Device                                           |
| Connection: (•) Network  ( ) USB                                |
| IP Address: [192.168.1.150]                                     |
| [Search Network]                                                |
|                                                                  |
| STEP 3: Test Connection                                          |
| [Test Connection]                                                |
| Status: Connected ✓                                             |
| Serial: ABC123456789                                            |
| Firmware: 2.5.1                                                 |
|                                                                  |
| STEP 4: Configure                                                |
| Name: [PAX-1____________]                                       |
| Assign to Terminal: [Front Counter 1 ▼]                         |
| Tip Prompt: [Enabled ▼]                                         |
| Signature Threshold: [$25.00]                                   |
|                                                                  |
| [Cancel]                              [Complete Setup]           |
+------------------------------------------------------------------+
```

---

## Data Model

### Devices
```sql
devices {
  id: UUID PRIMARY KEY
  location_id: UUID (FK)

  device_type: VARCHAR(50) (terminal, printer, payment, display, kds)
  device_model: VARCHAR(100)
  device_name: VARCHAR(100)

  -- Connection
  connection_type: VARCHAR(50) (network, usb, bluetooth)
  ip_address: VARCHAR(45) (nullable)
  port: INTEGER (nullable)
  mac_address: VARCHAR(17) (nullable)
  serial_number: VARCHAR(100) (nullable)

  -- Configuration
  configuration: JSONB

  -- Status
  status: VARCHAR(50) (online, offline, error)
  last_seen: TIMESTAMP (nullable)
  last_error: TEXT (nullable)

  -- Assignment
  assigned_terminal_id: UUID (FK, nullable)

  firmware_version: VARCHAR(50) (nullable)
  is_active: BOOLEAN DEFAULT true

  created_at: TIMESTAMP
  updated_at: TIMESTAMP
}
```

### Terminals
```sql
terminals {
  id: UUID PRIMARY KEY
  location_id: UUID (FK)
  device_id: UUID (FK)

  terminal_name: VARCHAR(100)
  terminal_number: INTEGER
  station: VARCHAR(100) (nullable)

  -- Configuration
  default_order_type: VARCHAR(50)
  features: VARCHAR[]

  -- Assignments
  receipt_printer_id: UUID (FK, nullable)
  kitchen_printer_ids: UUID[] (nullable)
  payment_device_id: UUID (FK, nullable)
  customer_display_id: UUID (FK, nullable)

  is_active: BOOLEAN DEFAULT true

  created_at: TIMESTAMP
  updated_at: TIMESTAMP
}
```

### Print Routing
```sql
print_routing_rules {
  id: UUID PRIMARY KEY
  location_id: UUID (FK)
  printer_id: UUID (FK)

  route_type: VARCHAR(50) (category, item, tag, revenue_center)
  route_value: VARCHAR(100)

  priority: INTEGER DEFAULT 0

  is_active: BOOLEAN DEFAULT true

  created_at: TIMESTAMP
}
```

### Device Alerts
```sql
device_alerts {
  id: UUID PRIMARY KEY
  device_id: UUID (FK)
  location_id: UUID (FK)

  alert_type: VARCHAR(50) (offline, error, maintenance, low_paper)
  message: TEXT
  severity: VARCHAR(20) (info, warning, critical)

  acknowledged: BOOLEAN DEFAULT false
  acknowledged_by: UUID (FK, nullable)
  acknowledged_at: TIMESTAMP (nullable)

  created_at: TIMESTAMP
}
```

---

## API Endpoints

### Devices
```
GET    /api/devices
POST   /api/devices
GET    /api/devices/{id}
PUT    /api/devices/{id}
DELETE /api/devices/{id}
POST   /api/devices/discover
POST   /api/devices/{id}/test
POST   /api/devices/{id}/restart
```

### Terminals
```
GET    /api/terminals
POST   /api/terminals
PUT    /api/terminals/{id}
GET    /api/terminals/{id}/config
PUT    /api/terminals/{id}/config
```

### Printers
```
GET    /api/printers
POST   /api/printers
PUT    /api/printers/{id}
POST   /api/printers/{id}/test-print
GET    /api/printers/{id}/routing
PUT    /api/printers/{id}/routing
```

### Payment Devices
```
GET    /api/payment-devices
POST   /api/payment-devices
PUT    /api/payment-devices/{id}
POST   /api/payment-devices/{id}/test
```

### Monitoring
```
GET    /api/devices/status
GET    /api/devices/alerts
POST   /api/devices/alerts/{id}/acknowledge
```

---

## Business Rules

1. **Unique Assignment:** Payment device can only be assigned to one terminal
2. **Printer Routing:** Items route to appropriate printer based on rules
3. **Offline Handling:** Terminal can operate in limited mode if device offline
4. **Auto-Reconnect:** System attempts to reconnect dropped connections

---

## Permissions

| Action | Manager | Admin |
|--------|---------|-------|
| View devices | Yes | Yes |
| Add devices | Yes | Yes |
| Configure devices | Yes | Yes |
| Delete devices | No | Yes |
| Remote restart | Yes | Yes |
| Firmware update | No | Yes |

---

*Last Updated: January 27, 2026*
