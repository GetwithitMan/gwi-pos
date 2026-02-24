# Skill 427: Bugfix Sprints A-D — Multi-Tenant, Floor Plan, Offline, Payments, KDS, PWA

**Status:** Done
**Date:** Feb 23, 2026

## Problem

Bug log audit identified 28 issues across multi-tenant isolation, floor plan, offline wiring, auth, payments, KDS/print, PWA, reporting, and schema cascades. Issues ranged from location cache not being venue-scoped (singleton instead of per-slug), missing locationId on schema models and API routes, offline order/print paths not wired, hardcoded 0% online tax, no pre-auth expiry tracking, no KDS audit trail, no PWA support, and overly permissive cascade delete rules.

## Solution

### 4 Sprints (A through D), 28 Bugs Addressed

- **16 confirmed fixed** (new code committed)
- **5 already fixed** (confirmed present from prior work)
- **5 not bugs** (investigated and closed)
- **2 confirmed implemented** (verified existing code covers them)

### Sprint A+B — 16 Fixes (commit `d53ebbb`, 23 files, 226 insertions)

| # | ID | Area | Fix Summary |
|---|-----|------|-------------|
| 1 | B1 | Multi-Tenant | Location cache keyed by venue slug instead of singleton |
| 2 | B2 | Multi-Tenant | CloudEventQueue adds locationId field, scoped cleanup |
| 3 | B3 | Multi-Tenant | ModifierTemplate + OrderOwnershipEntry add locationId + deletedAt |
| 4 | B4 | Multi-Tenant | Menu GET routes require locationId — no longer optional |
| 5 | B5 | Multi-Tenant | Socket room subscriptions validated against authenticated locationId |
| 6 | B6 | Floor Plan | Snapshot + table GET include 'sent' and 'in_progress' order statuses |
| 7 | B7 | Floor Plan | Seat drag positions persisted to DB via API call |
| 8 | B8 | Floor Plan | Table/Seat optimistic locking with version field |
| 9 | B9 | Offline | Offline order creation wired to OfflineManager.queueOrder() |
| 10 | B10 | Offline | Print jobs queued offline on failure |
| 11 | B11 | Offline | Already implemented — confirmed markForOfflineCapture exists |
| 12 | B12 | Offline | Already implemented — socket reconnect already re-joins rooms |
| 13 | B13 | Auth | Soft auth bypass removed from api-auth.ts |
| 14 | B16 | Reports | Daily report surcharge derivation from pricing program |
| 15 | B17 | Reports | Labor report date filter refactored |
| 16 | B18 | Reports | Product mix pairing grouped by orderId instead of timestamp |

### Sprint C+D — 12 Fixes (commit `7eb5ba2`, 21 files, 454 insertions, 5 new files)

| # | ID | Area | Fix Summary |
|---|-----|------|-------------|
| 1 | #384 | Payments | Online checkout calculates tax from location settings (was hardcoded 0%) |
| 2 | EDGE-6 | Payments | Pre-auth expiry tracking — preAuthExpiresAt field on Order |
| 3 | EDGE-7 | Payments | pending_auth recovery — auto-recover stale tabs, close-tab validation, new recovery endpoint |
| 4 | BUG 20 | KDS | KDS audit trail for bump/un-bump/complete/serve/resend |
| 5 | BUG 23 | Print | Printer health updated on every print attempt |
| 6 | BUG 24 | Print | Failover print events logged to AuditLog |
| 7 | #635 | PWA | PWA manifest (standalone, black theme) |
| 8 | #636 | PWA | Service worker (cache-first static, network-first API) |
| 9 | — | PWA | Offline disconnect banner |
| 10 | — | Multi-Tenant | 8 locationId bypass routes hardened |
| 11 | — | Schema | 5 cascade onDelete rules changed from Cascade to Restrict |
| 12 | — | Multi-Tenant | employees/[id], inventory/stock-adjust, integrations/test, categories/[id], upload, inventory/transactions, tickets, monitoring/errors |

### Bugs Investigated and Closed (NOT bugs)

| ID | Reason |
|----|--------|
| #416 (payroll tips 4x) | NOT A BUG — distinct data sources confirmed |
| #454 (split tips as payment) | NOT A BUG — correctly separated |
| #509-511 (socket/CFD rooms) | ALREADY FIXED |
| BUG 25 (printer fallback) | WORKING AS DESIGNED |
| B14 (PIN rate limiting) | ALREADY FIXED in Wave 1 |

## Files Modified

### Sprint A+B (commit `d53ebbb`)

| File | IDs | Changes |
|------|-----|---------|
| `src/lib/location-cache.ts` | B1 | Location cache keyed by venue slug instead of singleton |
| `prisma/schema.prisma` | B2, B3, B8 | CloudEventQueue locationId, ModifierTemplate + OrderOwnershipEntry locationId + deletedAt, Table/Seat version field |
| `src/lib/cloud-event-queue.ts` | B2 | CloudEventQueue adds locationId, scoped cleanup |
| `src/app/api/menu/items/route.ts` | B4 | Menu GET requires locationId |
| `src/app/api/menu/items/[id]/route.ts` | B4 | Menu item GET requires locationId |
| `src/lib/socket-server.ts` | B5 | Socket room subscriptions validated against authenticated locationId |
| `src/app/api/floorplan/snapshot.ts` | B6 | Snapshot includes 'sent' and 'in_progress' statuses |
| `src/app/api/tables/[id]/route.ts` | B6, B8 | Table GET includes active statuses, optimistic locking |
| `src/components/floor-plan/SeatNode.tsx` | B7 | Seat drag positions persisted to DB |
| `src/hooks/useActiveOrder.ts` | B9 | Offline order creation wired to OfflineManager.queueOrder() |
| `src/app/(pos)/orders/page.tsx` | B10 | Print jobs queued offline on failure |
| `src/components/payment/SplitCheckScreen.tsx` | B10 | Print jobs queued offline on failure |
| `src/lib/api-auth.ts` | B13 | Soft auth bypass removed |
| `src/app/api/reports/daily/route.ts` | B16 | Surcharge derivation from pricing program |
| `src/app/api/reports/labor/route.ts` | B17 | Labor report date filter refactored |
| `src/app/api/reports/product-mix/route.ts` | B18 | Product mix pairing grouped by orderId |

### Sprint C+D (commit `7eb5ba2`)

| File | IDs | Changes |
|------|-----|---------|
| `src/app/api/online/checkout/route.ts` | #384 | Tax calculated from location settings |
| `prisma/schema.prisma` | EDGE-6, cascade | preAuthExpiresAt on Order, 5 onDelete rules changed to Restrict |
| `src/app/api/orders/open-tab/route.ts` | EDGE-6, EDGE-7 | Pre-auth expiry tracking, pending_auth auto-recovery |
| `src/app/api/orders/close-tab/route.ts` | EDGE-7 | Close-tab validation for pending_auth |
| `src/app/api/system/recovery/pending-auth/route.ts` | EDGE-7 | New file: pending_auth recovery endpoint |
| `src/app/api/kds/route.ts` | BUG 20 | KDS audit trail for bump/un-bump/complete/serve/resend |
| `src/app/api/kds/expo/route.ts` | BUG 20 | Expo KDS audit trail |
| `src/app/api/print/kitchen/route.ts` | BUG 23, 24 | Printer health updated on every attempt, failover logged to AuditLog |
| `public/manifest.json` | #635 | New file: PWA manifest |
| `public/sw.js` | #636 | New file: Service worker |
| `src/components/ServiceWorkerRegistration.tsx` | #636 | New file: SW registration component |
| `src/components/OfflineDisconnectBanner.tsx` | — | New file: Offline disconnect banner |
| `src/app/layout.tsx` | — | Disconnect banner + SW registration integrated |
| `src/app/api/employees/[id]/route.ts` | — | locationId hardening |
| `src/app/api/inventory/stock-adjust/route.ts` | — | locationId hardening |
| `src/app/api/integrations/test/route.ts` | — | locationId hardening |
| `src/app/api/categories/[id]/route.ts` | — | locationId hardening |
| `src/app/api/upload/route.ts` | — | locationId hardening |
| `src/app/api/inventory/transactions/route.ts` | — | locationId hardening |
| `src/app/api/tickets/route.ts` | — | locationId hardening |
| `src/app/api/monitoring/errors/route.ts` | — | locationId hardening |

## Testing

### Sprint A+B
1. **B1** — Switch between venue slugs. Verify location cache returns correct venue data per slug (not stale singleton).
2. **B2** — Create cloud events at two locations. Verify each event has locationId and cleanup is scoped.
3. **B3** — Check ModifierTemplate and OrderOwnershipEntry records include locationId and deletedAt fields.
4. **B4** — Call `GET /api/menu/items` without locationId. Verify 400 error. With locationId, verify items returned.
5. **B5** — Connect two sockets with different locationIds. Verify room join rejected for wrong locationId.
6. **B6** — Open floor plan snapshot. Verify tables with 'sent' and 'in_progress' orders show as occupied.
7. **B7** — Drag a seat on the floor plan. Reload page. Verify seat position persisted.
8. **B8** — Open same table on two terminals. Edit on both. Verify second save returns version conflict error.
9. **B9** — Disconnect network. Create order. Verify order queued in OfflineManager.
10. **B10** — Disconnect network. Complete payment. Verify print job queued offline.
11. **B13** — Verify no soft auth bypass remains in api-auth.ts. Unauthenticated requests return 401.
12. **B16** — Run daily report with surcharges. Verify surcharge line derives from pricing program.
13. **B17** — Run labor report with date range. Verify dates filter correctly.
14. **B18** — Run product mix report. Verify pairings grouped by orderId, not timestamp.

### Sprint C+D
1. **#384** — Place online checkout order. Verify tax calculated from location settings, not 0%.
2. **EDGE-6** — Open tab with pre-auth. Verify preAuthExpiresAt field populated on Order.
3. **EDGE-7** — Let a pre-auth expire. Call recovery endpoint. Verify stale tab recovered. Test close-tab validation rejects expired auth.
4. **BUG 20** — Bump, un-bump, complete, serve, and resend items on KDS. Verify each action logged to AuditLog.
5. **BUG 23** — Send print job. Verify printer health record updated (success or failure).
6. **BUG 24** — Trigger printer failover. Verify failover event logged to AuditLog.
7. **#635** — Open app on mobile. Verify "Add to Home Screen" prompt appears with correct manifest.
8. **#636** — Install PWA. Go offline. Verify static assets served from cache, API calls attempt network first.
9. **Disconnect banner** — Disconnect network. Verify banner appears. Reconnect. Verify banner disappears.
10. **locationId hardening** — Call each hardened route without locationId. Verify 400/403 rejection.
11. **Cascade rules** — Delete an Order. Verify OrderItem, OrderCard, OrderItemModifier, OrderItemIngredient, OrderItemPizza NOT cascade-deleted (Restrict enforced).
