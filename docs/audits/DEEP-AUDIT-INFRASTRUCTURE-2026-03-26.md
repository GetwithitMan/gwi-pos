# Deep Infrastructure Audit — 2026-03-26

**Scope:** Second-pass audit of all 7 data flow directions at the INFRASTRUCTURE level
**Method:** 7 parallel agents reading sync workers, socket infrastructure, and route handlers line-by-line
**Finding:** 14 CRITICAL issues, 12 HIGH issues, 25+ MEDIUM issues across sync engine, socket delivery, race conditions, KDS routing, and client state

---

## CRITICAL ISSUES (P0) — Must Fix Before Production

### SYNC ENGINE

| ID | Issue | File | Impact |
|---|---|---|---|
| **S1** | syncedAt race: row modified between read and stamp becomes permanently unsyncable | upstream-sync-worker.ts:278-348 | Orders/payments silently stop syncing forever |
| **S2** | Timestamp cast bug: outage replay uses `::timestamptz` for ALL timestamps | outage-replay-worker.ts:94-107 | Every outage replay corrupts timestamps by timezone offset |
| **S3** | FK violations not caught: infinite retry loop on parent-before-child | upstream-sync-worker.ts:353-386 | CPU/network waste, rows stuck forever |
| **S4** | CONFLICT outage entries never retried | outage-replay-worker.ts:424-430 | Data loss from orphaned queue entries |
| **S5** | HWM advances on failed downstream upserts | downstream-sync-worker.ts:540-595 | Rows permanently skipped, menu items missing |
| **S6** | Invalid SQL in outage version guard (WHERE after ON CONFLICT DO UPDATE) | outage-replay-worker.ts:200-204 | Outage replays silently fail |

### SOCKET DELIVERY

| ID | Issue | File | Impact |
|---|---|---|---|
| **K1** | QoS 1 events lost after 30s timeout — no fallback | socket-ack-queue.ts:128-158 | Payment confirmations silently dropped |

### RACE CONDITIONS

| ID | Issue | File | Impact |
|---|---|---|---|
| **R1** | Double-payment: network retry with new idempotencyKey charges card twice | orders/[id]/pay/route.ts:440-534 | Customer charged double |

### KDS ↔ POS

| ID | Issue | File | Impact |
|---|---|---|---|
| **K2** | Items can route to ZERO stations — silently dropped | order-router.ts:475-478 | Kitchen never receives items, customer charged |
| **K3** | Intermediate bumps skip ALL socket events | kds/route.ts:570-585 | POS never learns items are done |
| **K4** | Screen link check races with item update | kds/route.ts:493-507 | Premature "order ready" notifications |

### CLIENT STATE

| ID | Issue | File | Impact |
|---|---|---|---|
| **C1** | API response overwrites socket `order:closed` (order resurrected) | useActiveOrder.ts:192-330 | Closed order re-appears as open |
| **C2** | 8+ socket events defined with NO client listener | socket-events.ts vs hooks/ | Voids, holds, modifier changes invisible |
| **C3** | clearOrder PATCH races with startOrder POST | useActiveOrder.ts:212-240 | New order mysteriously deleted |

---

## HIGH ISSUES (P1) — Fix This Sprint

### SYNC ENGINE

| ID | Issue | File | Impact |
|---|---|---|---|
| **S7** | FK dependency ordering lost in parallel batches of 5 | upstream-sync-worker.ts:436-470 | FK violations during batch sync |
| **S8** | 17+ models missing from sync-config entirely | sync-config.ts | AuditLog, OrderEvent, DailyPrepCount, etc. never sync |
| **S9** | FIFO ordering broken if Neon crashes mid-batch | outage-replay-worker.ts:253-264 | Out-of-order replay |
| **S10** | Initial sync gate premature — allows orders before MenuItems synced | downstream-sync-worker.ts:1115-1138 | Orders fail with FK constraint errors |

### SOCKET DELIVERY

| ID | Issue | File | Impact |
|---|---|---|---|
| **K5** | Slow terminal blocks broadcast to all others | socket-server.ts:1241 | KDS delayed 100-500ms |
| **K6** | Disconnect corrupts multi-terminal ack tracking | socket-ack-queue.ts:107-119 | Payment state inconsistency |
| **K7** | No full-sync fallback when catch-up returns empty | socket-event-buffer.ts:164-171 | Post-restart shows stale orders |

### RACE CONDITIONS

| ID | Issue | File | Impact |
|---|---|---|---|
| **R2** | Items added during send not included in KDS batch | orders/[id]/items/route.ts + send/route.ts | Kitchen orders incomplete |
| **R3** | Payment captured on stale order total | orders/[id]/pay/route.ts:298-548 | Underpayment ($50 captured on $70 order) |

### KDS ↔ POS

| ID | Issue | File | Impact |
|---|---|---|---|
| **K8** | Forwarded items orphaned on deleted screen | kds/screen-links.ts:88 | Items stuck, never reach expo |
| **K9** | No station existence validation before routing | order-router.ts:235-241 | Print jobs hang indefinitely |

### CLIENT STATE

| ID | Issue | File | Impact |
|---|---|---|---|
| **C4** | Floor plan and order store hold contradictory state | order-store.ts + FloorPlanHome.tsx | Zombie orders in open list |
| **C5** | No "latest wins" strategy (API vs socket undefined) | useActiveOrder.ts:192 | KDS bump reverted by stale fetch |
| **C6** | Unsent items only in localStorage — cache clear = total loss | order-store.ts:300-341 | Complete order loss |
| **C7** | Socket handlers fire during component unmount | useOrderSockets.ts:231 | Memory leaks, state corruption |

---

## MEDIUM ISSUES (P2)

### SYNC ENGINE
- **S11** 5.2s worst-case sync delay (100ms debounce + 5s interval)
- **S12** Column cache not invalidated across workers during schema rollout
- **S13** Table.status in skipFields — never updated downstream (status divergence)
- **S14** notifyDataChanged() is no-op on NUC (15s notification lag)
- **S15** Silent socket failures in downstream notification pipeline (errorPolicy: 'skip')

### SOCKET DELIVERY
- **K10** Cellular relay batch loss (buffer cleared before write confirms)
- **K11** L1/L2 buffer divergence (PG write fire-and-forget)
- **K12** Catch-up dedup drops intermediate `orders:list-changed` payloads
- **K13** Outbox rows stuck in 'flushing' status after crash (5min recovery window)

### RACE CONDITIONS
- **R4** Tab close zombie recovery can cause duplicate captures
- **R5** Split item movement race between validation and creation
- **R6** KDS void + bump race — item prepared after voided
- **R7** Order claim expiry not atomically cleared (concurrent edits)

### KDS ↔ POS
- **K14** All-day counts inflated by resends (same item counted N times)
- **K15** Resend counter unlimited — printer backlog explosion
- **K16** Delayed items appear on KDS before fire time
- **K17** Fire-course blocks paid orders (can't fire remaining courses)
- **K18** Delivery advance is fire-and-forget (order stuck in preparing)

### CLIENT STATE
- **C8** `orders:list-changed` handler has no error handling on loadOrder fetch
- **C9** syncServerTotals wipes data on 409 TABLE_OCCUPIED
- **C10** Table status updated locally but never persisted to server
- **C11** No sourceTerminalId filtering (own socket events cause flicker)
- **C12** No SWR/fetch cache invalidation on socket events
- **C13** Stale ref data in floor plan onOrderClosed handler
- **C14** saveItemToDb promise never cleared on unmount

---

## PUSHUPSTREAM CORRECTNESS CHECK

**Verdict: 98% CORRECT**
- All 370 files import from correct path (`@/lib/sync/outage-safe-write`)
- All calls placed AFTER successful DB writes, OUTSIDE transactions
- No calls on error paths
- Every write handler in multi-handler files has its own call
- Minor style inconsistency: ~40% use `void pushUpstream()`, ~60% use `pushUpstream()` (both correct)

---

## RECOMMENDED FIX ORDER

### Week 1 (Data Integrity — Stop Silent Data Loss)
1. **S1** syncedAt race → add FOR UPDATE lock on upstream sync reads
2. **S2** timestamp cast → fix `::timestamptz` to `::timestamp` for non-tz columns
3. **S5** HWM advance → only persist successful row timestamps
4. **S6** SQL syntax → rewrite outage version guard
5. **K2** zero-station routing → add default fallback station
6. **R1** double-payment → idempotency by (orderId, amount, terminalId) tuple

### Week 2 (Socket Reliability — Stop Silent Event Loss)
7. **K1** QoS timeout → add outbox fallback for expired ack events
8. **K3** intermediate bump → ALWAYS emit socket events
9. **K4** screen link race → move check into DB transaction
10. **C1** order resurrection → version check in loadOrder
11. **C2** missing listeners → add handlers for all defined events

### Week 3 (Race Conditions — Prevent Financial Errors)
12. **R2** items during send → extend FOR UPDATE scope
13. **R3** stale total payment → re-read total in Phase 3
14. **S3** FK retry → catch 23502 errors, queue for later
15. **S4** CONFLICT stuck → add retry loop for resolved conflicts

### Week 4 (Client Hardening)
16. **C3-C7** client state fixes → version-based conflict resolution, unmount guards
17. **S8** missing models → add to sync-config
18. **S10** premature gate → require MenuItem count before ORDERS state
