# GWI POS Authority Model

> **Canonical reference.** This document defines who owns what across the MC (Management Console / Neon), NUC (venue server), and sync layer. Every sync, provisioning, and schema decision must conform to these rules.

---

## 1. Authority Domains

### MC / Neon Owns (Global Source of Truth)

MC and its backing Neon databases are the **global authority** for anything that spans venues or defines what a venue _is_.

| Domain | Examples |
|--------|----------|
| Venue identity and registration | Organization, Enterprise, Location records |
| Canonical Neon DB creation | One Neon database per venue, created by MC |
| Canonical schema version | `_venue_schema_state` row in Neon |
| Canonical base seed | Menu, employees, roles, settings pushed into Neon before first boot |
| Rollout artifacts and version contract | Which POS build a venue should run, expected schema version |
| Fleet health / provisioning state | Per-venue status, last heartbeat, schema drift alerts |
| Organization / enterprise metadata | Multi-venue hierarchy, billing, subscription tier |
| Global permission templates | Role templates pushed down to venues |
| Release / version contract | Mapping of POS build version to required schema version |
| Fleet commands | Remote restart, force-update, maintenance mode |

### NUC Owns (Local Runtime Authority)

The NUC is the **runtime authority** for everything that happens inside a venue during service.

| Domain | Examples |
|--------|----------|
| Local app runtime | Next.js server, Socket.io hub, background workers |
| Local PostgreSQL | All venue operational data lives here first |
| Local migrations | Applied on boot; must be compatible with current POS build |
| Serving all venue traffic | Orders, payments, KDS, devices, floor plan, timeclock |
| Durable local mutation log / outage queue | Every cloud-bound write is queued durably before upstream send |
| Reporting health and lag to MC | Heartbeat, schema version, queue depth, sync watermark |
| `_local_schema_state` | Tracks which migrations have been applied to local PG |

### Sync Layer Owns (Replication + Reconciliation)

The sync layer is the **data bridge** between local PG and Neon. It owns movement of data, not the data itself.

| Domain | Examples |
|--------|----------|
| Downstream replication | Neon to local PG (menu changes, employee updates, settings) |
| Upstream replication | Local PG to Neon (orders, payments, timeclock, audit trail) |
| Idempotency keys and replay | Ensures duplicate sends never create duplicate records |
| Conflict resolution rules | Deterministic rules for bidirectional models |
| Watermarks / high-water marks | Tracks replication progress in both directions |
| Reconciliation checks | Periodic full-table hash comparisons to detect drift |

---

## 2. Venue Lifecycle States

### PROVISIONING

MC is in full control. The venue does not yet exist as an operational site.

- MC creates the Neon database
- MC pushes schema DDL (Prisma migrations)
- MC writes the base seed (menu, employees, roles, settings, sections, tables)
- MC writes `_venue_schema_state` to record the schema version
- **Venue must NOT take orders**
- **NUC must NOT mutate Neon**

### ONLINE (Steady State)

The venue is operational. Local PG is the write-first target for all transactional data.

- All operational writes go to **local PG first**
- Upstream replication pushes local mutations to Neon through the outage-safe queue
- Downstream replication pulls cloud changes (menu edits, employee updates) from Neon to local PG
- MC monitors health via heartbeat and sync lag metrics
- Schema version must match between `_venue_schema_state` (Neon) and `_local_schema_state` (local PG)

### OFFLINE

Neon is unreachable. The venue continues operating without interruption.

- Venue continues writing to **local PG only**
- Every cloud-bound mutation lands in the **durable outbound queue**
- **ALL upstream models** must have outage protection -- not just orders and payments
- KDS, timeclock, tips, inventory, audit logs, void/refund logs -- everything queues
- Devices continue to function via the NUC's local Socket.io hub
- No downstream updates arrive; local PG serves stale cloud-owned data until reconnection

### RECONNECTING

Neon becomes reachable again. The system must fully converge before declaring health.

- NUC **drains the outbound queue** to Neon (idempotent, deterministic conflict rules)
- Downstream **catches up** from Neon to local PG (any cloud changes made during the outage)
- Only after **drain + catch-up = "fully converged"**
- MC is notified of convergence via the health endpoint
- Queue depth must reach zero; downstream watermark must match Neon's latest

---

## 3. Conflict Classes

### Safe Local-First

Always writable offline. Replayed upstream idempotently on reconnect. No merge conflict possible because these records originate exclusively at the venue.

| Model | Notes |
|-------|-------|
| Order | Immutable once created; amendments are new events |
| OrderItem | Tied to parent Order lifecycle |
| Payment | Idempotent by transaction reference |
| Ticket | Venue-originated |
| Seat | Venue-originated |
| Drawer | Cash management is local |
| Shift | Timeclock is local |
| TimeClockEntry | Timeclock is local |
| TipLedger | Financial audit trail |
| TipTransaction | Financial audit trail |
| TipDebt | Financial audit trail |
| CashTipDeclaration | Financial audit trail |
| AuditLog | Append-only |
| PrintJob | Local hardware |
| InventoryItemTransaction | Stock movements are local events |
| VoidLog | Append-only |
| RefundLog | Append-only |
| ErrorLog | Append-only |

### Cloud-Owned (Read-Only at Venue)

These records are created and updated exclusively by MC. The NUC receives them via downstream sync and must never mutate them.

| Model | Notes |
|-------|-------|
| `_venue_schema_state` | MC is sole writer |
| Provisioning status | MC lifecycle management |
| Organization | Enterprise hierarchy |
| Enterprise | Enterprise hierarchy |
| Global permission templates | Pushed from MC |
| Release / version contract | Build-to-schema mapping |
| FleetCommand | Remote operations |

### Controlled Bidirectional

These models can be edited at the venue (NUC) or in the cloud (MC). They require explicit conflict resolution rules.

| Model | Conflict Rule |
|-------|--------------|
| Employee | `lastMutatedBy` determines origin; `updatedAt` latest-wins |
| Role | `lastMutatedBy` determines origin; `updatedAt` latest-wins |
| EmployeePermissionOverride | `lastMutatedBy` determines origin; `updatedAt` latest-wins |
| MenuItem | `lastMutatedBy` determines origin; `updatedAt` latest-wins |
| Category | `lastMutatedBy` determines origin; `updatedAt` latest-wins |
| ModifierGroup | `lastMutatedBy` determines origin; `updatedAt` latest-wins |
| Modifier | `lastMutatedBy` determines origin; `updatedAt` latest-wins |
| Section | `lastMutatedBy` determines origin; `updatedAt` latest-wins |
| Table | `lastMutatedBy` determines origin; `updatedAt` latest-wins |
| LocationSettings | `lastMutatedBy` determines origin; `updatedAt` latest-wins |
| Reservation entities | `lastMutatedBy` determines origin; `updatedAt` latest-wins |

**Conflict resolution protocol for bidirectional models:**

1. **`lastMutatedBy`** field on every bidirectional record identifies the origin (`MC` or `NUC:<locationId>`)
2. **`updatedAt` comparison** breaks ties when both sides mutated the same record during an outage (latest wins)
3. **Protected models** (Order, Payment) are never subject to latest-wins overwrite. If a protected model somehow appears in a bidirectional conflict, it is **quarantined** for manual review rather than overwritten

---

## 4. What Cannot Write Where

This matrix defines the hard boundaries for schema DDL and state metadata writes.

| Writer | `_venue_schema_state` (Neon) | `_local_schema_state` (local PG) | Neon schema DDL | Local PG schema DDL |
|--------|:---:|:---:|:---:|:---:|
| **MC provisioning** | YES | NO | YES | NO |
| **MC rollout** | YES | NO | YES | NO |
| **Installer** | NO | YES | NO | YES (migrations only) |
| **NUC bootstrap** | NO (observe only in prod) | YES | NO (prod) | YES (migrations) |
| **Pre-start script** | NO | YES (migration tracking) | NO | YES (`prisma db push`, **NO** `--accept-data-loss`) |
| **Sync workers** | NO | NO | NO | NO (data only, never DDL) |

Key takeaways:

- **MC is the only process that writes `_venue_schema_state`** in Neon. Period.
- **Sync workers never touch schema.** They move rows, not tables.
- **`--accept-data-loss` is banned.** The pre-start script verifies schema compatibility; it does not destructively reshape.
- **NUC bootstrap in production observes** `_venue_schema_state` to confirm compatibility but never writes it.

---

## 5. Order-Ready Gate

A venue is **NOT** ready to take orders until **ALL** of the following conditions are satisfied:

- [ ] **Local schema applied** -- all migrations in the current POS build have been applied to local PG
- [ ] **Local seed present** -- critical tables are non-empty (MenuItem, Category, Section, Table, Role, Employee, LocationSettings)
- [ ] **Neon schema compatible** -- `_venue_schema_state` version matches or is ahead of `_local_schema_state`
- [ ] **Initial downstream sync complete** -- first full pull from Neon to local PG has finished
- [ ] **Outbound queue initialized** -- durable queue table exists and is ready to accept writes
- [ ] **Readiness level = ORDERS** -- internal state machine has advanced to the ORDERS state
- [ ] **Readiness acknowledged back to MC** -- health endpoint has reported ORDERS readiness to MC

If any condition is not met, the POS must display a "Not Ready" state and refuse to open the order flow. This gate prevents:

- Orders against an empty menu (missing seed)
- Orders that can never sync upstream (missing queue)
- Schema mismatch errors during order creation (incompatible migrations)
- Ghost venues that MC believes are offline

---

## 6. Invariants

These rules are absolute. Violating any of them is a system-level bug.

1. **MC / Neon is the SOLE authority for schema version truth.** `_venue_schema_state` is written only by MC provisioning and MC rollout. No other process, on any machine, may write this value.

2. **NUC NEVER mutates Neon schema in production.** The NUC may read Neon to confirm compatibility. It must not execute DDL against Neon in any production code path.

3. **Installer NEVER writes `_venue_schema_state`.** The installer applies local migrations and writes `_local_schema_state`. Schema version truth flows from MC, not from the installer.

4. **All upstream models have outage queue protection.** If a model is written at the venue and replicated to Neon, it must go through the durable outbound queue. No direct Neon writes from the NUC during normal operation.

5. **`syncedAt` is NEVER stamped during seed.** The `syncedAt` timestamp is owned exclusively by the sync worker. Seed operations must leave `syncedAt` as `NULL` so the sync worker knows which records still need replication.

6. **Partial seed = venue NOT ready for orders.** If the seed process fails partway through, the Order-Ready Gate (Section 5) must block order creation. There is no "good enough" partial state.

7. **Offline does NOT make NUC the long-term schema authority.** During an outage, the NUC has temporary transactional authority over local PG data. It does not gain authority over schema version, provisioning state, or any cloud-owned metadata. When connectivity returns, MC's schema version is canonical.

8. **Reconnect = queue drain + downstream catch-up before "converged."** The system is not healthy after reconnection until the outbound queue is fully drained AND downstream sync has caught up. Only then may MC mark the venue as converged.

---

## 7. Dual-Ingress Model (Cellular Terminals)

Cellular terminals are full POS clients that write through the cloud path (Neon)
when they cannot reach the local NUC. This makes the system dual-ingress:

- **Local ingress:** LAN terminals -> NUC -> local PG -> upstream sync to Neon
- **Cloud ingress:** Cellular terminals -> Vercel -> Neon -> downstream sync to NUC

Both are legitimate write paths. The sync layer converges them.

### Ownership Gating

Orders with `lastMutatedBy = 'local'` are protected from cellular mutation.
This prevents split-brain when a LAN terminal is actively working an order:

- **Mutate operations blocked:** Add item, send to kitchen, update order, comp/void
- **Payment always allowed:** Card processing must work regardless of origin
- **Read always allowed:** Cellular terminals can always view any order
- Orders with `lastMutatedBy = 'cloud'` can be mutated by either path

Implementation: `validateCellularOrderAccess()` in `src/lib/cellular-validation.ts`.
Wired into: items, send, order PUT/PATCH, void-payment, comp-void routes.

### Audit Trail

All orders carry device origin metadata for debugging and accountability:

- `Order.metadata.originDeviceType` -- `'cellular'` or `'lan'` (set at creation)
- `Order.metadata.originTerminalId` -- specific device identifier (set at creation)
- `Order.lastMutatedBy` -- `'cloud'` or `'local'` (updated on every mutation)
- `Order.originTerminalId` -- top-level field tracking the originating terminal

---

## Appendix: Decision Record

| Decision | Rationale |
|----------|-----------|
| Local-first writes for all transactional data | Venues must never stop taking orders due to cloud issues |
| MC owns schema version | Prevents split-brain schema drift across fleet |
| Sync workers are data-only | Keeps DDL authority centralized and auditable |
| `--accept-data-loss` banned | Schema must only move forward; destructive reshaping risks data loss |
| `syncedAt` null on seed | Clean separation between seed state and sync state |
| Quarantine over overwrite for protected models | Financial records must never be silently replaced |
| `lastMutatedBy` + `updatedAt` for bidirectional | Simple, deterministic, auditable conflict resolution |
| Order-Ready Gate is all-or-nothing | Partial readiness leads to subtle data loss scenarios |
| Cellular ownership gating on locally-owned orders | Prevents split-brain when LAN terminal is actively working an order |
| Payment exempt from ownership gating | Card processing must work regardless of originating terminal type |
| `originDeviceType` in order metadata | Debugging and accountability for dual-ingress order creation |
