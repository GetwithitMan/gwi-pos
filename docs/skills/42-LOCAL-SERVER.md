# 42 - Local Server / Offline Mode

**Status:** Planning
**Priority:** Critical
**Dependencies:** 09-Features-Config, 34-Device-Management

---

## Overview

The Local Server skill provides on-site data caching and offline operation capabilities. When internet connectivity is lost, the local server maintains operations across all networked devices, syncing with the cloud when connectivity returns. Essential for business continuity.

**Primary Goal:** Ensure uninterrupted POS operations regardless of internet connectivity through local data caching and device coordination.

---

## User Stories

### As an Operator...
- I want the POS to work even if internet goes down
- I want no disruption during connectivity issues
- I want to process payments offline
- I want all devices to stay in sync locally

### As a Manager...
- I want to know when we're operating offline
- I want data to sync when internet returns
- I want reports to be accurate after sync
- I want to trust that no data is lost

### As IT/Owner...
- I want reliable failover
- I want automatic sync/recovery
- I want minimal hardware requirements
- I want to monitor system health

---

## Features

### Local Server Hardware

#### Deployment Options
- [ ] Dedicated local server device
- [ ] Primary terminal as server
- [ ] Raspberry Pi / mini PC
- [ ] NAS with compute

#### Hardware Requirements
```yaml
minimum_specs:
  cpu: "4 cores"
  ram: "8GB"
  storage: "256GB SSD"
  network: "Gigabit Ethernet"
  ups: "Recommended"

recommended_specs:
  cpu: "8 cores"
  ram: "16GB"
  storage: "512GB SSD"
  network: "Gigabit Ethernet"
  ups: "Required"
```

### Data Synchronization

#### Sync Architecture
```
┌─────────────────────────────────────────────────────────────────┐
│                        CLOUD SERVER                              │
│                    (Primary Database)                            │
└─────────────────────────────────────────────────────────────────┘
                              ↑↓
                         [Internet]
                              ↑↓
┌─────────────────────────────────────────────────────────────────┐
│                       LOCAL SERVER                               │
│                    (Cache Database)                              │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │ Orders │ Menu │ Employees │ Payments │ Inventory │ etc  │   │
│  └─────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────┘
                              ↑↓
                        [Local Network]
          ┌───────────────────┼───────────────────┐
          ↓                   ↓                   ↓
    ┌──────────┐       ┌──────────┐       ┌──────────┐
    │Terminal 1│       │Terminal 2│       │Terminal 3│
    └──────────┘       └──────────┘       └──────────┘
```

#### Sync Types
- [ ] **Real-time sync:** Continuous when online
- [ ] **Batch sync:** Periodic bulk updates
- [ ] **Priority sync:** Critical data first
- [ ] **Conflict resolution:** Handle conflicts

#### Sync Priorities
```yaml
sync_priority:
  critical:  # Sync immediately when online
    - orders
    - payments
    - clock_events

  high:  # Sync within minutes
    - inventory_updates
    - voids
    - refunds

  normal:  # Sync within hour
    - employee_updates
    - customer_data
    - audit_logs

  low:  # Sync daily
    - analytics
    - reports
    - media_files
```

### Offline Operations

#### Supported Offline
- [ ] Create and manage orders
- [ ] Process cash payments
- [ ] Process stored card tokens
- [ ] Clock in/out employees
- [ ] Print receipts/tickets
- [ ] Kitchen display updates
- [ ] Basic reporting (local data)

#### Limited Offline
- [ ] New card processing (queue)
- [ ] Gift card (cached balances)
- [ ] Loyalty (cached points)
- [ ] Online orders (queued)

#### Not Available Offline
- [ ] New employee creation
- [ ] Menu changes (admin)
- [ ] Cloud reporting
- [ ] Remote management

### Connectivity Monitoring

#### Health Checks
- [ ] Internet connectivity
- [ ] Cloud server reachability
- [ ] Local server status
- [ ] Device connectivity
- [ ] Database sync status

#### Status Indicators
```
Online:     🟢 All systems connected
Degraded:   🟡 Limited connectivity
Offline:    🔴 Operating on local cache
Syncing:    🔵 Restoring connection
```

### Failover Process

#### Automatic Failover
```
1. Internet drops
2. System detects within 5 seconds
3. Switches to local server mode
4. All terminals notified
5. Operations continue seamlessly
6. Data queued for sync
```

#### Recovery Process
```
1. Internet restored
2. System detects connection
3. Begin priority sync
4. Process queued payments
5. Reconcile conflicts
6. Full sync complete
7. Return to normal mode
```

### Conflict Resolution

#### Conflict Types
- [ ] Same order modified on different devices
- [ ] Inventory count discrepancies
- [ ] Clock events during offline
- [ ] Payment processing conflicts

#### Resolution Strategies
```yaml
conflict_resolution:
  orders:
    strategy: "last_write_wins"
    merge_items: true

  inventory:
    strategy: "sum_changes"
    alert_discrepancy: true

  payments:
    strategy: "server_authoritative"
    require_review: true

  clock_events:
    strategy: "accept_all"
    flag_overlaps: true
```

### Local Database

#### Cached Data
- [ ] Complete menu with modifiers
- [ ] All active employees
- [ ] Open orders/tabs
- [ ] Recent closed orders (7 days)
- [ ] Customer data (frequently used)
- [ ] Inventory counts
- [ ] Configuration/settings

#### Cache Management
- [ ] Automatic cache refresh
- [ ] Manual force refresh
- [ ] Cache size limits
- [ ] Data retention policies

### Payment Handling Offline

#### Card Processing
- [ ] Store-and-forward queuing
- [ ] Offline authorization limits
- [ ] Token-based repeat charges
- [ ] Risk thresholds

#### Offline Payment Limits
```yaml
offline_payment_limits:
  per_transaction: 100.00
  per_card_per_day: 200.00
  total_queued: 2000.00
  require_signature_above: 25.00
```

---

## UI/UX Specifications

### System Status Bar

```
+------------------------------------------------------------------+
| [🟢 ONLINE] Last sync: Just now          Server: Connected       |
+------------------------------------------------------------------+

-- OR --

+------------------------------------------------------------------+
| [🔴 OFFLINE] Local mode since 2:30 PM    Queued: 5 transactions  |
+------------------------------------------------------------------+
```

### Offline Mode Notification

```
+------------------------------------------------------------------+
|                    ⚠️ OFFLINE MODE ACTIVE                         |
+------------------------------------------------------------------+
|                                                                   |
| Internet connection lost at 2:30 PM                              |
|                                                                   |
| ✓ Orders and tabs working normally                               |
| ✓ Cash payments accepted                                         |
| ✓ Kitchen display synced locally                                 |
| ⚠️ Card payments limited to $100 per transaction                 |
| ⚠️ Gift cards using cached balances                              |
|                                                                   |
| Queued for sync: 3 orders, 2 payments                            |
|                                                                   |
| [Dismiss]                          [View Details]                |
+------------------------------------------------------------------+
```

### Server Status Dashboard

```
+------------------------------------------------------------------+
| LOCAL SERVER STATUS                              Admin Only       |
+------------------------------------------------------------------+
|                                                                   |
| CONNECTIVITY                                                      |
| +------------------+ +------------------+ +------------------+    |
| | Internet         | | Cloud Server     | | Local Server     |    |
| | 🟢 Connected     | | 🟢 Connected     | | 🟢 Running       |    |
| | Latency: 45ms    | | Last sync: Now   | | Uptime: 14d 6h   |    |
| +------------------+ +------------------+ +------------------+    |
|                                                                   |
| CONNECTED DEVICES                                                 |
| +--------------------------------------------------------------+ |
| | Device            | Status    | Last Seen | Sync Status      | |
| +--------------------------------------------------------------+ |
| | Terminal 1 (Main) | 🟢 Online | Just now  | ✓ Synced         | |
| | Terminal 2 (Bar)  | 🟢 Online | Just now  | ✓ Synced         | |
| | KDS - Kitchen     | 🟢 Online | Just now  | ✓ Synced         | |
| | Server Handheld 1 | 🟢 Online | 2 min ago | ✓ Synced         | |
| | Server Handheld 2 | 🟡 Weak   | 5 min ago | ⚠️ Pending (2)   | |
| +--------------------------------------------------------------+ |
|                                                                   |
| SYNC QUEUE                                                        |
| Pending uploads: 0 | Pending downloads: 0 | Conflicts: 0        |
|                                                                   |
| LOCAL STORAGE                                                     |
| Database: 2.4 GB / 100 GB | Cache: 1.2 GB | Free: 96.4 GB       |
|                                                                   |
| [Force Sync]  [Clear Cache]  [Restart Server]  [Diagnostics]    |
+------------------------------------------------------------------+
```

### Sync Status Detail

```
+------------------------------------------------------------------+
| SYNC DETAILS                                                      |
+------------------------------------------------------------------+
|                                                                   |
| LAST SYNC: January 27, 2026 2:45:32 PM                           |
| Duration: 1.2 seconds | Records: 47                              |
|                                                                   |
| SYNC LOG                                                          |
| +--------------------------------------------------------------+ |
| | Time     | Type        | Records | Status                     | |
| +--------------------------------------------------------------+ |
| | 2:45:32  | Orders      | 12      | ✓ Complete                | |
| | 2:45:31  | Payments    | 8       | ✓ Complete                | |
| | 2:45:30  | Inventory   | 15      | ✓ Complete                | |
| | 2:45:29  | Clock       | 5       | ✓ Complete                | |
| | 2:45:28  | Menu        | 0       | ✓ No changes              | |
| | 2:45:27  | Employees   | 2       | ✓ Complete                | |
| +--------------------------------------------------------------+ |
|                                                                   |
| PENDING QUEUE                                                     |
| No items pending                                                  |
|                                                                   |
| CONFLICTS (0)                                                     |
| No conflicts detected                                             |
|                                                                   |
+------------------------------------------------------------------+
```

---

## Data Model

### Sync Status
```sql
sync_status {
  id: UUID PRIMARY KEY
  location_id: UUID (FK)
  device_id: UUID (FK)

  -- Connectivity
  internet_status: VARCHAR(50)
  cloud_status: VARCHAR(50)
  local_server_status: VARCHAR(50)

  -- Timing
  last_internet_check: TIMESTAMP
  last_cloud_sync: TIMESTAMP
  last_local_sync: TIMESTAMP

  -- Queue
  pending_uploads: INTEGER DEFAULT 0
  pending_downloads: INTEGER DEFAULT 0
  pending_conflicts: INTEGER DEFAULT 0

  -- Mode
  operating_mode: VARCHAR(50) (online, offline, degraded, syncing)
  offline_since: TIMESTAMP (nullable)

  updated_at: TIMESTAMP
}
```

### Sync Queue
```sql
sync_queue {
  id: UUID PRIMARY KEY
  location_id: UUID (FK)
  device_id: UUID (FK)

  -- What to sync
  entity_type: VARCHAR(100)
  entity_id: UUID
  operation: VARCHAR(50) (create, update, delete)
  data: JSONB

  -- Priority
  priority: INTEGER DEFAULT 5

  -- Status
  status: VARCHAR(50) (pending, processing, completed, failed)
  attempts: INTEGER DEFAULT 0
  last_attempt: TIMESTAMP (nullable)
  error_message: TEXT (nullable)

  created_at: TIMESTAMP
  processed_at: TIMESTAMP (nullable)
}
```

### Sync Conflicts
```sql
sync_conflicts {
  id: UUID PRIMARY KEY
  location_id: UUID (FK)

  entity_type: VARCHAR(100)
  entity_id: UUID

  -- Conflicting data
  local_data: JSONB
  server_data: JSONB
  local_timestamp: TIMESTAMP
  server_timestamp: TIMESTAMP

  -- Resolution
  status: VARCHAR(50) (pending, resolved, manual_required)
  resolution: VARCHAR(50) (nullable) -- local_wins, server_wins, merged
  resolved_data: JSONB (nullable)
  resolved_by: UUID (FK, nullable)
  resolved_at: TIMESTAMP (nullable)

  created_at: TIMESTAMP
}
```

### Offline Payments Queue
```sql
offline_payments_queue {
  id: UUID PRIMARY KEY
  location_id: UUID (FK)
  order_id: UUID (FK)

  -- Payment details
  amount: DECIMAL(10,2)
  payment_method: VARCHAR(50)
  card_token: VARCHAR(500) (nullable)
  card_last_four: VARCHAR(4) (nullable)

  -- Status
  status: VARCHAR(50) (queued, processing, completed, failed, declined)

  -- Processing
  queued_at: TIMESTAMP
  processed_at: TIMESTAMP (nullable)
  processor_response: JSONB (nullable)

  -- Fallback
  fallback_required: BOOLEAN DEFAULT false
  fallback_handled: BOOLEAN DEFAULT false

  created_at: TIMESTAMP
}
```

### Local Server Config
```sql
local_server_config {
  location_id: UUID PRIMARY KEY (FK)

  -- Server settings
  server_enabled: BOOLEAN DEFAULT true
  server_ip: VARCHAR(45)
  server_port: INTEGER DEFAULT 8080

  -- Sync settings
  sync_interval_seconds: INTEGER DEFAULT 30
  full_sync_interval_hours: INTEGER DEFAULT 24

  -- Cache settings
  cache_days_orders: INTEGER DEFAULT 7
  cache_days_customers: INTEGER DEFAULT 30
  max_cache_size_gb: INTEGER DEFAULT 50

  -- Offline limits
  offline_payment_limit: DECIMAL(10,2) DEFAULT 100.00
  offline_queue_limit: DECIMAL(10,2) DEFAULT 2000.00

  updated_at: TIMESTAMP
}
```

---

## API Endpoints

### Status
```
GET    /api/local/status
GET    /api/local/health
GET    /api/local/devices
POST   /api/local/ping
```

### Sync
```
POST   /api/sync/full
POST   /api/sync/incremental
GET    /api/sync/queue
GET    /api/sync/conflicts
POST   /api/sync/conflicts/{id}/resolve
```

### Cache
```
GET    /api/local/cache/status
POST   /api/local/cache/refresh
POST   /api/local/cache/clear
GET    /api/local/cache/{entity}
```

### Offline
```
GET    /api/offline/payments/queue
POST   /api/offline/payments/process
GET    /api/offline/mode
POST   /api/offline/mode/force
```

---

## Business Rules

1. **Seamless Failover:** Operations must not visibly interrupt during failover
2. **Data Integrity:** No data loss during offline periods
3. **Payment Safety:** Offline payments respect risk limits
4. **Conflict Resolution:** Clear rules for data conflicts
5. **Recovery Priority:** Critical data syncs first on recovery
6. **Cache Freshness:** Menu and employee data refreshed regularly

---

## Permissions

| Action | Staff | Manager | Admin |
|--------|-------|---------|-------|
| View status | Yes | Yes | Yes |
| Force sync | No | Yes | Yes |
| Resolve conflicts | No | Yes | Yes |
| Configure settings | No | No | Yes |
| Clear cache | No | No | Yes |
| Restart server | No | No | Yes |

---

## Configuration Options

```yaml
local_server:
  hardware:
    server_ip: "192.168.1.100"
    server_port: 8080
    heartbeat_interval: 5

  sync:
    interval_seconds: 30
    full_sync_hours: 24
    retry_attempts: 3
    retry_delay_seconds: 10

  cache:
    orders_days: 7
    customers_days: 30
    max_size_gb: 50
    auto_cleanup: true

  offline:
    payment_limit: 100.00
    daily_card_limit: 200.00
    total_queue_limit: 2000.00
    require_signature: 25.00

  failover:
    detection_seconds: 5
    auto_failover: true
    notify_staff: true

  recovery:
    auto_sync: true
    priority_order:
      - payments
      - orders
      - clock_events
      - inventory
```

---

## Deployment Guide

### Initial Setup
1. Install local server hardware
2. Connect to local network
3. Configure server IP and port
4. Register with cloud server
5. Initial full sync
6. Verify all devices connected

### Maintenance
- Daily: Check sync status
- Weekly: Review conflict logs
- Monthly: Clear old cache
- Quarterly: Test failover

---

*Last Updated: January 27, 2026*
