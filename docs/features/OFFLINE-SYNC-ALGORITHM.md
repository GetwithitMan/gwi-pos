# GWI POS - Offline Sync Algorithm

**Version:** 1.0
**Updated:** January 30, 2026
**Status:** Reference Documentation

---

## Overview

GWI POS operates on a hybrid architecture where each location runs a local server (Ubuntu + Docker + PostgreSQL) that syncs to the cloud admin console. The system **must work 100% offline** and sync when connectivity returns.

This document specifies the sync algorithm that ensures data consistency between local servers and the cloud while handling conflicts, failures, and edge cases.

```
┌─────────────────────────────────────────────────────────────────┐
│                      CLOUD (Admin Console)                       │
│                                                                 │
│   ┌──────────────┐  ┌──────────────┐  ┌──────────────┐        │
│   │  Location A  │  │  Location B  │  │  Location C  │        │
│   │    (synced)  │  │    (synced)  │  │    (synced)  │        │
│   └──────────────┘  └──────────────┘  └──────────────┘        │
│                                                                 │
└───────────────────────────────┬─────────────────────────────────┘
                                │
                    ┌───────────┴───────────┐
                    │   Sync Service        │
                    │   (bidirectional)     │
                    └───────────┬───────────┘
                                │
          ┌─────────────────────┼─────────────────────┐
          │                     │                     │
          ▼                     ▼                     ▼
┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐
│   LOCAL SERVER  │  │   LOCAL SERVER  │  │   LOCAL SERVER  │
│   Location A    │  │   Location B    │  │   Location C    │
│                 │  │                 │  │                 │
│ ┌─────────────┐ │  │ ┌─────────────┐ │  │ ┌─────────────┐ │
│ │ Sync Queue  │ │  │ │ Sync Queue  │ │  │ │ Sync Queue  │ │
│ │syncedAt:null│ │  │ │syncedAt:null│ │  │ │syncedAt:null│ │
│ └─────────────┘ │  │ └─────────────┘ │  │ └─────────────┘ │
└─────────────────┘  └─────────────────┘  └─────────────────┘
```

---

## 1. Sync Queue Data Structure

### 1.1 How Changes Are Queued Locally

Every syncable table has two key fields:

```prisma
model AnyTable {
  // ... other fields ...

  syncedAt  DateTime?  // null = never synced, timestamp = last sync
  deletedAt DateTime?  // null = active, timestamp = soft deleted
}
```

**Queue Logic:**
- `syncedAt = null` → Record has NEVER been synced (new)
- `syncedAt < updatedAt` → Record has been MODIFIED since last sync
- `deletedAt != null AND syncedAt < deletedAt` → Record was DELETED since last sync

```typescript
// Query to find all pending changes
const pendingChanges = await db.order.findMany({
  where: {
    locationId,
    OR: [
      { syncedAt: null },                           // Never synced
      { updatedAt: { gt: db.raw('syncedAt') } },    // Modified since sync
      {
        deletedAt: { not: null },
        syncedAt: { lt: db.raw('deletedAt') }       // Deleted since sync
      }
    ]
  }
})
```

### 1.2 Queue Prioritization

Sync operations are prioritized to ensure business-critical data syncs first:

| Priority | Data Type | Reason |
|----------|-----------|--------|
| **1 (Highest)** | Orders & Payments | Revenue tracking, disputes, reporting |
| **2** | Time Clock & Shifts | Payroll accuracy |
| **3** | Customers | Loyalty points, marketing |
| **4** | Inventory Transactions | Stock levels |
| **5** | Menu Changes | Can be recreated from cloud |
| **6 (Lowest)** | Settings & Config | Rarely changes |

```typescript
const SYNC_PRIORITY = {
  Order: 1,
  Payment: 1,
  OrderItem: 1,
  OrderItemModifier: 1,
  TimeClockEntry: 2,
  Shift: 2,
  TipShare: 2,
  Customer: 3,
  InventoryTransaction: 4,
  MenuItem: 5,
  Category: 5,
  ModifierGroup: 5,
  Employee: 6,
  Role: 6,
} as const
```

### 1.3 Batch Size and Timing

| Setting | Value | Rationale |
|---------|-------|-----------|
| Batch Size | 100 records | Balance between throughput and memory |
| Sync Interval (online) | 5 minutes | Near real-time without overloading |
| Sync Interval (recovery) | 30 seconds | Aggressive catch-up after outage |
| Max Batch Age | 1 hour | Force sync even if batch not full |
| Timeout Per Batch | 30 seconds | Prevent hanging on slow connections |

```typescript
const SYNC_CONFIG = {
  batchSize: 100,
  intervalMs: 5 * 60 * 1000,        // 5 minutes
  recoveryIntervalMs: 30 * 1000,    // 30 seconds
  maxBatchAgeMs: 60 * 60 * 1000,    // 1 hour
  batchTimeoutMs: 30 * 1000,        // 30 seconds
}
```

---

## 2. Step-by-Step Sync Algorithm

### 2.1 Sync Flow Diagram

```
┌──────────────────────────────────────────────────────────────────────────┐
│                         SYNC CYCLE (Every 5 min)                          │
└──────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
                    ┌───────────────────────────────┐
                    │   1. Check Connectivity       │
                    │      ping cloud endpoint      │
                    └───────────────────────────────┘
                                    │
                         ┌──────────┴──────────┐
                         │                     │
                    [ONLINE]              [OFFLINE]
                         │                     │
                         ▼                     ▼
        ┌────────────────────────┐   ┌─────────────────────┐
        │  2. Pull Cloud Changes │   │  Queue continues    │
        │     (menu, settings)   │   │  accumulating       │
        └────────────────────────┘   │  locally            │
                         │           └─────────────────────┘
                         ▼
        ┌────────────────────────┐
        │  3. Detect Local       │
        │     Pending Changes    │
        │     (syncedAt check)   │
        └────────────────────────┘
                         │
                         ▼
        ┌────────────────────────┐
        │  4. Sort by Priority   │
        │     & Dependencies     │
        └────────────────────────┘
                         │
                         ▼
        ┌────────────────────────┐
        │  5. Process Batches    │◄───────────────────┐
        │     (100 records max)  │                    │
        └────────────────────────┘                    │
                         │                            │
                         ▼                            │
        ┌────────────────────────┐                    │
        │  6. Send to Cloud      │                    │
        │     with checksums     │                    │
        └────────────────────────┘                    │
                         │                            │
              ┌──────────┴──────────┐                 │
              │                     │                 │
         [SUCCESS]             [CONFLICT]             │
              │                     │                 │
              ▼                     ▼                 │
┌──────────────────────┐  ┌───────────────────┐      │
│  7a. Update syncedAt │  │  7b. Resolve      │      │
│      timestamp       │  │      Conflict     │      │
└──────────────────────┘  │      (Section 3)  │      │
              │           └───────────────────┘      │
              │                     │                 │
              └─────────┬───────────┘                 │
                        │                             │
                        ▼                             │
              ┌─────────────────────┐                 │
              │  More batches?      │─────[YES]──────┘
              └─────────────────────┘
                        │
                      [NO]
                        │
                        ▼
              ┌─────────────────────┐
              │  8. Log Sync Report │
              │     & Schedule Next │
              └─────────────────────┘
```

### 2.2 Detection of Pending Changes

```typescript
async function detectPendingChanges(locationId: string): Promise<SyncManifest> {
  const manifest: SyncManifest = {
    tables: {},
    totalRecords: 0,
    oldestChange: null,
  }

  for (const tableName of SYNCABLE_TABLES) {
    const pending = await db[tableName].findMany({
      where: {
        locationId,
        OR: [
          { syncedAt: null },
          { updatedAt: { gt: db.raw('syncedAt') } },
          {
            deletedAt: { not: null },
            syncedAt: { lt: db.raw('deletedAt') }
          }
        ]
      },
      select: { id: true, updatedAt: true, deletedAt: true },
      orderBy: { updatedAt: 'asc' }
    })

    if (pending.length > 0) {
      manifest.tables[tableName] = {
        count: pending.length,
        ids: pending.map(r => r.id),
        oldest: pending[0].updatedAt
      }
      manifest.totalRecords += pending.length

      if (!manifest.oldestChange || pending[0].updatedAt < manifest.oldestChange) {
        manifest.oldestChange = pending[0].updatedAt
      }
    }
  }

  return manifest
}
```

### 2.3 Ordering of Sync Operations

Sync order must respect **foreign key dependencies**:

```
Level 0 (Independent):
├── Employee
├── Role
├── Customer
├── Category
├── PrepStation
└── Drawer

Level 1 (Depends on Level 0):
├── MenuItem (→ Category, PrepStation)
├── ModifierGroup
├── Table (→ Section)
├── Shift (→ Employee, Drawer)
└── TimeClockEntry (→ Employee)

Level 2 (Depends on Level 1):
├── Modifier (→ ModifierGroup)
├── MenuItemModifierGroup (→ MenuItem, ModifierGroup)
├── Order (→ Employee, Table, Customer)
└── OrderType

Level 3 (Depends on Level 2):
├── OrderItem (→ Order, MenuItem)
├── Payment (→ Order)
├── OrderDiscount (→ Order)
└── TipShare (→ Shift, Employee)

Level 4 (Depends on Level 3):
├── OrderItemModifier (→ OrderItem, Modifier)
└── OrderItemIngredient (→ OrderItem, Ingredient)
```

```typescript
const SYNC_DEPENDENCY_ORDER = [
  // Level 0 - No dependencies
  ['Employee', 'Role', 'Customer', 'Category', 'PrepStation', 'Drawer'],
  // Level 1
  ['MenuItem', 'ModifierGroup', 'Table', 'Shift', 'TimeClockEntry'],
  // Level 2
  ['Modifier', 'MenuItemModifierGroup', 'Order', 'OrderType'],
  // Level 3
  ['OrderItem', 'Payment', 'OrderDiscount', 'TipShare'],
  // Level 4
  ['OrderItemModifier', 'OrderItemIngredient'],
]
```

### 2.4 Handling Foreign Key Dependencies

When syncing a record with foreign keys:

1. **Check if referenced record exists in cloud**
2. **If not, sync the parent first** (recursive)
3. **If parent sync fails, defer child record**

```typescript
async function ensureDependencies(
  record: SyncRecord,
  tableName: string
): Promise<boolean> {
  const foreignKeys = FOREIGN_KEY_MAP[tableName]

  for (const fk of foreignKeys) {
    const refId = record[fk.field]
    if (!refId) continue  // Nullable FK

    // Check if reference exists in cloud
    const existsInCloud = await cloudDb[fk.table].exists(refId)

    if (!existsInCloud) {
      // Try to sync the parent first
      const parent = await localDb[fk.table].findUnique({ where: { id: refId } })
      if (!parent) {
        // Orphaned record - log warning and skip
        logWarning(`Orphaned ${tableName}: ${record.id} references missing ${fk.table}: ${refId}`)
        return false
      }

      const parentSynced = await syncRecord(parent, fk.table)
      if (!parentSynced) {
        // Parent sync failed - defer this record
        return false
      }
    }
  }

  return true
}
```

### 2.5 Confirmation/Rollback Logic

Each sync batch is treated as a **transaction**:

```typescript
async function processSyncBatch(batch: SyncRecord[], tableName: string): Promise<SyncResult> {
  const results: SyncResult = {
    success: [],
    conflicts: [],
    errors: [],
  }

  // Start cloud transaction
  const cloudTx = await cloudDb.$transaction(async (tx) => {
    for (const record of batch) {
      try {
        // Check for conflicts
        const cloudRecord = await tx[tableName].findUnique({
          where: { id: record.id }
        })

        if (cloudRecord && hasConflict(record, cloudRecord)) {
          const resolved = await resolveConflict(record, cloudRecord, tableName)
          results.conflicts.push({ local: record, cloud: cloudRecord, resolved })
          await tx[tableName].upsert({
            where: { id: record.id },
            create: resolved,
            update: resolved,
          })
        } else {
          // No conflict - straight upsert
          await tx[tableName].upsert({
            where: { id: record.id },
            create: prepareForCloud(record),
            update: prepareForCloud(record),
          })
        }

        results.success.push(record.id)
      } catch (error) {
        results.errors.push({ id: record.id, error: error.message })
        throw error  // Rollback entire batch
      }
    }

    return results
  })

  // Only update local syncedAt after cloud confirms
  if (results.success.length > 0) {
    await localDb[tableName].updateMany({
      where: { id: { in: results.success } },
      data: { syncedAt: new Date() }
    })
  }

  return results
}
```

---

## 3. Conflict Resolution Rules

### 3.1 Last-Write-Wins Implementation

The default conflict resolution strategy is **Last-Write-Wins (LWW)** based on `updatedAt`:

```typescript
function resolveConflictLWW(
  local: SyncRecord,
  cloud: SyncRecord
): SyncRecord {
  // Compare timestamps
  if (local.updatedAt > cloud.updatedAt) {
    return local  // Local wins
  } else {
    return cloud  // Cloud wins
  }
}
```

### 3.2 Timestamp Comparison

```typescript
function hasConflict(local: SyncRecord, cloud: SyncRecord): boolean {
  // Conflict if cloud has changes since our last sync
  // AND we also have changes
  return (
    cloud.updatedAt > local.syncedAt &&
    local.updatedAt > local.syncedAt
  )
}
```

**Visual representation:**

```
Timeline:
─────────────────────────────────────────────────────────────►
         │                    │                    │
         │                    │                    │
    syncedAt            cloud.updatedAt      local.updatedAt
         │                    │                    │
         ▼                    ▼                    ▼
  Last sync to cloud    Cloud edited         Local edited
                              │                    │
                              └──────┬─────────────┘
                                     │
                               CONFLICT DETECTED
```

### 3.3 Handling Concurrent Edits to Same Record

When both local and cloud have modified the same record:

| Scenario | Resolution | Rationale |
|----------|------------|-----------|
| Both modified same fields | LWW by `updatedAt` | Simple, predictable |
| Different fields modified | **Field-level merge** | Preserve both changes |
| Local is more recent | Local wins | Respect latest edit |
| Cloud is more recent | Cloud wins, queue local alert | Notify user of override |

**Field-Level Merge (for non-critical data):**

```typescript
function fieldLevelMerge(
  local: SyncRecord,
  cloud: SyncRecord,
  base: SyncRecord  // State at last sync
): SyncRecord {
  const merged = { ...base }
  const MERGE_FIELDS = ['name', 'displayName', 'notes', 'settings']

  for (const field of MERGE_FIELDS) {
    const localChanged = local[field] !== base[field]
    const cloudChanged = cloud[field] !== base[field]

    if (localChanged && !cloudChanged) {
      merged[field] = local[field]
    } else if (cloudChanged && !localChanged) {
      merged[field] = cloud[field]
    } else if (localChanged && cloudChanged) {
      // Both changed - LWW for this field
      merged[field] = local.updatedAt > cloud.updatedAt
        ? local[field]
        : cloud[field]
    }
  }

  merged.updatedAt = new Date()
  return merged
}
```

### 3.4 Handling Deletions During Sync

**Delete-Update Conflict Matrix:**

| Local State | Cloud State | Resolution |
|-------------|-------------|------------|
| Deleted | Active (unchanged) | Delete propagates to cloud |
| Deleted | Modified since sync | **Keep cloud version** - notify user |
| Active | Deleted | **Restore locally** - notify user |
| Modified | Deleted | **Conflict** - create audit log, restore with local data |

```typescript
async function resolveDeleteConflict(
  local: SyncRecord,
  cloud: SyncRecord | null,
  tableName: string
): Promise<DeleteResolution> {
  // Case 1: Local deleted, cloud doesn't exist (already deleted)
  if (local.deletedAt && !cloud) {
    return { action: 'skip', reason: 'already_deleted_on_cloud' }
  }

  // Case 2: Local deleted, cloud was modified after our last sync
  if (local.deletedAt && cloud && cloud.updatedAt > local.syncedAt) {
    return {
      action: 'restore_local',
      data: cloud,
      reason: 'cloud_modified_after_local_delete',
      alert: true  // Notify user
    }
  }

  // Case 3: Local deleted, cloud unchanged
  if (local.deletedAt && cloud && cloud.updatedAt <= local.syncedAt) {
    return {
      action: 'delete_cloud',
      reason: 'propagate_local_delete'
    }
  }

  // Case 4: Local modified, cloud deleted
  if (!local.deletedAt && !cloud) {
    // Check if cloud ever had this record
    const wasDeleted = await cloudDb.auditLog.findFirst({
      where: {
        recordId: local.id,
        action: 'delete'
      }
    })

    if (wasDeleted) {
      return {
        action: 'create_cloud',
        data: local,
        reason: 'local_modified_after_cloud_delete',
        alert: true  // Notify user of resurrection
      }
    } else {
      return { action: 'create_cloud', reason: 'new_record' }
    }
  }

  return { action: 'sync_normal' }
}
```

### 3.5 Customer Data: Bidirectional Sync

Customer data syncs **bidirectionally through the cloud**, enabling:
- Loyalty points earned at Location A visible at Location B
- Customer preferences shared across all locations
- Visit history aggregated organization-wide

```
┌──────────────┐     ┌─────────────────┐     ┌──────────────┐
│  Location A  │────►│  CLOUD (hub)    │◄────│  Location B  │
│              │◄────│                 │────►│              │
│ Customer     │     │ Customer        │     │ Customer     │
│ - points: 50 │     │ - points: 150   │     │ - points: 100│
│ - visits: 3  │     │ - visits: 10    │     │ - visits: 7  │
└──────────────┘     │ (aggregated)    │     └──────────────┘
                     └─────────────────┘
```

**Sync Rules for Customer Data:**

| Field | Sync Strategy | Notes |
|-------|---------------|-------|
| `loyaltyPoints` | **Additive merge** | Sum deltas from all locations |
| `totalSpent` | **Additive merge** | Sum of all location spending |
| `totalOrders` | **Additive merge** | Count across all locations |
| `lastVisit` | **Most recent wins** | Latest timestamp from any location |
| `name`, `email`, `phone` | **LWW** | Last edit wins |
| `notes`, `tags` | **LWW with append option** | Locations can add, not remove |

```typescript
// Customer sync uses additive merge for numeric loyalty fields
function mergeCustomerData(local: Customer, cloud: Customer, base: Customer): Customer {
  return {
    ...local,
    // Additive fields: calculate delta and add to cloud
    loyaltyPoints: cloud.loyaltyPoints + (local.loyaltyPoints - base.loyaltyPoints),
    totalSpent: cloud.totalSpent + (local.totalSpent - base.totalSpent),
    totalOrders: cloud.totalOrders + (local.totalOrders - base.totalOrders),
    // Most recent wins
    lastVisit: local.lastVisit > cloud.lastVisit ? local.lastVisit : cloud.lastVisit,
    // LWW for profile fields
    firstName: local.updatedAt > cloud.updatedAt ? local.firstName : cloud.firstName,
    lastName: local.updatedAt > cloud.updatedAt ? local.lastName : cloud.lastName,
    email: local.updatedAt > cloud.updatedAt ? local.email : cloud.email,
    phone: local.updatedAt > cloud.updatedAt ? local.phone : cloud.phone,
  }
}
```

---

## 4. Edge Cases

### 4.1 Record Deleted Locally, Modified on Cloud

**Scenario:** Employee deletes a customer on POS, but another location updated that customer's loyalty points.

```
LOCAL                          CLOUD
─────                          ─────
Customer "John"                Customer "John"
  deleted: 10:30 AM             loyaltyPoints: 500 → 750
                                updatedAt: 10:45 AM
```

**Resolution:**
1. Cloud version wins (more recent activity)
2. Local deletion is rolled back
3. Alert generated for manager review

```typescript
// Alert generated
{
  type: 'SYNC_CONFLICT',
  severity: 'warning',
  message: 'Customer "John Doe" was deleted locally but modified on cloud. Record restored.',
  recordId: 'customer_xyz',
  tableName: 'Customer',
  localAction: 'delete',
  cloudAction: 'update',
  resolution: 'restored_from_cloud',
  timestamp: '2026-01-30T10:50:00Z'
}
```

### 4.2 Record Modified Locally, Deleted on Cloud

**Scenario:** Manager updates employee permissions locally, but admin console removed that employee.

**Resolution:**
1. Create audit log of the conflict
2. Restore record on cloud with local modifications
3. Flag for admin review

```typescript
async function handleLocalModifiedCloudDeleted(
  local: SyncRecord,
  tableName: string
): Promise<void> {
  // Create audit log
  await cloudDb.auditLog.create({
    data: {
      action: 'CONFLICT_RESURRECTION',
      tableName,
      recordId: local.id,
      locationId: local.locationId,
      beforeData: null,  // Was deleted
      afterData: local,
      reason: 'local_modification_after_cloud_delete',
      requiresReview: true,
    }
  })

  // Restore on cloud
  await cloudDb[tableName].create({
    data: {
      ...local,
      _restoredFromConflict: true,
      _conflictTimestamp: new Date(),
    }
  })

  // Generate admin alert
  await createAdminAlert({
    type: 'RESURRECTION_CONFLICT',
    tableName,
    recordId: local.id,
    locationId: local.locationId,
  })
}
```

### 4.3 Order Created Offline with Menu Items That Changed

**Scenario:** Location A creates an order offline. While offline, admin console updated the menu item price from $12 to $15.

```
OFFLINE ORDER                   CLOUD MENU
────────────                    ──────────
Order #1234                     MenuItem "Burger"
  - Burger @ $12.00               price: $12 → $15
  - (captured at order time)      updatedAt: during offline
```

**Resolution:** Orders are **immutable financial records**. Price at time of sale is preserved.

```typescript
// OrderItem stores price at time of sale
model OrderItem {
  menuItemId     String
  name           String    // Captured at order time
  price          Decimal   // Captured at order time
  originalPrice  Decimal?  // Original menu price (for reporting)
  // ...
}

// During sync, we do NOT update historical prices
async function syncOrder(order: Order): Promise<void> {
  // Order syncs with prices AS THEY WERE at time of sale
  // No reconciliation needed - order is the source of truth
  await cloudDb.order.upsert({
    where: { id: order.id },
    create: order,  // Prices are already captured
    update: order,
  })
}
```

### 4.4 Payment Processed Offline, Customer Disputes Online

**Scenario:** Cash payment processed offline, customer calls admin to dispute the charge.

```
LOCAL (OFFLINE)                CLOUD (DISPUTE)
───────────────                ────────────────
Payment #5678                  Dispute created
  status: completed              orderId: relates to #5678
  amount: $47.50                 status: pending
  method: cash                   reason: "wrong amount"
```

**Resolution:** Disputes are tracked separately and linked to payments after sync.

> **Note:** Full dispute workflow will be implemented based on the payment processor chosen. The design below represents the ideal flow that most processors support. Actual implementation may vary based on processor API capabilities (chargeback notifications, dispute evidence submission, etc.).

```typescript
// When local syncs and finds a dispute waiting
async function reconcileDispute(
  localPayment: Payment,
  cloudDispute: Dispute
): Promise<void> {
  // Link dispute to payment
  await cloudDb.dispute.update({
    where: { id: cloudDispute.id },
    data: {
      paymentId: localPayment.id,
      paymentSyncedAt: new Date(),
      localPaymentDetails: {
        amount: localPayment.amount,
        method: localPayment.paymentMethod,
        processedAt: localPayment.processedAt,
        // Processor-specific: attach transaction ID for evidence
        processorTransactionId: localPayment.transactionId,
      }
    }
  })

  // Create local alert for manager
  await localDb.alert.create({
    data: {
      type: 'PAYMENT_DISPUTE',
      orderId: localPayment.orderId,
      paymentId: localPayment.id,
      message: `Customer dispute filed for Order #${localPayment.orderId}`,
      requiresAction: true,
    }
  })

  // Future: Processor webhook integration for automatic dispute updates
  // - Stripe: dispute.created, dispute.updated webhooks
  // - Square: disputes.created webhook
  // - Heartland: Chargeback notification API
}
```

### 4.5 Split Orders Syncing Out of Order

**Scenario:** Parent order syncs before split children, or vice versa.

**Resolution:** Sync parent orders before split children.

```typescript
async function getSyncOrderForOrders(locationId: string): Promise<Order[]> {
  const orders = await db.order.findMany({
    where: {
      locationId,
      OR: [
        { syncedAt: null },
        { updatedAt: { gt: db.raw('syncedAt') } }
      ]
    }
  })

  // Sort: parents first, then children by splitIndex
  return orders.sort((a, b) => {
    // Parents (no parentOrderId) come first
    if (!a.parentOrderId && b.parentOrderId) return -1
    if (a.parentOrderId && !b.parentOrderId) return 1
    // Among siblings, sort by splitIndex
    if (a.parentOrderId === b.parentOrderId) {
      return (a.splitIndex || 0) - (b.splitIndex || 0)
    }
    return 0
  })
}
```

---

## 5. Retry Logic

### 5.1 Exponential Backoff Pattern

```typescript
const RETRY_CONFIG = {
  maxAttempts: 5,
  baseDelayMs: 1000,      // 1 second
  maxDelayMs: 60000,      // 1 minute cap
  backoffMultiplier: 2,
}

async function syncWithRetry(
  batch: SyncRecord[],
  tableName: string
): Promise<SyncResult> {
  let attempt = 0
  let lastError: Error | null = null

  while (attempt < RETRY_CONFIG.maxAttempts) {
    try {
      return await processSyncBatch(batch, tableName)
    } catch (error) {
      lastError = error
      attempt++

      if (attempt >= RETRY_CONFIG.maxAttempts) {
        break
      }

      // Calculate delay with exponential backoff + jitter
      const baseDelay = RETRY_CONFIG.baseDelayMs *
        Math.pow(RETRY_CONFIG.backoffMultiplier, attempt - 1)
      const jitter = Math.random() * 0.3 * baseDelay  // ±30% jitter
      const delay = Math.min(
        baseDelay + jitter,
        RETRY_CONFIG.maxDelayMs
      )

      console.log(`Sync attempt ${attempt} failed, retrying in ${delay}ms`)
      await sleep(delay)
    }
  }

  // All retries exhausted
  throw new SyncFailedError(
    `Sync failed after ${RETRY_CONFIG.maxAttempts} attempts`,
    lastError,
    batch
  )
}
```

**Retry Delay Sequence:**

| Attempt | Base Delay | With Jitter (approx) |
|---------|------------|----------------------|
| 1 | 1s | 1-1.3s |
| 2 | 2s | 2-2.6s |
| 3 | 4s | 4-5.2s |
| 4 | 8s | 8-10.4s |
| 5 | 16s | 16-20.8s |
| **Total** | | **~30-40s** |

### 5.2 Max Retry Attempts

| Error Type | Max Retries | Action After Exhaustion |
|------------|-------------|-------------------------|
| Network timeout | 5 | Mark as pending, wait for next cycle |
| 5xx Server error | 5 | Same as timeout |
| 4xx Client error | 1 | Log error, skip record, alert |
| Validation error | 0 | Log error, skip record, alert |
| Conflict | 3 | Apply conflict resolution |

### 5.3 Alerting on Persistent Failures

Alerts are delivered through **both channels**:
1. **Admin Console UI** - Real-time dashboard indicators and notification panel
2. **Email** - Sent to organization super admins for critical alerts

```typescript
const ALERT_THRESHOLDS = {
  consecutiveFailures: 3,      // Alert after 3 sync cycles fail
  staleDataMinutes: 30,        // Alert if oldest unsynced > 30 min
  queueSizeWarning: 1000,      // Alert if queue exceeds 1000 records
  queueSizeCritical: 5000,     // Critical alert at 5000 records
}

const ALERT_CHANNELS = {
  warning: ['admin_ui'],                    // UI only for warnings
  critical: ['admin_ui', 'email'],          // Both for critical
  conflict: ['admin_ui', 'email'],          // Both for unresolved conflicts
}

async function checkSyncHealth(locationId: string): Promise<SyncHealthStatus> {
  const status: SyncHealthStatus = {
    isHealthy: true,
    alerts: [],
  }

  // Check queue size
  const queueSize = await countPendingChanges(locationId)
  if (queueSize >= ALERT_THRESHOLDS.queueSizeCritical) {
    status.isHealthy = false
    status.alerts.push({
      severity: 'critical',
      type: 'QUEUE_SIZE_CRITICAL',
      message: `Sync queue has ${queueSize} pending records`,
    })
  } else if (queueSize >= ALERT_THRESHOLDS.queueSizeWarning) {
    status.alerts.push({
      severity: 'warning',
      type: 'QUEUE_SIZE_WARNING',
      message: `Sync queue has ${queueSize} pending records`,
    })
  }

  // Check oldest unsynced record
  const oldestUnsynced = await getOldestUnsyncedTimestamp(locationId)
  if (oldestUnsynced) {
    const ageMinutes = (Date.now() - oldestUnsynced.getTime()) / 60000
    if (ageMinutes >= ALERT_THRESHOLDS.staleDataMinutes) {
      status.alerts.push({
        severity: 'warning',
        type: 'STALE_DATA',
        message: `Oldest unsynced data is ${Math.round(ageMinutes)} minutes old`,
      })
    }
  }

  // Check consecutive failures
  const recentFailures = await getConsecutiveFailureCount(locationId)
  if (recentFailures >= ALERT_THRESHOLDS.consecutiveFailures) {
    status.isHealthy = false
    status.alerts.push({
      severity: 'critical',
      type: 'CONSECUTIVE_FAILURES',
      message: `Last ${recentFailures} sync attempts have failed`,
    })
  }

  return status
}
```

### 5.4 Manual Sync Trigger

**Super Admin only** - Manual sync is restricted to cloud-level super admins. Location owners and on-site staff cannot trigger manual syncs to prevent accidental data issues and ensure sync operations are managed centrally.

```typescript
// API endpoint (CLOUD ADMIN CONSOLE ONLY)
// POST /api/admin/locations/:locationId/sync/trigger
async function manualSyncTrigger(req: Request): Promise<Response> {
  const { locationId } = req.params
  const admin = await getAuthenticatedAdmin(req)

  // Check super admin permission (cloud-level only)
  if (!admin.isSuperAdmin) {
    return Response.json({ error: 'Super admin access required' }, { status: 403 })
  }

  // Send sync command to local server
  const result = await sendSyncCommand(locationId)

  // Log the action
  await logAdminAudit({
    action: 'MANUAL_SYNC_TRIGGER',
    adminId: admin.id,
    locationId,
    result: result.success ? 'success' : 'failed',
  })

  return Response.json({
    success: result.success,
    recordsSynced: result.recordsSynced,
    errors: result.errors,
  })
}
```

**UI Location:** Admin Console → Locations → [Location] → "Force Sync Now" button (super admin only)

---

## 6. Pseudocode Examples

### 6.1 syncPendingChanges() Function

```typescript
/**
 * Main sync orchestrator - called every 5 minutes or on-demand
 */
async function syncPendingChanges(locationId: string): Promise<SyncReport> {
  const report: SyncReport = {
    startedAt: new Date(),
    completedAt: null,
    tablesProcessed: [],
    totalRecordsSynced: 0,
    totalConflicts: 0,
    totalErrors: 0,
    errors: [],
  }

  try {
    // Step 1: Check connectivity
    const isOnline = await checkCloudConnectivity()
    if (!isOnline) {
      report.status = 'SKIPPED_OFFLINE'
      return report
    }

    // Step 2: Pull cloud changes first (menu, settings)
    await pullCloudChanges(locationId)

    // Step 3: Detect pending local changes
    const manifest = await detectPendingChanges(locationId)

    if (manifest.totalRecords === 0) {
      report.status = 'NO_PENDING_CHANGES'
      return report
    }

    // Step 4: Process by dependency level
    for (const level of SYNC_DEPENDENCY_ORDER) {
      for (const tableName of level) {
        if (!manifest.tables[tableName]) continue

        const tableReport = await syncTable(locationId, tableName, manifest.tables[tableName])

        report.tablesProcessed.push({
          table: tableName,
          synced: tableReport.success.length,
          conflicts: tableReport.conflicts.length,
          errors: tableReport.errors.length,
        })

        report.totalRecordsSynced += tableReport.success.length
        report.totalConflicts += tableReport.conflicts.length
        report.totalErrors += tableReport.errors.length
        report.errors.push(...tableReport.errors)
      }
    }

    report.status = report.totalErrors > 0 ? 'COMPLETED_WITH_ERRORS' : 'SUCCESS'

  } catch (error) {
    report.status = 'FAILED'
    report.errors.push({
      type: 'SYNC_FATAL_ERROR',
      message: error.message,
      stack: error.stack,
    })
  } finally {
    report.completedAt = new Date()
    await saveSyncReport(locationId, report)
    await checkSyncHealth(locationId)
  }

  return report
}

async function syncTable(
  locationId: string,
  tableName: string,
  tableManifest: TableManifest
): Promise<TableSyncResult> {
  const result: TableSyncResult = {
    success: [],
    conflicts: [],
    errors: [],
  }

  // Process in batches
  const batches = chunkArray(tableManifest.ids, SYNC_CONFIG.batchSize)

  for (const batchIds of batches) {
    const records = await localDb[tableName].findMany({
      where: { id: { in: batchIds } }
    })

    try {
      const batchResult = await syncWithRetry(records, tableName)
      result.success.push(...batchResult.success)
      result.conflicts.push(...batchResult.conflicts)
      result.errors.push(...batchResult.errors)
    } catch (error) {
      // Batch failed after all retries
      result.errors.push({
        batchIds,
        error: error.message,
      })
    }
  }

  return result
}
```

### 6.2 resolveConflict() Function

```typescript
/**
 * Resolve a sync conflict between local and cloud records
 */
async function resolveConflict(
  local: SyncRecord,
  cloud: SyncRecord,
  tableName: string
): Promise<ResolvedRecord> {
  const resolution: ResolvedRecord = {
    data: null,
    strategy: null,
    alert: false,
  }

  // Check for delete conflicts first
  if (local.deletedAt || !cloud) {
    const deleteResolution = await resolveDeleteConflict(local, cloud, tableName)
    if (deleteResolution.action !== 'sync_normal') {
      return {
        data: deleteResolution.data || local,
        strategy: deleteResolution.reason,
        alert: deleteResolution.alert || false,
      }
    }
  }

  // Determine conflict type
  const conflictType = classifyConflict(local, cloud, tableName)

  switch (conflictType) {
    case 'FINANCIAL_RECORD':
      // Orders, Payments - local always wins (source of truth)
      resolution.data = local
      resolution.strategy = 'LOCAL_WINS_FINANCIAL'
      break

    case 'REFERENCE_DATA':
      // Menu items, Categories - cloud wins (admin is source)
      resolution.data = cloud
      resolution.strategy = 'CLOUD_WINS_REFERENCE'
      resolution.alert = true  // Notify of local override
      break

    case 'OPERATIONAL_DATA':
      // Shifts, Time entries - field-level merge
      resolution.data = fieldLevelMerge(local, cloud, await getBaseRecord(local.id, tableName))
      resolution.strategy = 'FIELD_MERGE'
      break

    case 'CUSTOMER_DATA':
      // Customers - LWW with merge for non-conflicting fields
      if (local.updatedAt > cloud.updatedAt) {
        resolution.data = { ...cloud, ...local }  // Local overwrites
      } else {
        resolution.data = { ...local, ...cloud }  // Cloud overwrites
      }
      resolution.strategy = 'LWW_WITH_MERGE'
      break

    default:
      // Default: Last-write-wins
      resolution.data = local.updatedAt > cloud.updatedAt ? local : cloud
      resolution.strategy = 'LAST_WRITE_WINS'
  }

  // Log conflict for audit
  await logConflict({
    tableName,
    recordId: local.id,
    localData: local,
    cloudData: cloud,
    resolvedData: resolution.data,
    strategy: resolution.strategy,
  })

  return resolution
}

function classifyConflict(local: SyncRecord, cloud: SyncRecord, tableName: string): ConflictType {
  const FINANCIAL_TABLES = ['Order', 'OrderItem', 'Payment', 'OrderDiscount']
  const REFERENCE_TABLES = ['MenuItem', 'Category', 'ModifierGroup', 'Modifier']
  const OPERATIONAL_TABLES = ['Shift', 'TimeClockEntry', 'TipShare']
  const CUSTOMER_TABLES = ['Customer']

  if (FINANCIAL_TABLES.includes(tableName)) return 'FINANCIAL_RECORD'
  if (REFERENCE_TABLES.includes(tableName)) return 'REFERENCE_DATA'
  if (OPERATIONAL_TABLES.includes(tableName)) return 'OPERATIONAL_DATA'
  if (CUSTOMER_TABLES.includes(tableName)) return 'CUSTOMER_DATA'

  return 'GENERAL'
}
```

### 6.3 processSyncBatch() Function

```typescript
/**
 * Process a batch of records for sync to cloud
 */
async function processSyncBatch(
  batch: SyncRecord[],
  tableName: string
): Promise<BatchSyncResult> {
  const result: BatchSyncResult = {
    success: [],
    conflicts: [],
    errors: [],
    timing: {
      startedAt: new Date(),
      completedAt: null,
    },
  }

  // Validate batch
  if (batch.length === 0) {
    result.timing.completedAt = new Date()
    return result
  }

  if (batch.length > SYNC_CONFIG.batchSize) {
    throw new Error(`Batch size ${batch.length} exceeds max ${SYNC_CONFIG.batchSize}`)
  }

  // Process within cloud transaction
  try {
    await cloudDb.$transaction(async (tx) => {
      for (const record of batch) {
        // Ensure dependencies are synced
        const depsReady = await ensureDependencies(record, tableName)
        if (!depsReady) {
          result.errors.push({
            id: record.id,
            error: 'DEPENDENCY_NOT_READY',
            message: `Dependencies not synced for ${tableName}:${record.id}`,
          })
          continue
        }

        // Fetch cloud version
        const cloudRecord = await tx[tableName].findUnique({
          where: { id: record.id }
        })

        // Check for conflict
        if (cloudRecord && hasConflict(record, cloudRecord)) {
          const resolved = await resolveConflict(record, cloudRecord, tableName)

          result.conflicts.push({
            recordId: record.id,
            local: record,
            cloud: cloudRecord,
            resolved: resolved.data,
            strategy: resolved.strategy,
          })

          // Apply resolved record
          await tx[tableName].update({
            where: { id: record.id },
            data: sanitizeForCloud(resolved.data),
          })
        } else if (cloudRecord) {
          // No conflict - update
          await tx[tableName].update({
            where: { id: record.id },
            data: sanitizeForCloud(record),
          })
        } else {
          // New record - create
          await tx[tableName].create({
            data: sanitizeForCloud(record),
          })
        }

        result.success.push(record.id)
      }
    }, {
      timeout: SYNC_CONFIG.batchTimeoutMs,
    })

    // Update local syncedAt for successful records
    const now = new Date()
    await localDb[tableName].updateMany({
      where: { id: { in: result.success } },
      data: { syncedAt: now },
    })

  } catch (error) {
    // Transaction failed - nothing was committed
    result.errors.push({
      id: 'BATCH',
      error: error.code || 'TRANSACTION_FAILED',
      message: error.message,
    })

    // Re-throw for retry logic
    throw error
  }

  result.timing.completedAt = new Date()
  return result
}

/**
 * Remove local-only fields before sending to cloud
 */
function sanitizeForCloud(record: SyncRecord): CloudRecord {
  const { syncedAt, ...cloudData } = record
  return cloudData
}
```

---

## 7. Monitoring and Observability

### 7.1 Sync Metrics

```typescript
interface SyncMetrics {
  // Counters
  records_synced_total: number          // By table, direction
  conflicts_resolved_total: number      // By table, strategy
  sync_errors_total: number             // By table, error_type
  sync_cycles_total: number             // By status (success, partial, failed)

  // Gauges
  sync_queue_size: number               // Current pending records
  oldest_unsynced_age_seconds: number   // Staleness indicator

  // Histograms
  sync_cycle_duration_seconds: number   // Full cycle time
  batch_duration_seconds: number        // Per-batch time
  records_per_batch: number             // Batch sizes
}
```

### 7.2 Dashboard Indicators

| Indicator | Green | Yellow | Red |
|-----------|-------|--------|-----|
| Queue Size | < 100 | 100-1000 | > 1000 |
| Oldest Unsynced | < 10 min | 10-30 min | > 30 min |
| Sync Failures | 0 | 1-2 consecutive | 3+ consecutive |
| Conflict Rate | < 1% | 1-5% | > 5% |

---

## 8. Security Considerations

### 8.1 Data in Transit

- All sync traffic over HTTPS (TLS 1.3)
- API authentication via location-specific tokens
- Token rotation every 30 days

### 8.2 Data at Rest

- Cloud database encrypted (AES-256)
- Sync logs retained for 90 days
- PII fields (customer email, phone) encrypted at field level

### 8.3 Audit Trail

Every sync operation is logged:

```typescript
interface SyncAuditLog {
  id: string
  locationId: string
  tableName: string
  recordId: string
  action: 'create' | 'update' | 'delete' | 'conflict_resolve'
  beforeData: object | null
  afterData: object | null
  conflictStrategy: string | null
  syncedAt: Date
}
```

---

## Appendix A: Complete Syncable Tables List

| Table | Priority | Conflict Strategy | Notes |
|-------|----------|-------------------|-------|
| Order | 1 | Local wins | Financial record |
| OrderItem | 1 | Local wins | Part of order |
| OrderItemModifier | 1 | Local wins | Part of order |
| Payment | 1 | Local wins | Financial record |
| OrderDiscount | 1 | Local wins | Part of order |
| TimeClockEntry | 2 | Field merge | Payroll data |
| Shift | 2 | Field merge | Payroll data |
| TipShare | 2 | Field merge | Payroll data |
| Customer | 3 | LWW + merge | **Bidirectional** via cloud (loyalty, visits sync across all locations) |
| InventoryTransaction | 4 | Local wins | Audit trail |
| MenuItem | 5 | Cloud wins | Admin-controlled |
| Category | 5 | Cloud wins | Admin-controlled |
| ModifierGroup | 5 | Cloud wins | Admin-controlled |
| Modifier | 5 | Cloud wins | Admin-controlled |
| Employee | 6 | Cloud wins | Admin-controlled |
| Role | 6 | Cloud wins | Admin-controlled |

---

## Appendix B: Error Codes

| Code | Description | Action |
|------|-------------|--------|
| `SYNC_E001` | Cloud unreachable | Retry with backoff |
| `SYNC_E002` | Authentication failed | Alert, check token |
| `SYNC_E003` | Validation error | Log, skip record |
| `SYNC_E004` | Foreign key missing | Sync parent first |
| `SYNC_E005` | Transaction timeout | Reduce batch size |
| `SYNC_E006` | Conflict unresolvable | Alert for manual review |
| `SYNC_E007` | Disk full | Alert, clear logs |
| `SYNC_E008` | Rate limited | Increase interval |

---

*This document is the sync algorithm source of truth for GWI POS.*
*Last Updated: January 30, 2026*
