# Feature: Delivery Management

> **Before editing this feature:** Read `_CROSS-REF-MATRIX.md` → find Delivery → read every listed dependency doc.

## Summary
In-house delivery operations — zones, dispatch, runs, driver sessions, cash control, proof of delivery, customer tracking, and reporting. No third-party API dependencies. Two-layer feature gating: MC `LocationDeliveryFeatures` (outer) + venue `DeliverySettings.enabled` (inner). All delivery status changes flow through a single state machine function (`advanceDeliveryStatus()`). Tips are deferred until delivered via a holding ledger, then split using kitchen tip-out rules at settlement.

## Status
`Active` — MVP Complete (2026-03-17)

## Repos Involved
| Repo | Role | Coverage |
|------|------|----------|
| `gwi-pos` | API, domain logic, state machine, admin UI, dispatch, customer tracking | Full |
| `gwi-mission-control` | `LocationDeliveryFeatures` model, toggle UI, settings sync | Partial |

---

## UI Entry Points

| Interface | Path / Screen | Who Accesses |
|-----------|--------------|--------------|
| Admin | `/delivery` | Dispatch Live page — assignment, run management |
| Admin | `/delivery/dashboard` | Owner Dashboard — KPIs, analytics |
| Admin | `/delivery/third-party` | Third-party delivery management |
| Admin | `/settings/delivery` | General delivery settings |
| Admin | `/settings/delivery/zones` | Zone CRUD + map |
| Admin | `/settings/delivery/drivers` | Driver roster management |
| Admin | `/settings/delivery/dispatch-policy` | Dispatch policy configuration |
| Admin | `/settings/integrations/delivery` | Delivery integrations |
| Public | `/api/public/delivery-tracking/[token]` | Customer tracking page (no auth) |
| KDS | DeliveryExpoRail component | KDS 5-column delivery kanban |

---

## Code Locations

### Infrastructure (gwi-pos)
| File / Directory | Purpose |
|-----------------|---------|
| `src/lib/delivery/state-machine.ts` | `advanceDeliveryStatus()` — single entry point for ALL status changes |
| `src/lib/delivery/feature-check.ts` | `isDeliveryFeatureActive()` — two-layer feature gating |
| `src/lib/delivery/require-delivery-feature.ts` | Middleware wrapper for API routes |
| `src/lib/delivery/proof-resolver.ts` | `evaluateEffectiveProofMode()` — capability-based, escalation-only |
| `src/lib/delivery/dispatch-policy.ts` | Auto-suggest driver assignment, dispatch rules |
| `src/lib/delivery/dispatch-events.ts` | Socket dispatch helpers (fire-and-forget) |
| `src/lib/delivery/notifications.ts` | Twilio SMS notifications for delivery status changes |
| `src/lib/delivery/tip-reallocation.ts` | Tip holding ledger → driver reallocation |
| `src/lib/delivery/order-mapper.ts` | Map delivery orders to API response shapes |
| `src/lib/delivery/webhook-helpers.ts` | Webhook helpers for third-party integrations |
| `src/lib/domain/tips/delivery-tip-split.ts` | Kitchen tip-out split for delivery orders |
| `scripts/migrations/066-delivery-management.js` | 12 tables + 24 DeliveryOrder columns |

### API Routes
| File | Purpose |
|------|---------|
| `src/app/api/delivery/route.ts` | GET/POST — list/create delivery orders |
| `src/app/api/delivery/[id]/route.ts` | GET/PUT — delivery order detail/update status |
| `src/app/api/delivery/zones/route.ts` | GET/POST — zone CRUD |
| `src/app/api/delivery/zones/[id]/route.ts` | GET/PUT/DELETE — zone detail/update/delete |
| `src/app/api/delivery/zones/lookup/route.ts` | POST — zone matching (zipcode/radius/polygon) |
| `src/app/api/delivery/drivers/route.ts` | GET/POST — driver roster CRUD |
| `src/app/api/delivery/drivers/[id]/route.ts` | GET/PUT/DELETE — driver detail/update/deactivate |
| `src/app/api/delivery/drivers/[id]/documents/route.ts` | GET/POST — driver document management |
| `src/app/api/delivery/drivers/[id]/scorecard/route.ts` | GET — driver performance scorecard |
| `src/app/api/delivery/sessions/route.ts` | GET/POST — driver session start/list |
| `src/app/api/delivery/sessions/[id]/route.ts` | GET/PUT — session detail/status update |
| `src/app/api/delivery/sessions/[id]/checkout/route.ts` | POST — driver checkout (cash reconciliation) |
| `src/app/api/delivery/sessions/[id]/checkout/preview/route.ts` | GET — checkout preview (expected vs actual cash) |
| `src/app/api/delivery/dispatch/route.ts` | POST — dispatch orders to runs |
| `src/app/api/delivery/dispatch/auto-suggest/route.ts` | GET — auto-suggest driver for order |
| `src/app/api/delivery/runs/route.ts` | GET/POST — run CRUD |
| `src/app/api/delivery/runs/[id]/route.ts` | GET/PUT — run detail/update |
| `src/app/api/delivery/runs/[id]/reorder/route.ts` | PUT — reorder stops in a run |
| `src/app/api/delivery/runs/[id]/reassign/route.ts` | PUT — reassign run to different driver |
| `src/app/api/delivery/driver/status/route.ts` | PUT — driver self-status update |
| `src/app/api/delivery/driver/location/route.ts` | PUT — GPS breadcrumb from driver device |
| `src/app/api/delivery/driver/current-run/route.ts` | GET — driver's active run |
| `src/app/api/delivery/driver/order-status/route.ts` | PUT — driver marks order status |
| `src/app/api/delivery/driver/proof/route.ts` | POST — upload proof of delivery (photo/signature) |
| `src/app/api/delivery/exceptions/route.ts` | GET/POST — delivery exceptions list/create |
| `src/app/api/delivery/exceptions/[id]/route.ts` | GET/PUT — exception detail/resolve |
| `src/app/api/delivery/audit/route.ts` | GET — delivery audit log |
| `src/app/api/delivery/addresses/route.ts` | GET/POST — saved addresses CRUD |
| `src/app/api/delivery/addresses/[id]/route.ts` | GET/PUT/DELETE — address detail/update/delete |
| `src/app/api/delivery/addresses/geocode/route.ts` | POST — zipcode-based geocoding |
| `src/app/api/delivery/notifications/test/route.ts` | POST — test SMS notification |
| `src/app/api/public/delivery-tracking/[token]/route.ts` | GET — public customer tracking (no auth) |
| `src/app/api/public/delivery-tracking/[token]/location/route.ts` | GET — public driver location (no auth) |
| `src/app/api/cron/delivery-maintenance/route.ts` | GET — maintenance cron (GPS pruning, stale session cleanup) |
| `src/app/api/reports/delivery/route.ts` | GET — delivery analytics report |
| `src/app/api/reports/third-party-delivery/route.ts` | GET — third-party delivery report |

### UI Pages
| File | Purpose |
|------|---------|
| `src/app/(admin)/delivery/page.tsx` | Dispatch Live page |
| `src/app/(admin)/delivery/dashboard/page.tsx` | Owner Dashboard — KPIs |
| `src/app/(admin)/delivery/third-party/page.tsx` | Third-party delivery management |
| `src/app/(admin)/settings/delivery/page.tsx` | General delivery settings |
| `src/app/(admin)/settings/delivery/zones/page.tsx` | Zone management |
| `src/app/(admin)/settings/delivery/drivers/page.tsx` | Driver roster |
| `src/app/(admin)/settings/delivery/dispatch-policy/page.tsx` | Dispatch policy settings |
| `src/app/(admin)/settings/integrations/delivery/page.tsx` | Delivery integrations |

### Components
| File | Purpose |
|------|---------|
| `src/components/delivery/DeliveryExpoRail.tsx` | KDS delivery expo rail (5-column kanban) |
| `src/components/delivery/DeliveryMap.tsx` | Leaflet/OSM dispatch map |
| `src/components/delivery/TrackingMap.tsx` | Customer tracking map |
| `src/components/delivery/DriverCheckoutModal.tsx` | Driver checkout with cash reconciliation |

---

## API Endpoints

| Method | Route | Auth | Description |
|--------|-------|------|-------------|
| `GET` | `/api/delivery` | `delivery.view` | List delivery orders (filterable by status, date, driver) |
| `POST` | `/api/delivery` | `delivery.create` | Create delivery order |
| `GET` | `/api/delivery/[id]` | `delivery.view` | Delivery order detail |
| `PUT` | `/api/delivery/[id]` | `delivery.manage` | Update delivery order (status via state machine) |
| `GET` | `/api/delivery/zones` | `delivery.view` | List zones |
| `POST` | `/api/delivery/zones` | `delivery.zones.manage` | Create zone |
| `GET` | `/api/delivery/zones/[id]` | `delivery.view` | Zone detail |
| `PUT` | `/api/delivery/zones/[id]` | `delivery.zones.manage` | Update zone |
| `DELETE` | `/api/delivery/zones/[id]` | `delivery.zones.manage` | Delete zone |
| `POST` | `/api/delivery/zones/lookup` | `delivery.view` | Match address to zone |
| `GET` | `/api/delivery/drivers` | `delivery.drivers.manage` | List drivers |
| `POST` | `/api/delivery/drivers` | `delivery.drivers.manage` | Add driver |
| `GET` | `/api/delivery/drivers/[id]` | `delivery.drivers.manage` | Driver detail |
| `PUT` | `/api/delivery/drivers/[id]` | `delivery.drivers.manage` | Update driver |
| `DELETE` | `/api/delivery/drivers/[id]` | `delivery.drivers.manage` | Deactivate driver |
| `GET` | `/api/delivery/drivers/[id]/documents` | `delivery.drivers.manage` | List driver documents |
| `POST` | `/api/delivery/drivers/[id]/documents` | `delivery.drivers.manage` | Upload driver document |
| `GET` | `/api/delivery/drivers/[id]/scorecard` | `delivery.reports` | Driver performance scorecard |
| `GET` | `/api/delivery/sessions` | `delivery.view` | List driver sessions |
| `POST` | `/api/delivery/sessions` | `delivery.view` | Start driver session |
| `GET` | `/api/delivery/sessions/[id]` | `delivery.view` | Session detail |
| `PUT` | `/api/delivery/sessions/[id]` | `delivery.manage` | Update session status |
| `GET` | `/api/delivery/sessions/[id]/checkout/preview` | `delivery.manage` | Checkout preview |
| `POST` | `/api/delivery/sessions/[id]/checkout` | `delivery.manage` | Driver checkout (cash reconciliation) |
| `POST` | `/api/delivery/dispatch` | `delivery.dispatch` | Dispatch orders to run |
| `GET` | `/api/delivery/dispatch/auto-suggest` | `delivery.dispatch` | Auto-suggest driver |
| `GET` | `/api/delivery/runs` | `delivery.view` | List runs |
| `POST` | `/api/delivery/runs` | `delivery.dispatch` | Create run |
| `GET` | `/api/delivery/runs/[id]` | `delivery.view` | Run detail |
| `PUT` | `/api/delivery/runs/[id]` | `delivery.manage` | Update run |
| `PUT` | `/api/delivery/runs/[id]/reorder` | `delivery.dispatch` | Reorder stops |
| `PUT` | `/api/delivery/runs/[id]/reassign` | `delivery.dispatch` | Reassign run |
| `PUT` | `/api/delivery/driver/status` | Employee PIN | Driver self-status |
| `PUT` | `/api/delivery/driver/location` | Employee PIN | GPS breadcrumb |
| `GET` | `/api/delivery/driver/current-run` | Employee PIN | Active run |
| `PUT` | `/api/delivery/driver/order-status` | Employee PIN | Mark order status |
| `POST` | `/api/delivery/driver/proof` | Employee PIN | Upload proof |
| `GET` | `/api/delivery/exceptions` | `delivery.exceptions` | List exceptions |
| `POST` | `/api/delivery/exceptions` | `delivery.exceptions` | Create exception |
| `GET` | `/api/delivery/exceptions/[id]` | `delivery.exceptions` | Exception detail |
| `PUT` | `/api/delivery/exceptions/[id]` | `delivery.exceptions` | Resolve exception |
| `GET` | `/api/delivery/audit` | `delivery.audit` | Audit log |
| `GET` | `/api/delivery/addresses` | `delivery.view` | List saved addresses |
| `POST` | `/api/delivery/addresses` | `delivery.create` | Save address |
| `GET` | `/api/delivery/addresses/[id]` | `delivery.view` | Address detail |
| `PUT` | `/api/delivery/addresses/[id]` | `delivery.manage` | Update address |
| `DELETE` | `/api/delivery/addresses/[id]` | `delivery.manage` | Delete address |
| `POST` | `/api/delivery/addresses/geocode` | `delivery.view` | Geocode address |
| `POST` | `/api/delivery/notifications/test` | `delivery.settings` | Test SMS |
| `GET` | `/api/public/delivery-tracking/[token]` | Public | Customer tracking |
| `GET` | `/api/public/delivery-tracking/[token]/location` | Public | Driver location |
| `GET` | `/api/cron/delivery-maintenance` | Cron secret | GPS prune + stale session cleanup |
| `GET` | `/api/reports/delivery` | `delivery.reports` | Delivery analytics |
| `GET` | `/api/reports/third-party-delivery` | `delivery.reports` | Third-party analytics |

---

## Socket Events

### Emitted (POS → Clients)
| Event | Payload | Trigger |
|-------|---------|---------|
| `delivery:status_changed` | `{ deliveryOrderId, orderId, status, driverId, runId, updatedAt }` | Any delivery order status change |
| `delivery:updated` | `{ deliveryOrderId, orderId, status }` | Legacy backward-compat event (same trigger) |
| `delivery:run_created` | `{ runId, driverId, status, orderSequence, updatedAt }` | Run dispatched / in_progress |
| `delivery:run_completed` | `{ runId, driverId, status, orderSequence, updatedAt }` | Run reached terminal state |
| `delivery:exception_created` | `{ exceptionId, deliveryOrderId, runId, driverId, type, severity, status }` | Exception flagged |
| `delivery:exception_resolved` | `{ exceptionId, deliveryOrderId, runId, driverId, type, severity, status }` | Exception resolved |
| `driver:location_update` | `{ driverId, lat, lng, accuracy?, speed?, recordedAt }` | GPS breadcrumb from driver device |
| `driver:status_changed` | `{ sessionId, employeeId, driverId, status, lastLocationLat, lastLocationLng }` | Driver session state change |

---

## Data Model

### Migration 066: 12 New Tables + 24 DeliveryOrder Columns

**New Tables:**
- `DeliveryZone` — zone definitions (radius, polygon, zipcode)
- `DeliveryDriver` — driver roster linked to Employee
- `DeliveryDriverDocument` — license, insurance documents
- `DeliveryDriverSession` — clock-in/out sessions with cash tracking
- `DeliveryRun` — delivery run (batch of orders assigned to driver)
- `DeliveryAddress` — saved customer addresses
- `DeliveryProofOfDelivery` — photo + signature records
- `DeliveryTracking` — GPS breadcrumbs
- `DeliveryAuditLog` — immutable audit trail
- `DeliveryException` — exceptions (late, refused, complaint)
- `DeliveryNotification` — notification config per status
- `DeliveryNotificationAttempt` — SMS delivery tracking

**DeliveryOrder Columns (24 on Order):**
Delivery-specific fields added to the Order model (not a separate table) — includes `deliveryStatus`, `deliveryFee`, `driverId`, `runId`, `zoneId`, `customerPhone`, `deliveryAddress`, `addressSnapshotJson`, `proofMode`, `deliveryInstructions`, `estimatedDeliveryAt`, `dispatchedAt`, `deliveredAt`, and more.

---

## Business Logic

### State Machine — Single Entry Point
All delivery status changes flow through `advanceDeliveryStatus()` in `src/lib/delivery/state-machine.ts`. This function:
1. Validates the transition against the canonical transition map
2. Sets the corresponding timestamp column
3. Writes a `DeliveryAuditLog` entry
4. Fires socket events via `dispatchDeliveryStatusChanged()`
5. Triggers side effects (tip reallocation on `delivered`, run auto-complete check)

### Delivery Order States (15)
`pending` → `confirmed` → `preparing` → `ready_for_pickup` → `assigned` → `dispatched` → `en_route` → `arrived` → `delivered`

Exception paths: `attempted`, `failed_delivery`, `returned_to_store`, `redelivery_pending`, `cancelled_before_dispatch`, `cancelled_after_dispatch`

### Run States (7)
`assigned` → `handoff_ready` → `dispatched` → `in_progress` → `completed` | `returned` | `cancelled`

Run auto-completes when all orders in the run reach a terminal state.

### Driver Session States (5)
`available` → `on_delivery` → `returning` → `break` → `off_duty`

### Two-Layer Feature Gating
1. MC `deliveryModuleEnabled` must be `true` (outer gate)
2. MC `disableMode` must be `active` (5 modes: active, new_orders_disabled, soft_disabled, fully_disabled, emergency_disabled)
3. Venue `delivery.enabled` must be `true` (inner gate)
4. Optional subfeature check (12 provisioned features)

Fail-closed: missing config = disabled.

### Zone Matching
Matching priority: zipcode (primary), haversine radius, ray-casting polygon. No Google API — all server-side computation.

### Proof of Delivery
`evaluateEffectiveProofMode()` runs once at dispatch time. Result stored on `DeliveryOrder.proofMode`. Never re-evaluated after dispatch. Capabilities are escalation-only (photo + signature are independent; can only ADD requirements, never remove them based on policy conditions like cash orders, alcohol, flagged customers, apartments, high-value orders).

### Tip Flow
1. Pre-assignment tips go to system holding ledger `system:delivery_holding:{locationId}`
2. On driver assignment, tips reallocated from holding to driver via `reallocateTipToDriver()`
3. Kitchen tip-out split deferred until `delivered` state (not at payment time)
4. `DELIVERY_REALLOCATION` sourceType in TipLedgerEntry

### KDS Integration
KDS bump on delivery orders auto-advances `preparing` → `ready_for_pickup` via the state machine. `DeliveryExpoRail` component provides a 5-column kanban view for delivery orders in KDS.

### Maintenance Cron
`/api/cron/delivery-maintenance` handles:
- GPS breadcrumb pruning (7 days)
- Stale session cleanup
- Proof media storage key nulling (90 days)

---

## Cross-Feature Dependencies

> See `_CROSS-REF-MATRIX.md` for full matrix.

### This feature DEPENDS ON:
| Feature | How / Why |
|---------|-----------|
| Tips | Tip holding ledger, `postToTipLedger()`, kitchen split |
| Orders | Delivery orders are Orders with delivery columns |
| Customers | Customer address, phone |
| Settings | `mergeWithDefaults()`, `DeliverySettings` |
| KDS | Bump route auto-advances delivery status |
| Notifications (Twilio) | SMS status notifications |
| Roles & Permissions | 11 delivery permission keys |
| Socket dispatch | `emitToLocation()` for all events |

### This feature is DEPENDED ON BY:
| Feature | How / Why |
|---------|-----------|
| KDS | `DeliveryExpoRail` — 5-column delivery kanban |
| Reports | Delivery analytics, driver performance |
| Tips | `DELIVERY_REALLOCATION` sourceType in TipLedgerEntry |
| Payments | Tip resolution for delivery orders |

### BEFORE CHANGING THIS FEATURE, VERIFY:
- [ ] **State machine** — does this change bypass `advanceDeliveryStatus()`?
- [ ] **Feature gating** — does this change respect both MC and venue layer?
- [ ] **Tips** — does this change affect tip holding/reallocation flow?
- [ ] **KDS** — does this change affect the expo rail or bump auto-advance?
- [ ] **Proof mode** — is the proof mode still frozen at dispatch?
- [ ] **addressSnapshotJson** — is the address snapshot still immutable after `assigned`?

---

## Permissions Required

| Action | Permission Key | Level |
|--------|---------------|-------|
| View delivery queue and status | `delivery.view` | Standard |
| Create delivery orders | `delivery.create` | Standard |
| Edit delivery orders, update status, reassign | `delivery.manage` | High |
| Assign drivers, dispatch | `delivery.dispatch` | High |
| Configure delivery settings | `delivery.settings` | High |
| Manage delivery zones | `delivery.zones.manage` | High |
| Manage driver roster | `delivery.drivers.manage` | High |
| View delivery reports | `delivery.reports` | High |
| View delivery audit trail | `delivery.audit` | High |
| Handle delivery exceptions | `delivery.exceptions` | High |
| Override dispatch policies | `delivery.policy_override` | Critical |

---

## Known Constraints & Limits
- **Single entry point:** `advanceDeliveryStatus()` is the ONLY way to change delivery order status. Direct SQL UPDATE on status column is forbidden.
- **No Google API:** Maps use Leaflet/OSM. Geocoding is zipcode-based. No external mapping service dependency.
- **Run auto-complete:** Only fires through state machine (all entry points covered). Triggers when all orders in a run reach terminal state.
- **Settings cache 5-min TTL:** Feature toggles have propagation delay after MC sync.
- **One active run per driver:** DB unique partial index `DeliveryRun_driver_active_unique`. Application also validates before INSERT.
- **One active session per employee:** DB unique partial index. Only one clock-in session per driver at a time.
- **addressSnapshotJson immutability:** Frozen at `assigned` state. NEVER overwritten after. Dispatch reads from snapshot only.
- **proofMode frozen at dispatch:** `evaluateEffectiveProofMode()` runs once at dispatch. Result stored on `DeliveryOrder.proofMode`. Never re-evaluated.
- **Kitchen tip-out deferred until delivered:** Not at payment time. `DELIVERY_REALLOCATION` sourceType in TipLedgerEntry.
- **GPS breadcrumbs auto-pruned:** After 7 days via maintenance cron.
- **Proof media storage keys nulled:** After 90 days via maintenance cron.
- **Emergency disable mode:** Suppresses socket events and overrides tracking. Immediate effect.

---

## Related Docs
- **Original planning spec:** `docs/skills/SPEC-35-DELIVERY-TRACKING.md`
- **Implementation spec:** `docs/skills/SPEC-DELIVERY-MANAGEMENT.md`
- **Cross-ref matrix:** `docs/features/_CROSS-REF-MATRIX.md`
- **Tips domain:** `docs/domains/TIPS-DOMAIN.md`

---

*Last updated: 2026-03-17*
