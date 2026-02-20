# Skill 392 — Reader Health State Machine

**Domain:** Payments / Hardware
**Date:** 2026-02-20
**Commit:** 14de60e
**Addresses:** Third-party audit §1 — Reader Lifecycle and EMVPadReset

---

## Overview

Per-reader in-memory health tracking. Every payment reader has a health status (`healthy | degraded`). Readers are automatically marked **degraded** when `EMVPadReset` fails after a transaction. Degraded readers refuse all new transactions with a clear operator message until the state is cleared.

---

## Health Status Lifecycle

```
healthy ──(pad reset fails)──► degraded
                                    │
                              operator action:
                              - POST /api/datacap/pad-reset  (manual reset succeeds)
                              - clearReaderHealth(readerId)  (programmatic)
                                    │
degraded ──(state cleared)──► healthy
```

---

## New File: `src/lib/datacap/reader-health.ts`

```typescript
export type ReaderHealthStatus = 'healthy' | 'degraded'

export interface ReaderHealth {
  status: ReaderHealthStatus
  updatedAt: Date
  reason?: string
}

// Module-level singleton — persists for the life of the Node.js process
const healthMap = new Map<string, ReaderHealth>()

export function getReaderHealth(readerId: string): ReaderHealth
export function markReaderHealthy(readerId: string): void
export function markReaderDegraded(readerId: string, reason: string): void
export function clearReaderHealth(readerId: string): void
export function assertReaderHealthy(readerId: string): void  // throws if degraded
```

---

## Integration in `withPadReset` (client.ts)

```typescript
private async withPadReset<T>(readerId, fn): Promise<T> {
  // 1. Refuse if degraded
  assertReaderHealthy(readerId)

  const reader = await getReaderInfo(readerId)
  const seqNo = await getSequenceNo(readerId)

  let result: T
  try {
    result = await fn(reader, seqNo)
  } finally {
    try {
      await this.padReset(readerId)
      markReaderHealthy(readerId)     // ← pad reset OK → healthy
    } catch (resetError) {
      markReaderDegraded(readerId, reason)  // ← pad reset failed → degraded
      logger.error('datacap', 'Pad reset failed — reader marked degraded', ...)
    }
  }
  return result
}
```

---

## Configurable Pad Reset Timeout

`padResetTimeoutMs` is now a field on `DatacapConfig`. Increase for high-latency or congested venues.

```typescript
const config: DatacapConfig = {
  // ...
  padResetTimeoutMs: 8000,  // Default: 5000ms — increase for slow networks
}
```

Set in `getDatacapClient()` via `payments.padResetTimeoutMs` location setting (when wired to settings UI).

---

## What Operators See

When a transaction is attempted on a degraded reader, the API returns:

```json
{
  "error": "Reader reader-1 is degraded and not accepting transactions: Pad reset failed — ECONNREFUSED. Restart the device or use POST /api/datacap/pad-reset to clear the reader state."
}
```

---

## Clearing Degraded State

**Option 1 — Admin manually resets pad:**
```
POST /api/datacap/pad-reset
{ "locationId": "loc-abc", "readerId": "reader-1" }
```
A successful pad reset automatically calls `clearReaderHealth(readerId)`.

**Option 2 — Programmatic:**
```typescript
import { clearReaderHealth } from '@/lib/datacap'
clearReaderHealth('reader-1')
```

**Option 3 — Server restart** — `healthMap` is in-memory; clears on process restart.

---

## API Exports

`helpers.ts` and `index.ts` re-export:
```typescript
import { getReaderHealth, clearReaderHealth } from '@/lib/datacap'
import type { ReaderHealth } from '@/lib/datacap'
```

---

## Edge Cases

| Scenario | Behavior |
|----------|----------|
| Transaction fails (network error) | Reader NOT marked degraded — only pad reset failure triggers degraded |
| Pad reset succeeds after bad transaction | Reader marked healthy |
| Manual `POST /api/datacap/pad-reset` succeeds | Clears degraded state |
| Server restart | All health state resets to `healthy` (in-memory only) |
| Unknown reader | `getReaderHealth` returns `{ status: 'healthy' }` — safe default |
