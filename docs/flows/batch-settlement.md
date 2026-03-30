# Batch Settlement Flow

## Overview

Batch settlement is the process of finalizing all card transactions from a business day so funds are transferred from cardholders to the merchant. Datacap readers accumulate approved transactions in a "batch" throughout the day. Settlement sends the batch to the processor for funding.

---

## Trigger Modes

### Auto-Close (EOD Cron)

The primary path. A Vercel cron job runs every 5 minutes and checks each venue's configured `batchCloseTime` (default `04:00` local time).

- **Route:** `GET /api/cron/eod-batch-close`
- **Auth:** `verifyCronSecret()` via `Authorization` header
- **Window:** 15-minute normal window after `batchCloseTime`, plus a 4-hour catch-up window if the normal window was missed (Vercel cold start, outage, etc.)
- **Idempotency:** `AuditLog` lookup for `eod_auto_batch_close` action on the current business day. If already ran, returns `alreadyRanToday: true` and short-circuits.
- **Batch sizing:** Up to `MAX_VENUES_PER_RUN` (default 50) venues per invocation. Catch-up logic handles remaining venues on subsequent cron ticks.
- **Timezone handling:** `batchCloseTime` is stored as local time (e.g., "04:00"). The cron converts UTC `now` to the venue's timezone before comparing.

### Manual Close (Admin)

A manager triggers batch close from the admin UI.

- **Route:** `POST /api/datacap/batch` (with `locationId` and `readerId`)
- **Auth:** `ADMIN` role required via `withAuth('ADMIN', ...)`
- **Scope:** Single reader at a single location per request

Both paths ultimately call Datacap `BatchClose` on each active reader.

---

## Pre-Batch Checks

The EOD cron performs safety checks before settlement in this order:

### 1. Active Payment Detection

```
countActivelyClosingOrders()    — tabs with tabStatus 'closing' or 'pending_auth'
countOrdersWithPendingPayments() — Payment records with status 'pending' or 'processing'
```

If blocking orders exist, the cron polls every 500ms for up to 5 seconds. If still blocked after the wait, it proceeds with a warning (the per-tab `FOR UPDATE` in `executeEodReset` handles row-level locking).

### 2. Pre-flight Tab Lock Check

```
preflightTabLockCheck() — FOR UPDATE SKIP LOCKED probe
```

Diagnostic only. Counts how many open bar tabs are lockable vs held by concurrent transactions. Results are logged but do not block settlement.

### 3. SAF Pending Upload Check

```
getSafPendingPayments() — Payments with safStatus 'APPROVED_SAF_PENDING_UPLOAD'
```

Returns count, total dollar amount, and distinct reader IDs. If SAF payments exist, the cron attempts to forward them before batch close (see below).

---

## SAF Forward Before Settlement

**Critical:** Transactions approved offline via Store-and-Forward (SAF) are stored on the reader's local memory. They are NOT included in the processor's batch until uploaded. Settling without forwarding means those transactions never fund.

The EOD cron calls `attemptSafForward()` for each reader with pending SAF:

```
1. requireDatacapClient(locationId)
2. client.safForwardAll(readerId)     -- TCP to reader, reader uploads to processor
3. Update Payment records:
   - Success: safStatus -> 'UPLOAD_SUCCESS', safUploadedAt = NOW()
   - Failure: safStatus -> 'UPLOAD_FAILED', safError populated
```

If SAF forward fails for some readers, batch close proceeds anyway with warnings. The `saf-retry` cron (every 5 minutes) will continue attempting upload.

**Visa/MC 24-hour rule:** Card networks require SAF transactions to be uploaded within 24 hours of the original authorization. Transactions forwarded after this window may be rejected by the processor.

---

## EOD Reset Sequence

`executeEodReset()` in `src/lib/eod.ts` is the shared engine called by both manual and cron triggers. Steps in order:

### Step 3: Tab Auto-Capture

For each open bar tab with an authorized `OrderCard`:

1. Calculate purchase amount (applies dual pricing card surcharge if enabled)
2. Zero-amount tabs: release pre-auth via `VoidSaleByRecordNo`, mark order voided
3. Calculate auto-gratuity (configurable %, default 20%)
4. Call `client.preAuthCapture(readerId, { recordNo, purchaseAmount, gratuityAmount })`
5. On approval: create `Payment` record atomically with `FOR UPDATE` row lock
6. Update `OrderCard.status = 'captured'`, `Order.status = 'paid'`, `Order.tabStatus = 'closed'`
7. Fire-and-forget: `TAB_CLOSED`, `PAYMENT_APPLIED`, `ORDER_CLOSED` events
8. Fire-and-forget: tip allocation, inventory deduction, socket dispatches
9. On decline: mark `Order.tabStatus = 'declined_capture'`, increment retry count

### Step 4: Roll Over Stale Orders

Orders open for more than one business day are tagged with `rolledOverAt` and an audit log entry.

### Step 5: Reset Orphaned Tables

Tables marked `occupied` with no open orders are reset to `available`.

### Step 6: Entertainment Cleanup

Active timed rental sessions are stopped, charges finalized, waitlist entries cancelled.

### Step 7: Datacap Batch Close

If `autoBatchClose` is enabled and processor is `datacap`:

```
1. Find all active PaymentReader records for the location
2. For each reader:
   a. client.batchClose(readerId)
   b. On success: AuditLog 'eod_batch_close_success' + write /opt/gwi-pos/last-batch.json
   c. On failure: AuditLog 'eod_batch_close_failed' + warning
3. batchCloseSuccess = true only if ALL readers succeeded
```

The `last-batch.json` file is read by the NUC heartbeat and reported to Mission Control.

### Steps 8-11: Post-Settlement

- Walkout detection
- Orphaned offline payment warning
- Audit log with full stats (tabs captured, amounts, declined, batch status)
- Socket event `eod:reset-complete` to all terminals

---

## Datacap BatchClose Call

### GET /api/datacap/batch (Summary)

Returns current batch state for a reader:

| Field | Description |
|-------|-------------|
| `batchNo` | Current open batch number |
| `transactionCount` | Items in the unsettled batch |
| `safCount` | Pending SAF transactions on reader |
| `safAmount` | Dollar total of pending SAF |
| `hasSAFPending` | Boolean warning flag |

### POST /api/datacap/batch (Close)

Sends `BatchClose` command to the reader via TCP. The reader transmits all accumulated transactions to Datacap's processor for settlement.

Response: `{ success, batchNo, error }`

---

## Payment.settledAt Update

The `Payment.settledAt` field is set when the payment is captured (tab close or direct sale), not at batch close time. The batch close operation does not update individual `Payment` records -- it is a reader-level command that tells the processor "settle everything in this batch."

The actual fund transfer timeline:
1. **Capture** (tab close): `Payment.status = 'completed'`, amount finalized
2. **Batch close** (EOD): Reader transmits batch to processor
3. **Funding** (1-2 business days): Processor deposits funds to merchant account

---

## MC Heartbeat Reporting

After batch close, the NUC writes `/opt/gwi-pos/last-batch.json`:

```json
{
  "closedAt": "2026-03-29T04:00:12.345Z",
  "status": "closed",
  "itemCount": 47,
  "batchNo": "001234"
}
```

The NUC heartbeat (every 60s) reads this file and includes batch status in its report to Mission Control. MC uses this data for fleet-wide settlement monitoring.

---

## Error Recovery

### Batch Close Fails

| Scenario | Recovery |
|----------|----------|
| Reader offline / unreachable | Warning logged. Retry manually via admin UI once reader is back online. |
| Reader returns error | `AuditLog` entry with error detail. Manual re-attempt via `POST /api/datacap/batch`. |
| Partial failure (multi-reader) | Some readers settle, others fail. `batchCloseSuccess = false`. Failed readers must be retried individually. |
| Cron missed the window | 4-hour catch-up window. If completely missed, manual trigger required next day. |
| SAF not forwarded before close | Transactions not in batch. `saf-retry` cron continues uploading. SAF transactions settle in the NEXT batch. |

### Tab Capture Fails at EOD

Tabs that fail auto-capture are marked `tabStatus = 'declined_capture'` with `captureRetryCount` incremented. They roll to the next business day and can be:
- Re-attempted manually by a manager
- Converted to a walkout if the card is permanently declined
- Written off by a manager with `TAB_WRITEOFF` permission

---

## Key Files

| File | Purpose |
|------|---------|
| `src/app/api/cron/eod-batch-close/route.ts` | Cron entry point, venue loop, SAF forward, pre-flight checks |
| `src/lib/eod.ts` | `executeEodReset()` — shared engine for manual and cron |
| `src/app/api/datacap/batch/route.ts` | Manual batch summary (GET) and close (POST) |
| `src/app/api/cron/saf-retry/route.ts` | Automatic SAF upload retry (every 5 min) |
| `src/lib/datacap/client.ts` | `batchClose()`, `safForwardAll()`, `safStatistics()` |

---

*Last updated: 2026-03-29*
