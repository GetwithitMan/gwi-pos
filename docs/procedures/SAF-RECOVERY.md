# SAF Recovery Procedures

Store-and-Forward (SAF) transactions are card payments approved offline by the reader when the Datacap processor is unreachable. The reader stores the authorization locally and the order closes normally. These transactions MUST eventually be uploaded to the processor for settlement, or the venue will not receive funds.

---

## SAF Status Values and Transitions

```
Card tapped/dipped while processor offline
  |
  v
APPROVED_SAF_PENDING_UPLOAD  (initial state -- approved locally, not yet uploaded)
  |
  |-- SAF ForwardAll succeeds --> UPLOAD_SUCCESS  (terminal state)
  |
  |-- SAF ForwardAll fails -----> UPLOAD_FAILED   (retryable)
  |                                   |
  |                                   |-- retry succeeds --> UPLOAD_SUCCESS
  |                                   |
  |                                   |-- retry fails (< 10 attempts) --> UPLOAD_FAILED (retry again)
  |                                   |
  |                                   |-- retry fails (>= 10 attempts) --> NEEDS_ATTENTION (manual)
  |
  (void before forward) ------------> Payment voided, SAF entry removed from reader queue
```

### Status Definitions

| Status | Meaning | Action Required |
|--------|---------|-----------------|
| `APPROVED_SAF_PENDING_UPLOAD` | Approved offline, never forwarded to processor | Auto-retry or manual forward |
| `UPLOAD_SUCCESS` | Successfully forwarded to processor | None -- will settle in next batch |
| `UPLOAD_FAILED` | Forward attempt failed | Auto-retry cron will handle (up to 10 attempts) |
| `NEEDS_ATTENTION` | 10+ retry attempts exhausted | Manual intervention required |

---

## Identifying Failed Uploads

### Admin UI

Navigate to **Settings > Hardware > Payment Readers**. Each reader shows a SAF widget with:
- Amber badge: `"N pending - $X.XX"` when SAF transactions exist
- "Forward Now" button to trigger manual upload
- "Check" button to refresh SAF statistics from the reader

### Database Queries

Count pending SAF payments for a location:
```sql
SELECT COUNT(*), COALESCE(SUM(p."amount"), 0) as total
FROM "Payment" p
INNER JOIN "Order" o ON o.id = p."orderId"
WHERE o."locationId" = '<location-id>'
  AND p."safStatus" IN ('APPROVED_SAF_PENDING_UPLOAD', 'UPLOAD_FAILED')
  AND p."deletedAt" IS NULL
  AND o."deletedAt" IS NULL;
```

Find payments requiring manual attention:
```sql
SELECT p.id, p.amount, p."cardBrand", p."cardLast4",
       p."safStatus", p."safError", p."createdAt"
FROM "Payment" p
INNER JOIN "Order" o ON o.id = p."orderId"
WHERE o."locationId" = '<location-id>'
  AND p."safStatus" = 'NEEDS_ATTENTION'
  AND p."deletedAt" IS NULL
ORDER BY p."createdAt" ASC;
```

---

## Auto-Retry Cron

**Route:** `GET /api/cron/saf-retry`
**Frequency:** Every 5 minutes
**Source:** `src/app/api/cron/saf-retry/route.ts`

### What It Does

1. Acquires a PostgreSQL advisory lock (`pg_try_advisory_lock`) per venue to prevent concurrent runs
2. Finds all readers with `UPLOAD_FAILED` or `APPROVED_SAF_PENDING_UPLOAD` payments older than 5 minutes
3. Uses `FOR UPDATE SKIP LOCKED` to avoid interfering with other payment operations
4. For each reader:
   - Checks retry count from `safError` field (encoded as `{"retryCount":N}|error message`)
   - Payments exceeding 10 retries are promoted to `NEEDS_ATTENTION`
   - Remaining retryable payments: calls `client.safForwardAll(readerId)`
   - On success: `safStatus = 'UPLOAD_SUCCESS'`, `safUploadedAt = NOW()`
   - On failure: `safStatus = 'UPLOAD_FAILED'`, retry count incremented in `safError`
5. Triggers `pushUpstream()` to sync status changes to Neon

### Retry Count Tracking

Retry metadata is stored in the `safError` field as a JSON prefix to avoid schema migration:

```
{"retryCount":3}|SAF forward failed: reader timeout
```

The `parseRetryCount()` function extracts the count. On first failure (no prefix), count starts at 0.

---

## Manual Retry via SAF Forward

**Route:** `POST /api/datacap/saf/forward`
**Auth:** Manager permission required
**Source:** `src/app/api/datacap/saf/forward/route.ts`

### Request
```json
{
  "locationId": "loc_123",
  "readerId": "rdr_456"
}
```

### Behavior

1. Validates the reader belongs to the location
2. Checks for existing `UPLOAD_SUCCESS` payments on the reader (returns 409 if found -- prevents double-submission)
3. Calls `client.safForwardAll(readerId)` -- TCP to the reader, reader uploads stored transactions to the processor
4. Updates all `APPROVED_SAF_PENDING_UPLOAD` payments for this reader:
   - Success: `safStatus = 'UPLOAD_SUCCESS'`, `safUploadedAt = NOW()`
   - Failure: `safStatus = 'UPLOAD_FAILED'`, `safError` populated
5. Calls `pushUpstream()` to sync

**Important:** `SAF_ForwardAll` is a reader-level command. It uploads ALL stored transactions on the reader, not individual payments. There is no way to forward a single SAF transaction.

---

## NEEDS_ATTENTION Status

### When It Occurs

A payment reaches `NEEDS_ATTENTION` after 10 failed auto-retry attempts. Common causes:

- Reader physically removed or replaced
- Reader firmware issue preventing SAF upload
- Reader IP changed and is unreachable
- Processor-side configuration problem
- Network firewall blocking outbound Datacap traffic

### How to Handle

1. **Verify reader connectivity:** Check the reader's status in Settings > Hardware > Payment Readers. If offline, restore network connectivity.

2. **Try manual forward:** Once the reader is online, use the "Forward Now" button. If successful, the cron will pick up the status change.

3. **Check reader SAF queue:** Use "Check" button to verify the reader still has queued transactions. If `safCount: 0`, the transactions may have been forwarded by another path (e.g., reader auto-forwarded on reconnect).

4. **If reader was replaced:** The SAF transactions are stored on the physical reader's memory. If the reader was swapped, those transactions are on the old device. Retrieve the old reader, connect it, and forward.

5. **Contact Datacap support:** If the reader is online but forward consistently fails, the issue may be processor-side. Contact Datacap with the reader serial number and error messages.

---

## Write-Off Procedure

For unrecoverable SAF failures (reader destroyed, transactions too old for processor acceptance):

1. Verify the payments cannot be forwarded by any means
2. Document the affected payments (amount, date, card last 4)
3. Update the payment records:

```sql
UPDATE "Payment"
SET "safStatus" = 'WRITTEN_OFF',
    "safError" = 'Manual write-off: [reason]',
    "updatedAt" = NOW()
WHERE id IN ('<payment-id-1>', '<payment-id-2>');
```

**Note:** There is no `WRITTEN_OFF` enum value in the current schema. The write-off is currently a manual database operation marking the payment as acknowledged-but-unrecoverable. The venue absorbs the financial loss.

4. Create an audit log entry for the write-off with the manager's employee ID
5. Report the write-off amount to the venue owner for accounting

---

## Reconciliation After SAF Forward

After a successful SAF forward, verify:

1. **SAF widget shows clear:** The reader's SAF count should be 0
2. **Payment records updated:** All previously `APPROVED_SAF_PENDING_UPLOAD` payments for that reader should now show `UPLOAD_SUCCESS`
3. **Batch includes SAF transactions:** On the next batch close, the forwarded transactions will be included in settlement
4. **Dollar totals match:** Compare the sum of forwarded payments against the reader's reported `safAmount` before forward

If there is a mismatch (e.g., fewer payments updated than reported by the reader), investigate:
- Were some payments already voided before forward?
- Did the forward partially succeed? (SAF_ForwardAll is all-or-nothing at the reader level)
- Are there payments for this reader on other locations? (Unlikely but possible in misconfigured setups)

---

## Visa/MC 24-Hour Rule

Card networks (Visa, Mastercard) require SAF transactions to be uploaded to the processor within 24 hours of the original authorization. After 24 hours:

- The processor MAY reject the upload
- The transaction MAY still go through but with downgraded interchange rates
- Chargeback protection is weakened

### Enforcement in GWI POS

- The EOD cron attempts SAF forward before every batch close
- The `saf-retry` cron runs every 5 minutes for failed uploads
- The batch summary endpoint (`GET /api/datacap/batch`) returns `hasSAFPending: true` as a warning
- Managers see an amber badge on the hardware settings page

There is no hard block preventing settlement with pending SAF. The warnings exist to help managers comply with the 24-hour rule. Ultimately, the venue bears the risk for SAF transactions.

---

## Key Files

| File | Purpose |
|------|---------|
| `src/app/api/datacap/saf/forward/route.ts` | Manual SAF forward endpoint |
| `src/app/api/datacap/saf/statistics/route.ts` | SAF queue statistics from reader |
| `src/app/api/cron/saf-retry/route.ts` | Automatic SAF retry cron (every 5 min) |
| `src/app/api/cron/eod-batch-close/route.ts` | EOD cron with pre-batch SAF forward |
| `src/lib/datacap/client.ts` | `safForwardAll()`, `safStatistics()` |
| `docs/flows/offline-payment-saf.md` | Full SAF capture flow documentation |

---

*Last updated: 2026-03-29*
