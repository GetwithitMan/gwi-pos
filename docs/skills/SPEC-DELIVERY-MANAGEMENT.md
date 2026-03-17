# SPEC: Delivery Management System

**Status:** MVP Complete
**Date:** 2026-03-17
**Feature Doc:** `docs/features/delivery.md`
**Original Planning Spec:** `docs/skills/SPEC-35-DELIVERY-TRACKING.md`

---

## Overview

Full in-house delivery operations for restaurants that manage their own delivery fleet. No third-party API dependencies (no Google Maps, no DoorDash). The system handles zones, dispatch, runs, driver sessions, cash control, proof of delivery, customer tracking, tip integration, and reporting.

**Design principles:**
1. Single entry point for all status changes (state machine pattern)
2. Two-layer feature gating (MC outer + venue inner, fail-closed)
3. Zero external mapping dependencies (Leaflet/OSM, zipcode geocoding)
4. Tip flow uses immutable ledger entries (consistent with existing tip bank architecture)
5. Fire-and-forget for all side effects (tips, notifications, audit logs)

---

## Architecture

### System Layers

```
Mission Control (Cloud)
  └─ LocationDeliveryFeatures (12 provisioned sub-features)
  └─ Feature sync to NUC via config sync
       │
NUC Server (gwi-pos)
  ├─ Feature Check Layer ──── isDeliveryFeatureActive()
  ├─ State Machine Layer ──── advanceDeliveryStatus() / advanceRunStatus() / advanceDriverSessionStatus()
  ├─ Domain Logic Layer ───── tip-reallocation.ts, delivery-tip-split.ts, proof-resolver.ts, dispatch-policy.ts
  ├─ API Route Layer ──────── 30+ routes under /api/delivery/
  ├─ Socket Event Layer ───── dispatch-events.ts (8 event types)
  ├─ Notification Layer ───── notifications.ts (Twilio SMS)
  ├─ UI Layer ─────────────── Dispatch Live, Owner Dashboard, Settings (4 pages), KDS Expo Rail
  └─ Public Layer ─────────── Customer tracking page (no auth, token-based)
```

### Feature Gating Architecture

Two-layer gating ensures delivery cannot activate without explicit enablement at both cloud and venue levels.

**Layer 1 — MC (Cloud):** `LocationDeliveryFeatures` model with:
- `deliveryModuleEnabled` (master switch)
- `disableMode` (5 levels: `active`, `new_orders_disabled`, `soft_disabled`, `fully_disabled`, `emergency_disabled`)
- 12 sub-feature provisioning flags

**Layer 2 — Venue (NUC):** `DeliverySettings.enabled` in location settings.

**Resolution:** `isDeliveryFeatureActive(settings, subfeature?, operation?)` in `src/lib/delivery/feature-check.ts`. Checks MC master flag, disable mode, venue flag, and optional sub-feature. Returns `false` (disabled) for any missing config (fail-closed).

**Disable Modes:**
| Mode | New Orders | Active Operations | Tracking |
|------|-----------|-------------------|----------|
| `active` | Allowed | Allowed | Allowed |
| `new_orders_disabled` | Blocked | Allowed | Allowed |
| `soft_disabled` | Blocked | Allowed | Allowed |
| `fully_disabled` | Blocked | Blocked | Blocked |
| `emergency_disabled` | Blocked | Blocked | Blocked + socket suppression |

**MC Sub-features (12):**
`dispatchBoardProvisioned`, `driverAppProvisioned`, `customerTrackingProvisioned`, `proofOfDeliveryProvisioned`, `exceptionsQueueProvisioned`, `deliveryReportsProvisioned`, `smsNotificationsProvisioned`, `deliveryKdsProvisioned`, `driverDocumentsProvisioned`, `scheduledOrdersProvisioned`

**Staleness detection:** `isFeatureConfigStale()` warns admin if NUC hasn't synced features in >1 hour.

---

## State Machines

### Delivery Order States (15)

```
                              ┌──────────────────────────────────────┐
                              │        Happy Path (left to right)     │
                              └──────────────────────────────────────┘

pending → confirmed → preparing → ready_for_pickup → assigned → dispatched → en_route → arrived → delivered

                              ┌──────────────────────────────────────┐
                              │        Exception Paths                │
                              └──────────────────────────────────────┘

arrived ──→ attempted ──→ delivered
         │            └──→ returned_to_store ──→ redelivery_pending ──→ assigned (re-enters happy path)
         └──→ failed_delivery ──→ returned_to_store
                              └──→ redelivery_pending

                              ┌──────────────────────────────────────┐
                              │        Cancellation Paths             │
                              └──────────────────────────────────────┘

pending/confirmed/preparing/ready_for_pickup/assigned → cancelled_before_dispatch
dispatched/en_route → cancelled_after_dispatch
returned_to_store → cancelled_after_dispatch
```

**Terminal states:** `delivered`, `cancelled_before_dispatch`, `cancelled_after_dispatch`

**Timestamp columns:** Each status transition sets a corresponding timestamp column (e.g., `dispatched` sets `dispatchedAt`, `delivered` sets `deliveredAt`).

### Run States (7)

```
assigned → handoff_ready → dispatched → in_progress → completed
                                                    → returned
Any non-terminal → cancelled
```

**Terminal states:** `completed`, `returned`, `cancelled`

**Auto-complete:** When ALL orders in a run reach terminal states, the run auto-advances to `completed` (or `cancelled` if all orders were cancelled). This is the single canonical auto-complete path -- `autoCompleteRunIfAllTerminal()` in `state-machine.ts`.

### Driver Session States (5)

```
available → on_delivery → returning → available
         → break → available
                 → off_duty
available → off_duty
```

**Terminal state:** `off_duty` (session `endedAt` set)

---

## Tip Flow

The delivery tip system integrates with the existing TipLedger architecture using a holding ledger pattern.

### Flow Diagram

```
Customer pays (delivery order)
    │
    ├── Driver assigned? ──── YES ──→ CREDIT to driver's TipLedger (DIRECT_TIP)
    │
    └── Driver NOT assigned? ──→ CREDIT to holding ledger (system:delivery_holding:{locationId})
                                    │
                                    └── On driver assignment (state machine → 'assigned')
                                            │
                                            └── reallocateTipToDriver()
                                                  DEBIT holding + CREDIT driver
                                                  (DELIVERY_REALLOCATION sourceType)
                                                  (idempotency key: delivery-realloc:{deliveryOrderId}:{driverId})

On delivery complete (state machine → 'delivered')
    │
    └── processDeliveryTipSplit() if driverTipMode != 'driver_keeps_100'
          DEBIT driver (kitchenTipSplitPercent) + CREDIT kitchen pool
          Default: 80% driver / 20% kitchen
```

### Reassignment

When a run is reassigned to a different driver BEFORE delivery:
- `reassignDriverTip()`: DEBIT from old driver, CREDIT to new driver
- Idempotency key: `delivery-reassign:{deliveryOrderId}:{newDriverEmployeeId}`
- If delivery is already `delivered`, the original driver keeps the tip

### Settings

| Setting | Default | Description |
|---------|---------|-------------|
| `driverTipMode` | `driver_keeps_100` | `driver_keeps_100` or `split_with_kitchen` |
| `driverTipSplitPercent` | 80 | Driver's share when splitting |
| `kitchenTipSplitPercent` | 20 | Kitchen's share when splitting |

---

## Proof of Delivery

### Proof Modes
| Mode | Photo | Signature |
|------|-------|-----------|
| `none` | No | No |
| `photo` | Yes | No |
| `signature` | No | Yes |
| `photo_and_signature` | Yes | Yes |

### Resolution
`evaluateEffectiveProofMode()` in `src/lib/delivery/proof-resolver.ts` runs once at dispatch time. The result is **frozen** on `DeliveryOrder.proofMode` and never re-evaluated.

**Escalation-only:** The resolver starts from the venue baseline mode and can only ADD capabilities based on policy conditions:
- `proofRequiredForFlaggedCustomers` — escalate if customer is flagged
- `proofRequiredForCashOrders` — escalate if cash payment
- `proofRequiredAboveAmount` — escalate if order total exceeds threshold
- `proofRequiredForAlcohol` — escalate if order contains alcohol
- `proofRequiredForApartments` — escalate if delivery is to an apartment

Capabilities (photo and signature) are independent flags merged with OR logic. A policy condition can never REMOVE a capability that the baseline already requires.

---

## Dispatch Policy Engine

`src/lib/delivery/dispatch-policy.ts` enforces venue dispatch rules. Each check returns a `PolicyCheckResult` with `{ allowed, reason?, requiresOverride? }`.

### Policy Settings

| Setting | Type | Description |
|---------|------|-------------|
| `assignmentStrategy` | Enum | `manual`, `round_robin`, `least_loaded`, `zone_affinity` |
| `driverAcceptanceRequired` | Boolean | Driver must accept before dispatch |
| `cashOnDeliveryAllowed` | Boolean | Allow cash orders for delivery |
| `requirePrepaymentAboveAmount` | Number | Force prepayment above this amount |
| `maxLateThresholdMinutes` | Number | Alert threshold for late deliveries |
| `maxCashBeforeForcedDrop` | Number | Max cash a driver can hold before forced drop |
| `maxOrdersPerDriverByTimeOfDay` | Object | `{ peak, offPeak }` — max concurrent orders |
| `blockDispatchWithoutValidZone` | Boolean | Require valid zone for dispatch |
| `voidAfterDispatchRequiresManager` | Boolean | Manager approval for post-dispatch void |
| `cashShortageApprovalRequired` | Boolean | Require approval for cash shortage at checkout |
| `driverCannotEndShiftWithOpenRun` | Boolean | Block clock-out with active run |
| `cannotDispatchSuspendedWithoutOverride` | Boolean | Block dispatch to suspended driver |
| `cannotMarkDeliveredWithoutRequiredProof` | Boolean | Block delivery complete without proof |
| `holdReadyUntilAllItemsComplete` | Boolean | Hold `preparing` → `ready_for_pickup` until all KDS items bumped |

### Policy Override
Operations that return `requiresOverride: true` can be bypassed with the `delivery.policy_override` permission.

---

## Zone Matching

Three matching strategies, evaluated in priority order:

1. **Zipcode match** (primary) — exact match against zone's `zipCodes` array
2. **Haversine radius** — haversine distance from zone center within `radiusMiles`
3. **Ray-casting polygon** — point-in-polygon test against zone's `polygonCoordinates`

No Google API. All computation is server-side. Maps use Leaflet/OSM for visual display.

---

## Database Schema

### Migration 066: `066-delivery-management.js`

**12 New Tables:**

| Table | Key Columns | Indexes |
|-------|------------|---------|
| `DeliveryZone` | locationId, name, zoneType (radius/polygon/zipcode), centerLat/Lng, radiusMiles, polygonCoordinates, zipCodes, deliveryFee, minimumOrder, isActive | locationId |
| `DeliveryDriver` | locationId, employeeId, vehicleType/Make/Model/Color, licensePlate, isActive, isSuspended | locationId, employeeId (unique) |
| `DeliveryDriverDocument` | driverId, documentType, expiresAt, verifiedAt | driverId |
| `DeliveryDriverSession` | locationId, driverId, employeeId, status, startedAt, endedAt, cashCollected, cashExpected | locationId+employeeId (unique partial: endedAt IS NULL) |
| `DeliveryRun` | locationId, driverId, status, orderSequence (JSONB), dispatchedAt, completedAt | locationId, driverId (unique partial: status NOT IN terminal) |
| `DeliveryAddress` | locationId, customerId, line1/line2/city/state/zip, lat/lng, isDefault | locationId+customerId |
| `DeliveryProofOfDelivery` | deliveryOrderId, photoStorageKey, signatureStorageKey, capturedAt | deliveryOrderId |
| `DeliveryTracking` | deliveryOrderId, driverId, lat, lng, accuracy, speed, recordedAt | deliveryOrderId+recordedAt |
| `DeliveryAuditLog` | locationId, action, deliveryOrderId, runId, driverId, employeeId, previousValue/newValue (JSONB), reason, idempotencyKey | locationId+createdAt, idempotencyKey (unique partial) |
| `DeliveryException` | locationId, deliveryOrderId, runId, driverId, type, severity, status, resolvedBy, resolvedAt | locationId+status |
| `DeliveryNotification` | locationId, status, smsTemplate, isActive | locationId+status |
| `DeliveryNotificationAttempt` | notificationId, deliveryOrderId, phone, status, twilioSid, sentAt | deliveryOrderId |

**24 Columns on Order (DeliveryOrder):**
Delivery-specific columns added directly to the existing `Order` model to avoid a separate join table. Includes `deliveryStatus`, `deliveryFee`, `deliveryTip`, `driverId`, `runId`, `zoneId`, `customerPhone`, `deliveryAddress`, `deliveryInstructions`, `addressSnapshotJson`, `proofMode`, `estimatedDeliveryAt`, `estimatedReadyAt`, `confirmedAt`, `assignedAt`, `dispatchedAt`, `enRouteAt`, `arrivedAt`, `deliveredAt`, `attemptedAt`, `failedAt`, `returnedAt`, `cancelledAt`, `cancelReason`.

---

## Socket Events

8 event types, all emitted via `emitToLocation()` (fire-and-forget):

| Event | Emitter | Consumers |
|-------|---------|-----------|
| `delivery:status_changed` | `dispatchDeliveryStatusChanged()` | Dispatch Live page, KDS Expo Rail |
| `delivery:updated` | `dispatchDeliveryStatusChanged()` | Legacy backward-compat |
| `delivery:run_created` | `dispatchRunEvent()` | Dispatch Live page |
| `delivery:run_completed` | `dispatchRunEvent()` | Dispatch Live page |
| `delivery:exception_created` | `dispatchExceptionEvent()` | Dispatch Live page |
| `delivery:exception_resolved` | `dispatchExceptionEvent()` | Dispatch Live page |
| `driver:location_update` | `dispatchDriverLocationUpdate()` | Dispatch Live page, Customer Tracking |
| `driver:status_changed` | `dispatchDriverStatusChanged()` | Dispatch Live page |

---

## Permissions

11 permission keys registered in `src/lib/permission-registry.ts`:

| Key | Level | Description |
|-----|-------|-------------|
| `delivery.view` | SHIFT_SERVICE | Read-only access to delivery queue and status board |
| `delivery.create` | SHIFT_SERVICE | Create new delivery orders from POS |
| `delivery.manage` | SHIFT_SERVICE | Edit delivery orders, update status, reassign drivers |
| `delivery.dispatch` | BUSINESS_SETUP | Assign drivers, send out for delivery |
| `delivery.settings` | BUSINESS_SETUP | Configure delivery fees, radius, dispatch policy |
| `delivery.zones.manage` | BUSINESS_SETUP | Create/edit/delete delivery zones |
| `delivery.drivers.manage` | BUSINESS_SETUP | Add/remove drivers from roster |
| `delivery.reports` | BUSINESS_SETUP | View delivery performance and driver efficiency reports |
| `delivery.audit` | BUSINESS_SETUP | View delivery audit trail, cash handling, proof records |
| `delivery.exceptions` | BUSINESS_SETUP | Handle delivery exceptions (late, refused, complaints) |
| `delivery.policy_override` | BUSINESS_SETUP | Override dispatch policies (zone, cash limits, proof) |

---

## SMS Notifications

`src/lib/delivery/notifications.ts` — Twilio integration for delivery status change notifications.

Configurable per status via `DeliveryNotification` records:
- Per-status SMS templates with variable substitution
- Configurable which statuses trigger notifications
- Opt-out tracking per customer
- `DeliveryNotificationAttempt` records delivery of each SMS (twilioSid for audit)
- Test endpoint at `POST /api/delivery/notifications/test`

---

## KDS Integration

### Delivery Expo Rail
`src/components/delivery/DeliveryExpoRail.tsx` — 5-column kanban view for delivery orders in KDS:
1. **Pending** — new orders
2. **Preparing** — in kitchen
3. **Ready** — awaiting driver
4. **Out** — dispatched
5. **Complete** — delivered

### KDS Bump Auto-Advance
`checkKdsBumpDeliveryAdvance()` in `state-machine.ts` — called after KDS bump to auto-advance `preparing` → `ready_for_pickup` when:
1. The bumped order has a linked DeliveryOrder
2. The delivery order is in `preparing` status
3. ALL order items are now completed (bumped)
4. `holdReadyUntilAllItemsComplete` dispatch policy is ON

---

## Maintenance Cron

`GET /api/cron/delivery-maintenance` (cron secret auth):
- **GPS breadcrumb pruning** — delete `DeliveryTracking` records older than 7 days
- **Stale session cleanup** — end sessions that have been active for >24 hours
- **Proof media key nulling** — null out `photoStorageKey` and `signatureStorageKey` on `DeliveryProofOfDelivery` records older than 90 days

---

## Driver Cash Reconciliation

### Checkout Flow
1. **Preview** (`GET /api/delivery/sessions/[id]/checkout/preview`): Calculate expected cash based on delivery orders with cash payments in the driver's completed runs
2. **Checkout** (`POST /api/delivery/sessions/[id]/checkout`): Record actual cash, calculate variance, set session status to `off_duty`
3. **Variance handling**: If `cashShortageApprovalRequired` policy is ON and variance exceeds threshold, requires manager approval

### DriverCheckoutModal
`src/components/delivery/DriverCheckoutModal.tsx` — UI for cash reconciliation with expected vs actual cash display.

---

## Customer Tracking

### Public Tracking Page
- `GET /api/public/delivery-tracking/[token]` — no auth required
- Token-based access (generated at order creation)
- Returns order status timeline, driver info (if assigned), ETA

### Live Driver Location
- `GET /api/public/delivery-tracking/[token]/location` — no auth required
- Returns latest GPS breadcrumb for the assigned driver
- Rate-limited to prevent abuse

### Maps
- `src/components/delivery/TrackingMap.tsx` — Leaflet/OSM customer-facing map
- `src/components/delivery/DeliveryMap.tsx` — Leaflet/OSM dispatch map (admin)

---

## Design Decisions

### Why no Google Maps API?
Google Maps API costs scale with usage. For a POS system deployed across many venues, per-request pricing is unpredictable. Leaflet/OSM is free and sufficient for the use case (delivery radius is typically <10 miles). Geocoding is zipcode-based which covers 95%+ of delivery address matching.

### Why columns on Order instead of a separate DeliveryOrder table?
Delivery orders ARE orders. They go through the same kitchen flow, payment flow, and reporting. A separate table would require JOINs everywhere and risk data inconsistency. The 24 delivery columns are nullable and only populated for delivery orders.

### Why a holding ledger for tips?
Delivery tips are often collected at payment time, before a driver is assigned. The holding ledger (a synthetic TipLedger with system employeeId) allows the tip to be tracked in the immutable ledger system from the moment of payment. When a driver is assigned, the tip is moved via paired DEBIT/CREDIT entries (consistent with all other tip movements in the system).

### Why freeze proofMode at dispatch?
Proof requirements must be deterministic for the driver. If proof mode could change mid-delivery (e.g., admin changes settings), the driver would see different requirements than what was shown at dispatch. Freezing at dispatch time ensures consistency and provides a clear audit trail.

### Why one active run per driver?
Prevents confusion about which orders belong to which run. Simplifies cash reconciliation (all cash in a session maps to runs in that session). DB unique partial index provides hard guarantee.

---

## Testing Summary

323 tests across 4 rounds, 27 bugs found and fixed:

- **Round 1:** Core state machine, zone matching, feature gating
- **Round 2:** Tip flow (holding ledger, reallocation, reassignment, kitchen split)
- **Round 3:** Dispatch policy, proof resolver, KDS integration, auto-complete
- **Round 4:** Edge cases (emergency disable, stale config, concurrent operations)

---

## Commits

gwi-pos: `0567a5d3` → `c15a92c9`

---

*Last updated: 2026-03-17*
