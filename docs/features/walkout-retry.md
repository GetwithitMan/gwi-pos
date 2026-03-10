# Feature: Walkout Retry

> **Before editing this feature:** Read `_CROSS-REF-MATRIX.md` → find Walkout Retry → read every listed dependency doc.

## Summary
A walkout occurs when a bartender closes a tab and the Datacap pre-auth capture is declined — the guest has left and the card cannot be charged at that moment. The WalkoutRetry system automatically schedules periodic retry attempts against the stored `OrderCard.recordNo` token until the charge either succeeds or the maximum retry window expires. A staff member can also trigger a manual retry from the POS at any time.

## Status
`Active`

## Repos Involved
| Repo | Role | Coverage |
|------|------|----------|
| `gwi-pos` | API, schema, settings, retry logic | Full |
| `gwi-android-register` | None — walkout management is POS-only | None |
| `gwi-cfd` | None | None |

---

## UI Entry Points

| Interface | Path / Screen | Who Accesses |
|-----------|--------------|--------------|
| POS Web API (no dedicated UI page) | — | Managers via API or future admin page |
| Admin settings | `/settings/automation` → `settings.automation` permission | Managers |

No dedicated admin page for walkout review exists. The `GET /api/datacap/walkout-retry` endpoint can list retries by status, but there is no built-in UI that surfaces this list to managers.

---

## Code Locations

### gwi-pos
| File / Directory | Purpose |
|-----------------|---------|
| `src/app/api/orders/[id]/mark-walkout/route.ts` | POST — marks an order as walkout, creates `WalkoutRetry` records for each authorized card |
| `src/app/api/datacap/walkout-retry/route.ts` | POST — executes a single retry attempt; GET — lists retries for a location by status |
| `src/app/api/orders/[id]/close-tab/route.ts` | Contains auto-walkout flag logic: if `autoFlagWalkoutAfterDeclines` is enabled and `captureRetryCount >= maxCaptureRetries`, sets `isWalkout = true` |
| `src/lib/settings.ts` | Defines `walkoutRetryEnabled`, `walkoutRetryFrequencyDays`, `walkoutMaxRetryDays`, `walkoutAutoDetectMinutes`, `maxCaptureRetries`, `autoFlagWalkoutAfterDeclines` |
| `src/lib/order-events/projector.ts` | Bridges `isWalkout`, `walkoutAt`, `walkoutMarkedBy` into `OrderSnapshot` during event projection |
| `prisma/schema.prisma` | `WalkoutRetry` model; `WalkoutRetryStatus` enum; `isWalkout`/`walkoutAt`/`walkoutMarkedBy` on `Order` |

---

## API Endpoints

| Method | Route | Auth | Description |
|--------|-------|------|-------------|
| `POST` | `/api/orders/[id]/mark-walkout` | Employee PIN | Marks order as walkout; creates `WalkoutRetry` records; emits `ORDER_METADATA_UPDATED` event |
| `POST` | `/api/datacap/walkout-retry` | `pos.card_payments` | Executes one retry attempt against Datacap; updates status; emits `PAYMENT_APPLIED` + `ORDER_CLOSED` on success |
| `GET` | `/api/datacap/walkout-retry` | None (location-scoped) | Lists `WalkoutRetry` records for a location, filterable by `status` |

---

## Data Model

### WalkoutRetry
```
WalkoutRetry {
  id            String               // cuid
  locationId    String               // Multi-tenant scope
  orderId       String               // Parent order
  orderCardId   String               // Which OrderCard to retry against (holds Datacap recordNo token)

  amount        Decimal              // Full tab amount to capture

  // Retry schedule
  nextRetryAt   DateTime             // Next scheduled attempt
  retryCount    Int      (default 0) // Total attempts made
  maxRetries    Int      (default 10)// Calculated from settings: floor(walkoutMaxRetryDays / walkoutRetryFrequencyDays)

  // Status
  status        WalkoutRetryStatus   // pending | collected | exhausted | written_off

  // Result tracking
  lastRetryAt   DateTime?            // Timestamp of most recent attempt
  lastRetryError String?             // Error text from last failed attempt
  collectedAt   DateTime?            // Set when status → collected
  writtenOffAt  DateTime?            // Set when status → written_off
  writtenOffBy  String?              // Employee who performed write-off

  createdAt     DateTime
  updatedAt     DateTime
  deletedAt     DateTime?
  syncedAt      DateTime?
}

enum WalkoutRetryStatus {
  pending      // Awaiting next retry attempt
  collected    // Capture succeeded; order is closed and paid
  exhausted    // Max retry window elapsed; charge failed on all attempts
  written_off  // Manually written off by manager
}
```

### Relevant Order fields
```
Order {
  isWalkout       Boolean   // true once mark-walkout is called or auto-flagged
  walkoutAt       DateTime? // When the walkout was recorded
  walkoutMarkedBy String?   // Employee who called mark-walkout
}
```

### Settings (payments section)
| Setting | Default | Description |
|---------|---------|-------------|
| `walkoutRetryEnabled` | `true` | If false, mark-walkout skips creating WalkoutRetry records |
| `walkoutRetryFrequencyDays` | `3` | Days between each retry attempt |
| `walkoutMaxRetryDays` | `30` | Total window; retries stop after this many days from creation |
| `walkoutAutoDetectMinutes` | `120` | Auto-detect idle tab as walkout after N minutes (trigger not yet wired to a scheduler) |
| `maxCaptureRetries` | `3` | Capture failures in close-tab before auto-flagging `isWalkout` |
| `autoFlagWalkoutAfterDeclines` | `true` | Auto-set `isWalkout` when `maxCaptureRetries` is reached during tab close |

---

## Business Logic

### 1. Walkout Created — Two Paths

**Path A: Manual mark-walkout**
1. Bartender or manager calls `POST /api/orders/[id]/mark-walkout` with `employeeId`
2. System requires the order to have at least one `authorized` `OrderCard`
3. `Order.isWalkout = true`, `walkoutAt` and `walkoutMarkedBy` are set
4. If `walkoutRetryEnabled = true`: for each authorized card, a `WalkoutRetry` record is created with:
   - `status = 'pending'`
   - `nextRetryAt = now + walkoutRetryFrequencyDays`
   - `maxRetries = floor(walkoutMaxRetryDays / walkoutRetryFrequencyDays)`
5. `ORDER_METADATA_UPDATED` event emitted (fire-and-forget)
6. `orders:list-changed` socket dispatch emitted to all terminals

**Path B: Auto-flag on repeated capture declines (close-tab route)**
1. Each failed capture in `close-tab` increments `Order.captureRetryCount`
2. When `captureRetryCount >= maxCaptureRetries` and `autoFlagWalkoutAfterDeclines = true`, the order is auto-flagged with `isWalkout = true`
3. No `WalkoutRetry` records are created on the auto-flag path — only the manual `mark-walkout` endpoint creates them

### 2. Retry Execution

**Manual trigger:**
1. Caller sends `POST /api/datacap/walkout-retry` with `{ walkoutRetryId, employeeId }`
2. Requires `WalkoutRetry.status = 'pending'`
3. Requires `pos.card_payments` permission on `employeeId`

**Scheduled trigger:**
- The route comment states: "Also used by cron/scheduler for auto-retry"
- No internal scheduler or cron job is currently wired in the codebase; the auto-retry call is external or not yet implemented (see Known Constraints)

**Retry execution flow:**
1. Looks up `WalkoutRetry` (must be `pending`, not soft-deleted)
2. Looks up linked `OrderCard` for `readerId` and `recordNo`
3. Validates reader is online via `validateReader()`
4. Calls `client.preAuthCapture()` against Datacap using `OrderCard.recordNo`

**On approval:**
- Atomic guard: `updateMany` with `status = 'pending'` filter prevents double-charge (BUG #459 fix)
- If `updatedCount === 0`: duplicate request; returns `{ duplicate: true, status: 'collected' }`
- If `updatedCount === 1`:
  - `WalkoutRetry.status → 'collected'`, `collectedAt` set
  - `OrderCard.status → 'captured'`, `capturedAmount` and `capturedAt` set
  - `Order.status → 'paid'`, `tabStatus → 'closed'`, `paidAt` and `closedAt` set
  - `Payment` record created for reconciliation
  - `PAYMENT_APPLIED` + `ORDER_CLOSED` events emitted (fire-and-forget)

**On decline:**
- `nextRetryAt = now + walkoutRetryFrequencyDays`
- `exhausted` flag: if `nextRetry > createdAt + walkoutMaxRetryDays`
- If exhausted: `status → 'exhausted'`, `nextRetryAt` remains unchanged
- If not exhausted: `status` stays `'pending'`, `nextRetryAt` advances

### 3. Status Progression

```
pending → collected   (Datacap approved)
pending → exhausted   (max retry window exceeded on a declined attempt)
pending → written_off (manual write-off — see Known Constraints)
exhausted → written_off (manual write-off — see Known Constraints)
```

### 4. Write-Off Path

The `WalkoutRetryStatus.written_off` value exists in the schema and `writtenOffAt` / `writtenOffBy` fields exist on the model. However, **no API endpoint exists to transition a record to `written_off`**. Records in `exhausted` status cannot be formally closed without a direct database update.

---

## Cross-Feature Dependencies

> See `_CROSS-REF-MATRIX.md` for full matrix.

### This feature MODIFIES these features:
| Feature | How / Why |
|---------|-----------|
| Tabs | Marks tab order as walkout; on collection, sets order to `paid`/`closed` |
| Payments | Creates a `Payment` record on successful retry |
| Reports | Successful retry closes the order and creates a payment, affecting revenue totals |

### These features MODIFY this feature:
| Feature | How / Why |
|---------|-----------|
| Tabs | Tab close failure triggers the walkout state |
| Settings | `walkoutRetryEnabled`, frequency, and max-day settings control all retry behavior |

### BEFORE CHANGING THIS FEATURE, VERIFY:
- [ ] **Payments** — does change affect `Payment` record creation or `OrderCard` capture status?
- [ ] **Orders** — does change affect `Order.status` / `tabStatus` transitions?
- [ ] **Event sourcing** — `PAYMENT_APPLIED` and `ORDER_CLOSED` must still be emitted on success
- [ ] **Double-charge guard** — the `updateMany` atomic pattern on retry success must be preserved

---

## Permissions Required

| Action | Permission Key | Notes |
|--------|---------------|-------|
| Mark order as walkout | Employee PIN only | `POST /api/orders/[id]/mark-walkout` uses `withVenue` but no explicit `requirePermission` call; any authenticated employee can call it |
| Execute retry | `pos.card_payments` | `POST /api/datacap/walkout-retry` enforces this |
| List retries | None (location-scoped) | `GET /api/datacap/walkout-retry` uses `withVenue` only |
| Adjust retry settings | `settings.automation` | Via `/settings/automation` settings page |

---

## Known Constraints

- **No automatic scheduler** — `POST /api/datacap/walkout-retry` must be called externally or manually. The comment "also used by cron/scheduler" indicates intent, but no internal cron job, background worker, or scheduled task exists in the codebase to call this endpoint on schedule. Retries only occur when triggered manually.
- **No write-off API endpoint** — `WalkoutRetryStatus.written_off` exists in the schema with `writtenOffAt` / `writtenOffBy` fields, but there is no `POST` endpoint to transition a record to this state. Exhausted retries cannot be formally closed through the application.
- **Money in limbo when exhausted** — a `WalkoutRetry` in `exhausted` status represents a debt that Datacap has permanently failed to collect. With no write-off path, this record stays in the database with no resolution workflow. The order also remains in `isWalkout = true` / open state until manually corrected.
- **Auto-flag (Path B) does not create retry records** — the auto-flag in `close-tab` sets `isWalkout = true` but does not create `WalkoutRetry` rows. Retries only exist if the manual `mark-walkout` endpoint is called afterward.
- ~~**No dedicated admin UI**~~ **RESOLVED (2026-03-10):** Walkout retries report at `/reports/walkout-retries` (status filter, write-off action, auto-refresh). Walkout retry status also shown inline on closed tab/order detail views (order history, closed orders modal, closed tabs page) when `order.isWalkout === true`.
- **Reader must be online** — retries call `validateReader()` before the Datacap attempt; if the card reader is offline, the retry will throw and the retry record will have its `retryCount` incremented with the error stored in `lastRetryError`.
- **`walkoutAutoDetectMinutes` setting is unimplemented** — the setting exists in `settings.ts` with a default of 120 minutes, but no background job monitors idle tabs and auto-creates walkout records based on this threshold.

---

## Related Docs
- **Feature doc:** `docs/features/tabs.md`
- **Payments guide:** `docs/guides/PAYMENTS-RULES.md`
- **Known bugs:** `docs/planning/KNOWN-BUGS.md`

---

*Last updated: 2026-03-10*
