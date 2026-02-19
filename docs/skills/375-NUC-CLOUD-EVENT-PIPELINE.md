# Skill 375 — NUC-to-Cloud Event Pipeline

**Date:** February 19, 2026
**Domain:** Cloud Sync, Payments, Infrastructure
**Priority:** P0

## Summary

Built the fire-and-forget event pipeline that sends `order_paid` events from the local NUC POS to the Java 25 backoffice at `api.ordercontrolcenter.com`. Includes HMAC-SHA256 signed requests, a local Postgres retry queue with exponential backoff, and idempotent ingestion on the Java side. Phase 1 is proven working with 7+ orders processed and $50.71 gross sales during live testing.

## Architecture

```
POS pay route (order_paid)
  → cloud-events.ts (HMAC-SHA256 sign + POST)
    → Success: logged, done
    → Failure: queued to cloud_event_queue (local PG)
      → Background worker retries every 30s
      → Exponential backoff, capped at 1 hour
      → Max queue size: 1000 events (FIFO eviction)

Java Backoffice receives:
  → Verify HMAC signature (constant-time)
  → Validate X-Server-Node-Id
  → INSERT INTO events (ON CONFLICT DO NOTHING — idempotent)
  → Extract payments[] → INSERT INTO payment_facts
  → Parse failure → dead_letter_events
```

## Deliverables

### POS Repo (gwi-pos)

| # | File | Description |
|---|------|-------------|
| 1 | `src/lib/cloud-events.ts` | HMAC-SHA256 signed event emitter. Signs request body with `SERVER_API_KEY`, sends `POST` to `BACKOFFICE_API_URL/api/events/ingest` with headers `X-Server-Node-Id` and `X-Request-Signature`. Fire-and-forget pattern — failures queue to local retry table. |
| 2 | `src/lib/cloud-event-queue.ts` | Local Postgres retry queue for failed cloud event emissions. `CloudEventQueue` Prisma model stores payload, attempt count, next retry time. Background worker runs every 30 seconds, retries with exponential backoff (base 30s, capped at 1 hour). Max queue size 1000 events with FIFO eviction. |
| 3 | `src/app/api/orders/[id]/pay/route.ts` | Wired `emitCloudEvent("order_paid", {...})` after successful payment. Fire-and-forget: `void emitCloudEvent(...).catch(console.error)`. Does not block payment response. |
| 4 | `src/lib/db.ts` | Added `CloudEventQueue` to `NO_SOFT_DELETE_MODELS` list — queue records use hard delete after successful retry, not soft delete. |

### Java Backoffice Repo (gwi-backoffice)

| # | Component | Description |
|---|-----------|-------------|
| 5 | Event ingestion endpoint | `POST /api/events/ingest` — HMAC verification, idempotent insert via `ON CONFLICT DO NOTHING` |
| 6 | Payment facts extraction | Parses `payments[]` from `order_paid` payload, inserts into `payment_facts` with composite key `(venue_id, payment_id)` |
| 7 | Dead letter storage | Failed parse/validation → `dead_letter_events` table for debugging |
| 8 | Daily totals report | `GET /api/reports/daily-totals?venueId=X&date=Y` — aggregates payment_facts |

## Environment Variables

| Variable | Dev Value | Production Value | Purpose |
|----------|-----------|-----------------|---------|
| `BACKOFFICE_API_URL` | `http://localhost:8080` | `https://api.ordercontrolcenter.com` | Java backoffice base URL |
| `SERVER_API_KEY` | `dev-secret` | Per-venue secret (provisioned by MC) | HMAC-SHA256 signing key |
| `SERVER_NODE_ID` | `dev-nuc-1` | Per-NUC ID (provisioned by MC) | Node identification in request headers |

## HMAC Signing

```typescript
// cloud-events.ts
import { createHmac } from 'crypto'

const signature = createHmac('sha256', SERVER_API_KEY)
  .update(JSON.stringify(payload))
  .digest('hex')

// Headers sent:
// X-Server-Node-Id: SERVER_NODE_ID
// X-Request-Signature: sha256=<signature>
// Content-Type: application/json
```

## Retry Queue Schema

```prisma
model CloudEventQueue {
  id          String   @id @default(cuid())
  eventType   String
  payload     Json
  attempts    Int      @default(0)
  maxAttempts Int      @default(10)
  nextRetryAt DateTime @default(now())
  lastError   String?
  createdAt   DateTime @default(now())
  locationId  String
}
```

- **Not soft-deleted**: Added to `NO_SOFT_DELETE_MODELS` in `db.ts` — records are hard-deleted after successful retry
- **Exponential backoff**: `nextRetryAt = now + min(30s * 2^attempts, 1 hour)`
- **FIFO eviction**: When queue exceeds 1000 events, oldest records are dropped

## End-to-End Test Results (Feb 19, 2026)

| Metric | Value |
|--------|-------|
| Orders processed | 7+ |
| Gross sales | $50.71 |
| Bugs found & fixed | 3 |
| Pipeline status | Proven working |

### Bugs Found During Testing

1. **Field name mappings**: Java expected different field names than POS sent — fixed mapping on both sides
2. **CloudEventQueue soft-delete**: Prisma `$extends` was adding `deletedAt` filter to queue queries, preventing retry worker from finding records — fixed by adding to `NO_SOFT_DELETE_MODELS`
3. **orderNumber type cast**: `orderNumber` sent as string but Java expected integer — added type coercion

## Key Design Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Fire-and-forget | `void emitCloudEvent().catch()` | Never block payment response for cloud sync |
| Local retry queue | Postgres table, not in-memory | Survives NUC restarts, no data loss |
| HMAC-SHA256 | Per-request signing | Same proven pattern as MC heartbeat |
| Idempotent ingestion | `ON CONFLICT DO NOTHING` | Safe replay/retry without duplicate financial rows |
| Hard delete on success | `NO_SOFT_DELETE_MODELS` | Queue records are transient, no audit trail needed |
| Exponential backoff | 30s base, 1hr cap | Prevents hammering during extended outages |

## Related Skills

- **Skill 374**: Reports Auth Fix (also completed this session)
- **Skill 347**: MC Heartbeat IP Display & Auto-Provisioning (same HMAC pattern)
- **Skill 345**: NUC Installer Package (provisions env vars)

## Related Documentation

- `/docs/BACKOFFICE-PIPELINE-TRACKER.md` — Living tracker for the full pipeline
