# Skill 409: Order Mutation Race Conditions

**Status:** Done
**Date:** Feb 23, 2026
**Commits:** `dbec3c6`

## Problem

Multiple critical race conditions existed across order mutation API routes that could cause:
1. **Double payment** — Two terminals charging the same order simultaneously (customer charged twice)
2. **Items added to paid orders** — Terminal A adds items while Terminal B pays, items slip past status check
3. **Void during payment** — Void reduces total while payment processes original amount
4. **Lost updates** — No optimistic concurrency control; last write wins silently

Root cause: Order row was read with plain `findUnique` (no lock), status checked in application code, then mutations executed — with no database-level serialization between concurrent requests.

## Solution

### Pay Route (`src/app/api/orders/[id]/pay/route.ts`)

1. **Status guard inside transaction** — Changed `tx.order.update({ where: { id } })` to `tx.order.updateMany({ where: { id, status: { in: ['open', 'in_progress'] } } })`. Check `count === 0` → HTTP 409 "Order already paid or closed by another terminal"
2. **Server-side idempotency key** — If client omits `idempotencyKey`, generate via `crypto.randomUUID()`. Every payment now always gets a key, leveraging the existing `@unique` constraint on `Payment.idempotencyKey`
3. **Version increment** — `version: { increment: 1 }` on order update

### Items Route (`src/app/api/orders/[id]/items/route.ts`)

1. **FOR UPDATE lock** — `SELECT id, status FROM "Order" WHERE id = $1 FOR UPDATE` at top of transaction. Locks the order row for the duration, serializing concurrent item additions
2. **Status check on locked row** — Only allows `['open', 'draft', 'in_progress']`
3. **Version increment** — `version: { increment: 1 }` on order totals update
4. **409 handler** — `ORDER_NOT_MODIFIABLE` → HTTP 409

### Comp-Void Route (`src/app/api/orders/[id]/comp-void/route.ts`)

1. **FOR UPDATE lock** — Same pattern as items route, serializes with pay route's lock
2. **Status check** — Rejects `['paid', 'closed', 'voided']` orders
3. **409 handler** — `ORDER_ALREADY_SETTLED` → HTTP 409
4. Version increment was already present

### Send Route (`src/app/api/orders/[id]/send/route.ts`)

1. **Version increment** — `version: { increment: 1 }` on every send (changed from conditional draft-only to always-run)
2. FOR UPDATE lock was already present

## How the Locks Serialize

All four routes now acquire `FOR UPDATE` on the Order row inside their transactions. PostgreSQL row-level locks ensure:
- If Terminal A is paying, Terminal B's void waits for the lock, then sees `status = 'paid'` → returns 409
- If Terminal A is adding items, Terminal B's payment waits for the lock, then processes with correct totals
- The `version` field increments on every mutation, enabling future client-side optimistic locking

## Files Modified

| File | Change |
|------|--------|
| `src/app/api/orders/[id]/pay/route.ts` | Status guard, server-side idempotency key, version increment |
| `src/app/api/orders/[id]/items/route.ts` | FOR UPDATE lock, status check, version increment, 409 handler |
| `src/app/api/orders/[id]/comp-void/route.ts` | FOR UPDATE lock, status check, 409 handler |
| `src/app/api/orders/[id]/send/route.ts` | Version increment (always, not draft-only) |
