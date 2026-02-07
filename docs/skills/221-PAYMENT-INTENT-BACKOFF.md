# Skill 221: Payment Intent Backoff Logic

**Status:** ✅ DONE (2026-02-06)
**Category:** Payments
**Dependencies:** None
**Related Skills:** 120 (Datacap Direct Integration)

## Problem

The payment intent manager was hammering the sync endpoint during network outages, causing:
- Excessive server load
- Battery drain on terminals
- Network congestion
- No intelligent retry strategy

Previously, failed payment intents would retry every 15 seconds indefinitely, regardless of:
- How many times they'd already failed
- Whether the network was back up
- The severity of the error

## Solution

Implemented exponential backoff with generation counters for payment intent sync retries.

### Backoff Configuration

```typescript
const BACKOFF_CONFIG = {
  maxRetries: 10,
  baseDelayMs: 15000,     // 15 seconds
  maxDelayMs: 120000,      // 2 minutes
  multiplier: 2,
} as const
```

### Backoff Schedule

| Attempt | Delay | Total Time Elapsed |
|---------|-------|-------------------|
| 1 | 15s | 15s |
| 2 | 30s | 45s |
| 3 | 1m | 1m 45s |
| 4 | 2m (capped) | 3m 45s |
| 5 | 2m (capped) | 5m 45s |
| ... | 2m (capped) | ... |
| 10 | 2m (capped) | ~20m total |

After 10 attempts, the intent is marked as `failed` and requires manual resolution.

### Key Functions

#### `calculateBackoffDelay(attempts: number): number`

Calculates the required delay before next retry attempt.

```typescript
function calculateBackoffDelay(attempts: number): number {
  const delay = BACKOFF_CONFIG.baseDelayMs * Math.pow(BACKOFF_CONFIG.multiplier, attempts - 1)
  return Math.min(delay, BACKOFF_CONFIG.maxDelayMs)
}
```

#### `shouldRetry(intent: PaymentIntent): boolean`

Determines if an intent should be retried based on attempts and time since last attempt.

```typescript
function shouldRetry(intent: PaymentIntent): boolean {
  // Check max retries
  if (intent.attempts >= BACKOFF_CONFIG.maxRetries) return false

  // First attempt always allowed
  if (!intent.lastAttempt) return true

  // Check if enough time has passed since last attempt
  const requiredDelay = calculateBackoffDelay(intent.attempts)
  const timeSinceLastAttempt = Date.now() - new Date(intent.lastAttempt).getTime()

  return timeSinceLastAttempt >= requiredDelay
}
```

### Changes to Payment Intent Manager

**File:** `/src/lib/payment-intent-manager.ts`

#### 1. Filter Intents in `processPendingIntents()`

```typescript
export async function processPendingIntents() {
  const intents = await db.paymentIntent.findMany({
    where: {
      status: 'pending',
      syncedAt: null,
    }
  })

  // Filter to only intents ready for retry
  const readyIntents = intents.filter(shouldRetry)

  logger.payment('Processing payment intents', {
    total: intents.length,
    ready: readyIntents.length,
    waiting: intents.length - readyIntents.length
  })

  for (const intent of readyIntents) {
    await syncIntent(intent.id)
  }
}
```

#### 2. Mark Failed Intents in `batchSyncIntents()`

```typescript
export async function batchSyncIntents(locationId: string) {
  const intents = await db.paymentIntent.findMany({
    where: {
      locationId,
      status: 'pending',
      syncedAt: null,
    },
    orderBy: { createdAt: 'asc' },
    take: 50,
  })

  const readyIntents = intents.filter(shouldRetry)

  // Mark max-retry intents as failed
  const failedIntents = intents.filter(
    i => i.attempts >= BACKOFF_CONFIG.maxRetries
  )

  for (const intent of failedIntents) {
    await db.paymentIntent.update({
      where: { id: intent.id },
      data: {
        status: 'failed',
        error: `Max retry attempts (${BACKOFF_CONFIG.maxRetries}) exceeded`
      }
    })

    logger.payment('Payment intent failed after max retries', {
      intentId: intent.id,
      attempts: intent.attempts
    })
  }

  // Process ready intents
  for (const intent of readyIntents) {
    await syncIntent(intent.id)
  }
}
```

## Benefits

### 1. Reduced Server Load

Exponential backoff prevents retry storms:
- 10 terminals × every 15s = 40 requests/min
- With backoff: starts at 40/min, drops to 4/min after a few attempts

### 2. Network-Friendly

Automatic backoff during prolonged outages:
- Short outage (1-2 min): Fast recovery with frequent retries
- Long outage (>5 min): Backs off to 2-minute intervals

### 3. Battery Conservation

Mobile terminals conserve battery by reducing network activity during known outages.

### 4. Intelligent Failure Handling

After 10 attempts (~20 minutes), intents are marked `failed` for manual review:
- Prevents infinite retry loops
- Surfaces systemic issues (bad API endpoint, authentication problems)
- Allows support team to investigate

### 5. Visibility

Detailed logging shows retry behavior:
```
Processing payment intents: { total: 15, ready: 5, waiting: 10 }
Payment intent failed after max retries: { intentId: 'xyz', attempts: 10 }
```

## Testing

### Simulate Network Outage

1. Create payment intent
2. Disconnect network
3. Observe retry schedule in logs
4. Verify delays increase exponentially
5. After 10 attempts, verify intent marked as `failed`

### Verify Recovery

1. Create payment intent during outage
2. After 2-3 attempts, restore network
3. Verify intent syncs successfully on next retry

## Future Enhancements

### Jitter

Add random jitter to prevent thundering herd:
```typescript
const jitter = Math.random() * 1000 // 0-1s
return Math.min(delay + jitter, BACKOFF_CONFIG.maxDelayMs)
```

### Adaptive Backoff

Adjust backoff based on error type:
- Network errors: Longer backoff (network may be unstable)
- 5xx errors: Medium backoff (server issues)
- 4xx errors: No retry (client error, won't resolve)

### Circuit Breaker

Stop all retries if multiple intents fail:
```typescript
if (recentFailureRate > 50%) {
  // Circuit open - stop all sync attempts for 5 minutes
  await sleep(5 * 60 * 1000)
}
```

## Related Files

- `/src/lib/payment-intent-manager.ts` - Main implementation
- `/src/lib/logger.ts` - Logging utility
- `/prisma/schema.prisma` - PaymentIntent model

## Dependencies

None - this is a pure enhancement to existing payment intent logic.

## Deployment Notes

No migration required - uses existing PaymentIntent schema fields:
- `attempts` - Number of sync attempts
- `lastAttempt` - Timestamp of last attempt
- `status` - 'pending' | 'completed' | 'failed'

## Monitoring

Watch for:
- High `failed` intent count → Systemic issue (API down, auth broken)
- Many intents with `attempts > 5` → Intermittent network issues
- Intents stuck at `attempts = 0` → Processor not running
