# Breaker Audit: 5000-Venue Deployment Readiness — 2026-03-26

**Scope:** 11 chaos/breaker agents simulating real-world failure modes
**Goal:** Find everything that breaks before bartenders and servers find it

---

## DEPLOYMENT BLOCKERS (Must Fix Before 5000 Venues)

| # | Finding | Agent | Impact |
|---|---|---|---|
| B1 | Payment `onDelete: Cascade` — deleting Payment cascades to delete entire Order | Schema | Order data loss |
| B2 | TimeClockEntry allows duplicate active clock-ins (no unique constraint) | Schema | Employee paid 3x wages |
| B3 | Transaction deadlock has NO retry logic — returns 500 | Crash vectors | Concurrent operations fail |
| B4 | EOD doesn't check `tabStatus='closing'` — double-capture risk | Concurrent load | Tab captured twice |
| B5 | Refund amount has NO server-side max check against payment | Payment failures | Refund > payment amount |
| B6 | Deleted MenuItem crashes item response mapper (null reference) | Crash vectors | Server 500 on stale orders |
| B7 | Gift card + card partial: card charged but TX rollback doesn't void card | Payment failures | Card charged, order unpaid |

## CRITICAL (Fix This Sprint)

| Finding | Agent |
|---|---|
| Advisory lock serializes ALL order creation per location (5s at 50 terminals) | Concurrent load |
| Connection pool (20) starvation under peak (50 terminals) | Concurrent load |
| Idempotency check for item add happens OUTSIDE transaction | Concurrent load |
| No automatic void on Datacap timeout (card charged, POS unknown) | Payment failures |
| adminDb bypasses tenant scoping (needs lint rule) | Multi-tenant |
| Rate limiter resets on NUC restart (brute-force window) | Restart recovery |
| 30-min offline terminal needs 18 sequential catch-up requests | Concurrent load |
| WalkoutRetry not created before Datacap capture sent | Restart recovery |

## HIGH (Fix Before Pilot)

| Finding | Agent |
|---|---|
| Tab zombie "closing" state stuck 60s with no proactive scan | Restart recovery |
| Pre-auth expires after 7 days with no monitoring | Payment failures |
| Socket event buffer pruned after 1 hour (long-offline terminals) | Restart recovery |
| No reconnection storm protection (50 terminals reconnect at once) | Concurrent load |
| Comp/void idempotency not guaranteed (double tip allocation) | Crash vectors |
| 10K open orders query has no pagination limit | Crash vectors |
| 100 splits on one order has no upper bound | Crash vectors |

## ARCHITECTURE STRENGTHS CONFIRMED

- Database-per-venue routing is SOLID (no cross-tenant leak found)
- Socket room isolation CORRECT (location-scoped, validated)
- FOR UPDATE locks prevent most double-charges
- Three-phase payment locking works correctly
- Sync workers are idempotent (safe to replay)
- Readiness gate blocks orders until menu/employees loaded (15-25s boot)
- All financial fields use Decimal(10,2) — no float precision issues
- Soft-delete consistently enforced
- Migrations are idempotent with IF NOT EXISTS guards
- NUC can operate fully offline indefinitely

## REMAINING AGENTS (4 of 11 still running)
- Network flap simulation
- Error handling / uncaught exceptions
- Device edge cases (Android/KDS)
- Timezone + DST bugs
- Vercel serverless at scale
