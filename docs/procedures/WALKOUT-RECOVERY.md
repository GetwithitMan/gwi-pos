# Walkout Recovery Procedures

How to handle walkout tabs (abandoned tabs with authorized cards) and recover revenue.

## Key Files

| File | Purpose |
|------|---------|
| `src/app/api/orders/[id]/mark-walkout/route.ts` | Mark an order as a walkout, create retry records |
| `src/app/api/datacap/walkout-retry/route.ts` | Manual walkout retry (POST) + list retries (GET) |
| `src/app/api/datacap/walkout-retry/[id]/route.ts` | Write off a specific retry (PUT) |
| `src/app/api/walkout-retries/[id]/write-off/route.ts` | Formal write-off with audit trail |
| `src/app/api/cron/walkout-retry/route.ts` | Automated retry cron (runs every 6 hours) |
| `src/lib/domain/datacap/walkout-retry-service.ts` | Shared retry processing logic |

## What Triggers a Walkout

A walkout occurs when a customer with a pre-authorized tab leaves without closing it. A manager marks the order as a walkout via `POST /api/orders/{id}/mark-walkout`, which:

1. Sets `order.isWalkout = true`, `walkoutAt`, `walkoutMarkedBy`
2. Requires `MGR_VOID_ORDERS` permission
3. Creates a `WalkoutRetry` record for each authorized `OrderCard` on the tab
4. Each retry record stores: `amount`, `nextRetryAt`, `maxRetries`, `status: 'pending'`
5. Emits `ORDER_METADATA_UPDATED` event and triggers upstream sync

## WalkoutRetry Status Values

| Status | Meaning |
|--------|---------|
| `pending` | Waiting for next retry attempt (auto or manual) |
| `retrying` | Currently being processed (transient) |
| `collected` | Capture succeeded, money recovered |
| `exhausted` | Max retries reached without success |
| `written_off` | Manager formally wrote off as bad debt |
| `failed` | Permanent failure (non-retryable error) |

## Auto-Retry Schedule

The cron at `GET /api/cron/walkout-retry` runs every 6 hours and processes pending retries:

1. Queries `WalkoutRetry WHERE status='pending' AND nextRetryAt <= NOW() AND retryCount < maxRetries`
2. Acquires row-level lock (`FOR UPDATE SKIP LOCKED`) to prevent double-processing
3. Calls `processWalkoutRetry(retryId)` for each
4. On success: status -> `collected`, creates Payment record, updates Order to `paid`
5. On failure: increments `retryCount`, sets `nextRetryAt` to `now + walkoutRetryFrequencyDays`, sets `lastRetryError`
6. On exhausted: status -> `exhausted` (no more auto-retries)

### Retry Frequency Configuration

These settings are per-location in `settings.payments`:

| Setting | Description | Used In |
|---------|-------------|---------|
| `walkoutRetryEnabled` | Enable/disable auto-retry | `mark-walkout` |
| `walkoutRetryFrequencyDays` | Days between retry attempts | `walkout-retry`, cron |
| `walkoutMaxRetryDays` | Total window for retries | `mark-walkout` (calculates `maxRetries`) |
| `walkout.maxCaptureRetries` | Hard cap on retry count | `walkout-retry` manual endpoint |

`maxRetries` is calculated as: `floor(walkoutMaxRetryDays / walkoutRetryFrequencyDays)`

## Manual Retry

`POST /api/datacap/walkout-retry` triggers a manual retry:

1. Validates the retry exists and is `pending`
2. Checks `walkout.maxCaptureRetries` limit — auto-marks as `exhausted` if exceeded
3. Calls `client.preAuthCapture(readerId, { recordNo, purchaseAmount })`
4. On approval: atomic `CAS` update (status `pending` -> `collected`) prevents double-charge
5. Creates Payment record, updates OrderCard to `captured`, Order to `paid`
6. Emits `PAYMENT_APPLIED` + `ORDER_CLOSED` events
7. On decline: calculates next retry date, checks if exhausted

### Double-Charge Prevention

The manual retry endpoint uses `CAS` (compare-and-swap) SQL:

```sql
UPDATE "WalkoutRetry"
SET status = 'collected', "collectedAt" = NOW()
WHERE id = $1 AND status = 'pending'
```

If another request already collected it, `updatedRows === 0` and the response returns `{ success: true, duplicate: true }`.

## Pre-Auth Expiration

Card authorization holds typically expire in **30 days** (varies by issuer/network). After expiration:

- Capture attempts will be declined by the issuer
- The cron's decline handling will increment the retry counter
- Eventually the retry will be marked `exhausted`
- This is why timely retries matter — the 30-day window is finite

## Write-Off Process

When a walkout retry is exhausted or failed, a manager can formally write it off:

### Via `POST /api/walkout-retries/{id}/write-off`

1. Requires `MGR_VOID_PAYMENTS` or `MGR_REFUNDS` permission
2. Only allowed on `exhausted` or `failed` status
3. Updates status to `written_off`, sets `writtenOffAt`, `writtenOffBy`
4. Appends a write-off note to the order's `notes` field
5. Creates audit log entry with full details (amount, card info, reason)
6. Triggers upstream sync and socket event

### Via `PUT /api/datacap/walkout-retry/{id}` (Legacy)

1. Send `{ action: 'write-off', reason, locationId, employeeId }`
2. Requires `MGR_VOID_PAYMENTS` permission
3. Creates audit log and updates status atomically

Both endpoints require a `reason` string. The reason is stored in the audit log and appended to the order notes for accounting traceability.

## Manager Dashboard

`GET /api/datacap/walkout-retry` returns walkout retries for a location:

Query parameters:
- `locationId` (required)
- `status` — filter by `pending`, `collected`, `exhausted`, `written_off`
- `orderId` — filter by specific order

Response includes: retry details, card info (type, last4, cardholder name), retry count, next retry date, last error, and timestamps.

## Reporting and Accounting

Walkout retries create a paper trail for accounting:

1. **Collected retries** have a Payment record with `paymentMethod` derived from card type
2. **Written-off retries** have audit log entries under action `walkout_written_off`
3. **Order notes** contain timestamped write-off details for the paper trail
4. The order itself has `isWalkout: true` for filtering in reports
5. All mutations trigger `pushUpstream()` for cloud sync — MC has full visibility
