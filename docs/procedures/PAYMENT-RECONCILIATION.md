# Payment Reconciliation

Procedures for detecting and resolving payment discrepancies between Datacap and the local POS ledger.

## Key Files

| File | Purpose |
|------|---------|
| `src/app/api/cron/datacap-reconciliation/route.ts` | Automated orphan detection and auto-void cron (every 5 min) |
| `src/app/api/internal/datacap-reconciliation/route.ts` | Manual orphan review (GET), mark resolved (POST), auto-detect (PUT) |
| `src/app/api/internal/payment-reconciliation/route.ts` | Cross-reference local payments vs Datacap records |
| `src/app/api/cron/eod-batch-close/route.ts` | End-of-day batch settlement |

## Daily Reconciliation Process

### 1. Automated Orphan Detection (Every 5 Minutes)

The cron at `GET /api/cron/datacap-reconciliation` runs across all venues and detects orphaned pending sales:

**What is an orphan?** A record in `_pending_datacap_sales` with `status='pending'` older than 5 minutes. This occurs when the POS server dies between sending a sale to Datacap and recording the result. The card may have been charged, but the POS has no record.

**Auto-void flow:**
1. Query `_pending_datacap_sales WHERE status='pending' AND createdAt < NOW() - 5 min`
2. For each orphan WITH a `datacapRecordNo`:
   - Idempotency check: re-read status to confirm still `pending` (prevents double-void)
   - CAS claim: atomically set status to `voiding` (only one cron run can claim)
   - Find an active `PaymentReader` for the location
   - Call `client.voidSale(readerId, { recordNo })` via Datacap
   - On success: mark as `voided` with `resolvedAt`
   - On failure: mark as `orphaned` for manual review
3. For orphans WITHOUT a `datacapRecordNo` (Datacap never responded): mark as `orphaned`

**Concurrency safety:** The cron uses `CAS` (compare-and-swap) status transitions. If two cron runs overlap, only one can claim each orphan. Failed void attempts are NOT retried — they are marked `orphaned` because the void may have succeeded at Datacap while the DB update failed.

### 2. Manual Orphan Review

`GET /api/internal/datacap-reconciliation` lists orphaned or stale pending sales:

| Parameter | Default | Description |
|-----------|---------|-------------|
| `status` | `all` | Filter: `pending`, `orphaned`, or `all` |
| `minAge` | `120` (seconds) | Minimum age to display |

Auth: `INTERNAL_API_SECRET` via `x-api-key` header, or localhost access.

### 3. Manual Resolution

`POST /api/internal/datacap-reconciliation` marks a specific pending sale as resolved:

```json
{
  "id": "<pending-sale-id>",
  "resolution": "voided | resolved | false_positive",
  "note": "Optional resolution note"
}
```

Resolution types:
- `voided` — Confirmed voided in Datacap portal
- `resolved` — Payment was actually captured and matched to an order
- `false_positive` — Entry was not a real orphan (e.g., delayed network response)

### 4. Auto-Detect (Bulk Orphan Marking)

`PUT /api/internal/datacap-reconciliation` finds all pending sales older than 5 minutes and marks them as `orphaned`. This is a one-shot alternative to the cron for manual triggering. Logs at CRITICAL level.

## Datacap Batch Summary vs Local Ledger

At end of day, the batch close cron (`/api/cron/eod-batch-close`) settles all transactions with Datacap. Discrepancies can appear when:

1. **POS has a payment, Datacap does not** — Transaction may have been voided at the reader level without POS knowledge. Check `_pending_datacap_sales` for an orphan.
2. **Datacap has a transaction, POS does not** — Orphaned sale that was captured but never recorded locally. The orphan cron should have caught this.
3. **Amount mismatch** — Tip adjustment may have failed at Datacap but succeeded locally, or vice versa.

## Discrepancy Detection

### Orphaned Sales Recovery

The `_pending_datacap_sales` table tracks every transaction from intent to completion:

| Status | Meaning |
|--------|---------|
| `pending` | Transaction sent to Datacap, result not yet recorded |
| `voided` | Successfully voided by reconciliation cron |
| `orphaned` | Could not be auto-voided, needs manual review |
| `voiding` | Claimed by cron, void in progress |
| `resolved` | Manually resolved by operator |
| `false_positive` | Not a real orphan |

### SAF Reconciliation After Forward

When Store-and-Forward (SAF) transactions are forwarded after an outage:

1. `SAF_ForwardAll` sends all stored transactions to the processor
2. `SAF_Statistics` returns counts of approved/declined forwards
3. Declined SAF transactions need manual review — the card may have been charged offline but declined when forwarded
4. Check the offline-captured payment intents via `PaymentIntentManager.getOfflineCapturedIntents()`

## Manual Adjustment Procedures

### Payment Exists Locally, Missing at Datacap

1. Verify the payment's `datacapRecordNo` in the Payment record
2. Search Datacap portal by record number or auth code
3. If found: no action needed, batch will include it
4. If not found: the authorization expired or was never sent. Void the local Payment record and re-charge the customer if still present.

### Payment at Datacap, Missing Locally

1. Find the orphan in `GET /api/internal/datacap-reconciliation`
2. Match by amount, terminal, and timestamp to the correct order
3. If order is found: create a Payment record manually and resolve the orphan as `resolved`
4. If no matching order: void the transaction in Datacap portal and resolve as `voided`

### Amount Mismatch (Tip Adjustment Failure)

1. Compare `Payment.totalAmount` (local) vs Datacap settlement amount
2. If Datacap has the higher amount (tip went through at Datacap but not locally): update the local Payment record
3. If local has the higher amount (tip adjustment failed at Datacap): the batch will settle at the Datacap amount. Flag the difference for the manager to review.

## Reporting Integration

- Orphaned sales appear in the system health dashboard (`/api/dashboard/system-overview`)
- Written-off walkouts appear in the audit log under action `walkout_written_off`
- Offline-captured intents are flagged in end-of-day reports via `needsReconciliation: true`
- All reconciliation actions are logged at CRITICAL level for alerting
