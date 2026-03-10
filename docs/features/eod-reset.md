# Feature: EOD Reset

> **Before editing this feature:** Read `_CROSS-REF-MATRIX.md` → find this feature → read every listed dependency doc.

## Summary

The End of Day (EOD) Reset is a manager-triggered cleanup operation that prepares the POS for the next business day. It has two distinct endpoints with different scopes: `POST /api/eod/reset` is the primary full reset — it resets orphaned table statuses, logs stale cross-day orders to the audit trail, marks those orders as rolled over, emits order events for each affected order, and broadcasts an `eod:reset-complete` socket event to all terminals. `POST /api/orders/eod-cleanup` is a lighter supplementary cleanup — it cancels empty stale orders (zero total, no items) and rolls forward orders that have a balance, emitting `ORDER_CLOSED` events for each cancelled order. Both routes use the location's configured `businessDay.dayStartTime` to determine the current business day boundary. Neither route auto-closes orders with a balance; those require manual manager review.

## Status

`Active`

## Repos Involved

| Repo | Role | Coverage |
|------|------|----------|
| `gwi-pos` | Both EOD routes, FloorPlanHome socket consumer, audit log writes | Full |
| `gwi-android-register` | None — no direct call to EOD routes | None |
| `gwi-cfd` | None | None |
| `gwi-backoffice` | None | None |

---

## UI Entry Points

| Interface | Path / Screen | Notes |
|-----------|--------------|-------|
| Floor Plan (POS) | `src/components/floor-plan/FloorPlanHome.tsx` | Receives `eod:reset-complete` socket event and shows the EOD Summary Overlay (bottom-right toast) to all connected terminals |
| Dashboard (Admin) | `src/app/(admin)/dashboard/page.tsx` | "Close Day" button — calls dry-run preview first, then confirm dialog before executing `POST /api/eod/reset`. Requires `manager.close_day` permission. |
| Settings (Admin) | `src/app/(admin)/settings/payments/page.tsx` | Read-only "Nightly Batch Close" card showing batch time + auto-close status. "All tips must be entered before this time." Managed from MC. |

The EOD Summary Overlay is a fixed bottom-right panel showing: cancelled draft orders count, orders rolled to next business day, and tables reset to available. It is dismissed by a button tap. It appears on all terminals that receive the `eod:reset-complete` socket event.

---

## Code Locations

### gwi-pos

| File | Purpose |
|------|---------|
| `src/app/api/eod/reset/route.ts` | `POST /api/eod/reset` — primary reset. `GET /api/eod/reset` — pre-flight check (no changes made) |
| `src/app/api/orders/eod-cleanup/route.ts` | `POST /api/orders/eod-cleanup` — supplementary cleanup; cancels empty stale orders, rolls forward orders with balance |
| `src/components/floor-plan/FloorPlanHome.tsx` | Listens for `eod:reset-complete` socket event, sets `eodSummary` state, renders EOD Summary Overlay |
| `src/lib/events/types.ts` | `EodResetCompleteEvent` type definition (line 370); registered in `ServerToClientEvents` map (line 202) |
| `src/lib/business-day.ts` | `getCurrentBusinessDay(dayStartTime)` — computes the current business day start from a configured HH:MM time string |
| `src/app/api/cron/eod-batch-close/route.ts` | Automated nightly batch close cron — runs every 5 min, checks batch window, triggers Datacap batch close + table reset + walkout detection |
| `src/app/(admin)/dashboard/page.tsx` | "Close Day" button with dry-run preview and confirmation dialog |
| `src/app/(admin)/settings/payments/page.tsx` | Read-only "Nightly Batch Close" visual card |

---

## API Endpoints

### Primary Reset

| Method | Route | Auth | Description |
|--------|-------|------|-------------|
| `POST` | `/api/eod/reset` | `requirePermission(MGR_CLOSE_DAY)` + `withVenue` | Run full EOD reset. Body: `{ locationId, employeeId, dryRun?: boolean }` |
| `GET` | `/api/eod/reset` | `requirePermission(MGR_CLOSE_DAY)` + `withVenue` | Pre-flight check — returns counts of what would be reset without making changes. Query: `?locationId=&employeeId=` |

### Automated Nightly Batch Close

| Method | Route | Auth | Description |
|--------|-------|------|-------------|
| `GET` | `/api/cron/eod-batch-close` | `Bearer ${CRON_SECRET}` | Automated cron — checks all locations against their configured `eod.batchCloseTime` (default 04:00). If within 15-min window and hasn't run today: Datacap batch close, table reset, entertainment cleanup, walkout detection, socket notification. Idempotency via AuditLog `eod_auto_batch_close`. |

### Supplementary Cleanup

| Method | Route | Auth | Description |
|--------|-------|------|-------------|
| `POST` | `/api/orders/eod-cleanup` | `withVenue` (no additional permission check) | Cancel empty stale orders; roll forward orders with a balance. Query: `?locationId=` |

---

## What It Does

### `POST /api/eod/reset` — Full Reset

The route runs all mutations inside a single `db.$transaction`. Outside the transaction, two fire-and-forget operations emit order events and broadcast the socket completion event.

**Step 1 — Reset orphaned table statuses.**
Finds all tables in the location where `status != 'available'` AND no open order is currently associated. Resets those tables to `status: 'available'`. Tables that have a live open order are explicitly excluded and left untouched.

**Step 2 — Log stale orders to the audit trail.**
Finds all `OrderSnapshot` records with `status: 'open'` whose `businessDayDate` is before the current business day start (or whose `createdAt` is before it if `businessDayDate` is null). These are considered stale cross-day orders. For each stale order, an `AuditLog` entry is created with `action: 'eod_stale_order_detected'`. Stale orders are then marked with `rolledOverAt` and `rolledOverFrom` on the `Order` model. They are **not** closed — manual manager review is required.

**Step 3 — Create master EOD audit entry.**
A single `AuditLog` entry is created for the reset itself with `action: 'eod_reset_completed'`, recording `tablesReset` and `staleOrdersDetected` in the `details` JSON.

**Step 4 — Emit `ORDER_METADATA_UPDATED` events (fire-and-forget).**
For each rolled-over order, `emitOrderEvent()` is called with event type `ORDER_METADATA_UPDATED` and `rolledOverAt` / `rolledOverFrom` in the payload. This updates the event-sourced projection so Android terminals see the rollover.

**Step 5 — Dispatch `orders:list-changed` (fire-and-forget).**
If any stale orders were found, `dispatchOpenOrdersChanged()` is called with `trigger: 'updated'` so all terminals refresh their open-order lists.

**Step 6 — Broadcast `eod:reset-complete` socket event (fire-and-forget).**
`emitToLocation()` broadcasts `eod:reset-complete` to all connected terminals for the location. Payload: `{ cancelledDrafts, rolledOverOrders, tablesReset, businessDay }`. `cancelledDrafts` is always `0` in this route (draft cancellation is handled by the supplementary cleanup route).

**Dry run mode:** If `dryRun: true` is passed, the route returns what would be reset (orphaned table count, stale order list) without executing any mutations. No transaction is opened.

---

### `POST /api/orders/eod-cleanup` — Supplementary Cleanup

Finds stale `OrderSnapshot` records with status `draft` or `open` from a previous business day.

- **Orders with `totalCents == 0` or `itemCount == 0`:** Cancelled (`status: 'cancelled'`, `deletedAt: now()`). Their associated table (if any) is reset to `available`. An `ORDER_CLOSED` event is emitted for each (fire-and-forget).
- **Orders with a balance (`totalCents > 0` and `itemCount > 0`):** Left open and counted as `rolledForward`. No mutation is applied.

After cancellations, if any orders were cancelled, `orders:list-changed` is emitted via `emitToLocation()` with `source: 'eod-cleanup'`.

---

## Socket Events

| Event | Direction | Emitter | Consumer | Payload |
|-------|-----------|---------|----------|---------|
| `eod:reset-complete` | Server → All terminals | `POST /api/eod/reset` via `emitToLocation()` | `FloorPlanHome.tsx` | `{ cancelledDrafts, rolledOverOrders, tablesReset, businessDay }` |
| `eod:auto-batch-complete` | Server → All terminals | `/api/cron/eod-batch-close` via `emitToLocation()` | All connected terminals | `{ tablesReset, entertainmentReset, batchCloseTime, businessDay }` |
| `orders:list-changed` | Server → All terminals | Both EOD routes (fire-and-forget) | Floor plan, order list views | `{ trigger: 'updated' }` or `{ source: 'eod-cleanup', cancelledCount }` |

---

## Permission Required

| Action | Permission Key | Level |
|--------|---------------|-------|
| Run EOD reset (POST) | `manager.close_day` (`MGR_CLOSE_DAY`) | Manager |
| Check EOD status (GET) | `manager.close_day` (`MGR_CLOSE_DAY`) | Manager |
| EOD cleanup (POST) | None beyond `withVenue` | Any authenticated venue session |

---

## Data Model Notes

- Both routes query **`OrderSnapshot`** (event-sourced projection), not `db.order`, to determine stale orders. This is consistent with the event-sourced model.
- Table resets write directly to `db.table` (non-event-sourced — tables are not part of the order event bridge).
- Audit entries go to `db.auditLog` (local NUC Postgres).
- The `rolledOverAt` / `rolledOverFrom` fields on `Order` are written by `db.order.updateMany()` outside the projection. This is intentional — rollover metadata is operational state, not an order mutation that needs to be projected.

---

## Cross-Feature Dependencies

> See `_CROSS-REF-MATRIX.md` for full matrix.

### This feature MODIFIES these features:

| Feature | How / Why |
|---------|-----------|
| Floor Plan | Resets table statuses; the `eod:reset-complete` event triggers a UI overlay in FloorPlanHome |
| Orders | Marks stale orders as rolled over; EOD cleanup cancels empty stale orders |
| Audit Trail | Writes `eod_stale_order_detected` and `eod_reset_completed` entries to `AuditLog` |

### These features MODIFY this feature:

| Feature | How / Why |
|---------|-----------|
| Business Day Settings | `businessDay.dayStartTime` (from location settings) controls the business day boundary that determines what counts as stale |
| Orders (event bridge) | `ORDER_METADATA_UPDATED` and `ORDER_CLOSED` events emitted by both routes flow through the order event bridge |

### BEFORE CHANGING THIS FEATURE, VERIFY:

- [ ] **Stale order definition** — both routes use `getCurrentBusinessDay(dayStartTime)` to determine the boundary. If business day logic changes, both routes must be updated together.
- [ ] **Dry run** — the `dryRun` flag only exists on `POST /api/eod/reset`, not `POST /api/orders/eod-cleanup`. Adding or removing dry-run support must not silently change production behavior.
- [ ] **No auto-close for orders with a balance** — this is intentional. Do not add logic that closes paid or open orders with a balance during EOD without adding a hard manager confirmation step. Loss of revenue data is a critical failure mode.
- [ ] **Event emission** — `ORDER_METADATA_UPDATED` events in `eod/reset` and `ORDER_CLOSED` events in `eod-cleanup` must remain fire-and-forget (`void ... .catch(console.error)`). These must not block the HTTP response.
- [ ] **Transaction scope** — the full reset transaction (steps 1–3) must remain atomic. Moving any step outside the transaction risks partial resets.

---

## Known Constraints & Limits

- ~~No admin UI trigger exists.~~ **RESOLVED (2026-03-10):** "Close Day" button on the admin dashboard calls `POST /api/eod/reset` with dry-run preview first, then confirmation dialog. Permission-gated to `manager.close_day`.
- The EOD cleanup route (`POST /api/orders/eod-cleanup`) has no permission check beyond `withVenue`. Any authenticated session for the venue can call it. This may need to be gated to manager-level in a future hardening pass.
- `cancelledDrafts` in the `eod:reset-complete` payload is always `0` from the primary reset route, because draft cancellation is handled by the supplementary cleanup route. This means the overlay will always show `0 draft orders cancelled` unless the cleanup route separately triggers the overlay (which it currently does not — it emits `orders:list-changed`, not `eod:reset-complete`).
- Stale orders with a balance are rolled over but **not** automatically closed. The warning in the API response (`"X stale order(s) detected. Please review manually."`) is the only notification. There is no push alert to a manager.
- Both routes read from `OrderSnapshot` for the stale-order query, but the `rolledOverAt` write goes to `db.order` directly (not through the event bridge). The rollover is visible in the event stream only via the `ORDER_METADATA_UPDATED` event.

---

## Android-Specific Notes

Android does not call the EOD endpoints. It receives the effects via the order event bridge: `ORDER_METADATA_UPDATED` events (for rolled-over orders) and `ORDER_CLOSED` events (for cancelled orders) flow to Android through the standard event sync path. Android will reflect updated order states after the next delta sync following an EOD reset.

---

## Related Docs

- **Feature doc:** `docs/features/audit-trail.md`
- **Feature doc:** `docs/features/floor-plan.md`
- **Feature doc:** `docs/features/orders.md`
- **Guide:** `docs/guides/ORDER-LIFECYCLE.md`
- **Guide:** `docs/guides/SOCKET-REALTIME.md`

---

## Automated Nightly Batch Close

The automated cron (`/api/cron/eod-batch-close`) runs every 5 minutes via Vercel cron. For each location:

1. Reads `eod.batchCloseTime` (default "04:00") from location settings
2. Checks if current time is within the 15-minute window after configured batch time
3. Idempotency: checks for `eod_auto_batch_close` AuditLog within current business day — skips if found
4. If in window and not yet run: triggers Datacap batch close for all active readers, resets orphaned tables, cleans up stale entertainment, expires waitlist, runs walkout detection
5. Writes `/opt/gwi-pos/last-batch.json` for heartbeat reporting to MC
6. Emits `eod:auto-batch-complete` socket event to all terminals

**MC Configuration:** `BatchCloseCard` on the MC venue config page allows adjusting batch close time and enabling/disabling auto batch close. Settings sync to POS via existing fleet push.

**POS Visual:** Read-only "Nightly Batch Close" card on `/settings/payments` shows configured time and warns: "All tips must be entered before the batch close time."

*Last updated: 2026-03-10*
