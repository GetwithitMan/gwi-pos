# Payment Intent Recovery

Procedures for recovering payment intents after crashes, network failures, or exhausted retries.

## Key Files

| File | Purpose |
|------|---------|
| `src/lib/payment-intent-manager.ts` | `PaymentIntentManagerClass` — client-side intent lifecycle |
| `src/lib/offline-db.ts` | Dexie (IndexedDB) schema including `paymentIntents` table |

## What Is a Payment Intent?

A payment intent is a client-side record in IndexedDB that tracks every step of a payment from card swipe to final capture. It is created BEFORE any network request, ensuring that even if the server crashes mid-payment, the terminal "remembers" what happened and can resume.

Intents are the "final boss" of POS reliability. They prevent:
- Double charges after network blips
- Lost payments after Wi-Fi disconnects
- Orphaned authorizations that never get captured

## Intent States

| State | Description | Next States |
|-------|-------------|-------------|
| `intent_created` | Intent logged before any network call | `token_received` |
| `token_received` | Card tokenized by SDK | `authorizing` |
| `authorizing` | Authorization request sent to gateway | `authorized`, `declined` |
| `authorized` | Gateway approved the charge | `capture_pending`, `captured` |
| `capture_pending` | Queued for offline capture (network down) | `capturing`, `captured`, `failed` |
| `capturing` | Claimed by a tab for capture (lock held) | `captured`, `capture_pending` (on release) |
| `captured` | Payment captured and synced to server | Terminal state |
| `declined` | Gateway declined the card | Terminal state |
| `failed` | Max retries exhausted or permanent error | Terminal state |

## Crash Recovery

### How Intents Survive Restarts

Intents are stored in IndexedDB (Dexie), which persists across page refreshes and browser crashes. On initialization, `PaymentIntentManager.initialize()` starts a sync worker that runs every 15 seconds and also triggers immediately on the browser `online` event.

### Recovery Flow

1. **Sync worker starts** (every 15s interval or on `online` event)
2. **Queries IndexedDB** for intents in `capture_pending`, `authorized` (uncaptured), or stale `capturing` states
3. **Applies backoff filter** — skips intents that haven't waited long enough since their last attempt
4. **Claims each intent** atomically via Dexie transaction (see Capture Lock below)
5. **Batch syncs** claimed intents to `/api/orders/sync-resolution`
6. **Updates status** based on server response: `synced` -> captured, `duplicate_ignored` -> captured, `failed` -> increment attempt counter or mark as permanently failed

### Concurrency Guard

The `processPendingIntents()` method uses a generation counter (`processingGeneration`) to prevent race conditions when both the 15s interval and the `online` event fire simultaneously. Only the latest generation clears the `isProcessing` flag.

## Backoff Configuration

| Parameter | Value |
|-----------|-------|
| Max retries | `10` |
| Base delay | `15s` |
| Multiplier | `2x` (exponential) |
| Max delay cap | `2min` |

Backoff schedule: 15s, 30s, 60s, 120s, 120s, 120s, 120s, 120s, 120s, 120s

The `shouldRetry(intent)` function checks:
1. `intent.attempts < 10` (max retries not exceeded)
2. Time since `intent.lastAttempt` >= required delay for current attempt count

When max retries are exhausted, the intent is permanently marked as `failed` with a descriptive error message.

## Deduplication Logic

Each intent carries an `idempotencyKey` with format:

```
{terminalId}-{orderId}-{amountCents}-{timestamp}-{uuid8}
```

- The UUID suffix ensures 100% collision resistance even with clock skew or retries
- The amount in cents catches mismatched replays (same order, different amount)
- The server's `/api/orders/sync-resolution` endpoint uses this key to detect and ignore duplicates
- Server returns `duplicate_ignored` status for already-processed intents, which the client treats as a successful capture

## Capture Lock Mechanism

The capture lock prevents multiple browser tabs from processing the same intent simultaneously.

### How It Works

`claimIntent(intentId)` runs inside a Dexie `readwrite` transaction:

1. Re-reads the intent inside the transaction
2. Checks if the intent is in a claimable state:
   - `capture_pending` (normal case)
   - `authorized` without capture (edge case)
   - `capturing` with stale claim (crashed tab recovery)
3. Transitions status to `capturing` and sets `claimedAt` and `claimedBy` (tab UUID)
4. Only one tab can win this atomic write — others see the updated status and skip

### Stale Claim Recovery

If an intent stays in `capturing` status for more than **5 minutes** (`STALE_CLAIM_TIMEOUT_MS`), it is assumed the claiming tab crashed. Any other tab can then reclaim it.

The `tabId` is a UUID generated per `PaymentIntentManagerClass` instance (per browser tab). This allows identifying which tab owns a claim.

### Release on Failure

`releaseIntent(intentId)` reverts an intent back to `capture_pending` if the capture attempt fails AND the current tab still owns the claim. This ensures the intent will be retried by the next sync cycle.

## Manual Reconciliation for Exhausted Intents

When an intent reaches `failed` status (10 retries exhausted):

### Identifying Failed Intents

1. Call `PaymentIntentManager.getIntentsNeedingReconciliation()` — returns all intents flagged with `needsReconciliation: true`
2. Call `PaymentIntentManager.getRecentIntents(limit)` and filter for `status === 'failed'`
3. Check the `statusHistory` array on each intent for the full timeline of what happened

### Resolution Steps

1. **Check the order in the POS** — does the order show as paid? If yes, the intent may have been captured through another path.
2. **Check Datacap records** — use the `gatewayTransactionId` or `authorizationCode` on the intent to look up the transaction in Datacap's portal.
3. **If payment went through at Datacap but not in POS:** Manually create a Payment record for the order and mark the intent as reconciled via `PaymentIntentManager.markReconciled(intentId, employeeId)`.
4. **If payment never went through at Datacap:** The authorization may have expired. No money was taken. Close the order appropriately (re-charge or write off).

### EOD Report Flagging

Intents with `isOfflineCapture: true` and `needsReconciliation: true` appear in the end-of-day report as items requiring verification. The `getOfflineCapturedIntents()` method retrieves these for the report.

### Cleanup

`cleanupOldIntents()` removes captured intents older than 30 days from IndexedDB. This should be called periodically (e.g., during EOD reset) to prevent unbounded storage growth.
