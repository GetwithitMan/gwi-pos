# Skill 428: Wave 7 -- Online Safety, Combos/Timed Rentals, Tips & Reports, Crash Guards

**Status:** Done
**Date:** Feb 24, 2026
**Commit:** `743e618`

## Problem

Wave 7 targeted 40 critical/high/medium bugs across 5 domains that affect real money, inventory accuracy, and system uptime. These were grouped into 17 task groups across: online ordering safety (O1-O4), combo/timed rental correctness (C1-C4), tip ledger and payroll formulas (T1-T4), payment safety (P1-P2), and crash guard error handling (E1-E3).

## Solution

### Online Ordering Safety (O1-O4) -- 4 task groups

- **O1: Server-side modifier pricing** -- `online/checkout/route.ts`: Server fetches modifier prices from DB via `venueDb.modifier.findMany()` with ownership validation against `modifierGroup.menuItemId`. Client-submitted prices never trusted.
- **O2: deletedAt + enabled checks** -- `online/menu/route.ts` and `online/checkout/route.ts`: Added `deletedAt: null` filters on category and menuItem queries. `onlineSettings?.enabled` check returning 503 when online ordering is disabled.
- **O3: Rate limiter + soft-cancel** -- New file `src/lib/online-rate-limiter.ts`: Sliding window rate limiter (checkout=10 req/min, menu=30 req/min per IP+location), periodic cleanup with `.unref()`. Soft-cancel: `status: 'cancelled', deletedAt: new Date()` on payment failure.
- **O4: onlinePrice, quantity validation, system employee** -- `onlinePrice` field used via `mi.onlinePrice != null ? Number(mi.onlinePrice) : Number(mi.price)`. Quantity validation: `Number.isInteger(item.quantity) && item.quantity >= 1`. Dedicated system employee: searches for `displayName: 'Online Order'`, auto-creates if missing. orderType forced to online order type.

### Combos & Timed Rentals (C1-C4) -- 4 task groups

- **C1: deletedAt + 86 checks** -- `combos/route.ts`, `combos/[id]/route.ts`: Added `deletedAt: null` filters on all combo queries. `orders/[id]/items/route.ts`: 86/availability validation on combo component items.
- **C2: Combo inventory expansion** -- `inventory/order-deduction.ts`: Combo expansion fetches ComboTemplate -> components -> component MenuItems. `isCombo` guard prevents double-counting on combo wrappers. `inventory/void-waste.ts`: Combo expansion for void/waste path.
- **C3: Timed rental enforcement** -- `timed-sessions/[id]/route.ts`: `minimumCharge` enforced. `orders/[id]/comp-void/route.ts`: Void sets `entertainmentStatus: 'available'`, un-void restores `'in_use'`. `orders/[id]/pay/route.ts`: Per-minute pricing settlement added.
- **C4: pourMultiplier + spirit substitutions** -- `inventory/void-waste.ts`: `pourMultiplier` applied on voids (BUG #381). Spirit substitution map from `modifier.linkedBottleProduct` (BUG #382).

### Tips & Payroll (T1-T4) -- 4 task groups

- **T1: Ledger-only formula (BUG #415, #416, #423)** -- `reports/payroll/route.ts`: Critical fix -- `declaredTips` now sourced from DIRECT_TIP + TIP_GROUP ledger credits (not Shift.tipsDeclared). `bankedTipsCollected` excluded from netTips (informational only). Formula: `netTips = declaredTips - tipSharesGiven + tipSharesReceived`. `reports/tips/route.ts`: `totalTipOuts` uses `Math.abs(e.amountCents)` for positive display.
- **T2: Cash reconciliation + break deduction (BUG #426, #427)** -- `reports/daily/route.ts`: `cashPayoutsToday` computed from PAYOUT_CASH entries, subtracted from `cashDue`. `reports/employee-shift/route.ts`: Queries `timeClockEntry.breakMinutes`, computes `shiftHours = shiftHoursGross - breakMinutes / 60`.
- **T3: Batch adjust-tip (BUG #410-413)** -- `orders/batch-adjust-tips/route.ts`: Recalculates Order.total, increments version, calls allocateTipsForPayment, dispatches socket event.
- **T4: Atomic transfers + server-side shift close (BUG #417-421)** -- `tips/transfers/route.ts`: Entire transfer wrapped in `db.$transaction()` with balance check inside transaction lock. `shifts/[id]/route.ts`: Server computes `serverGrossTips`, `actualTipOutTotal`, `serverNetTips = gross - tipOuts`. Client values never trusted for tip fields.

### Payment Safety (P1-P2) -- 2 task groups

- **P1: close-tab + walkout guard (BUG #455-461)** -- `orders/[id]/close-tab/route.ts`: `db.payment.create()` in atomic transaction. `finalTipAmount = captureResult.tipAmount ?? 0` (not `||`). `datacap/walkout-retry/route.ts`: Atomic guard via `db.walkoutRetry.updateMany({ where: { id, status: 'pending' } })`. Payment record created in same transaction.
- **P2: Refund permissions + chargeback (BUG #470-473)** -- `datacap/refund/route.ts`: `PERMISSIONS.MGR_REFUNDS` instead of basic card permission. Refund cap: `amount > originalPayment.amount - refundedAmount`. `datacap/partial-reversal/route.ts`: Permission + amount cap. `datacap/auth-only/route.ts`: Permission check. `chargebacks/route.ts`: Sets `Payment.needsReconciliation = true` + AuditLog entry.

### Crash Guards (E1-E3) -- 3 task groups

- **E1: Process crash handlers** -- New file `src/instrumentation.ts`: Next.js `register()` export with `unhandledRejection` + `uncaughtException` handlers. Logs structured JSON, calls `process.exit(1)`.
- **E2: Error boundaries** -- 4 new `error.tsx` files: Global (glassmorphism neutral), POS (blue theme), Admin (orange theme), KDS (auto-retries after 5s via `useEffect + setTimeout`). All have `'use client'`, `{ error, reset }` props.
- **E3: Socket handler safety** -- `socket-server.ts`: All 12 socket.on() handlers wrapped in try/catch with structured error logging.

## Files Changed

38 files changed, +3257/-418 lines

### New Files (8)

| File | Description |
|------|-------------|
| `src/instrumentation.ts` | Process crash handlers |
| `src/app/error.tsx` | Global error boundary |
| `src/app/(pos)/error.tsx` | POS error boundary (blue) |
| `src/app/(admin)/error.tsx` | Admin error boundary (orange) |
| `src/app/(kds)/error.tsx` | KDS error boundary (auto-retry) |
| `src/lib/online-rate-limiter.ts` | Sliding window rate limiter |
| `docs/planning/PILOT-READINESS-CHECKLIST.md` | Pilot readiness checklist |
| `API_CALLS_AUDIT.csv` | Route audit (146+ verified) |

### Modified Files (30)

#### Online Ordering Safety (O1-O4)

| File | Task | Changes |
|------|------|---------|
| `src/app/api/online/checkout/route.ts` | O1, O2, O4 | Server-side modifier pricing, deletedAt filters, onlinePrice fallback, quantity validation, system employee |
| `src/app/api/online/menu/route.ts` | O2 | deletedAt: null filters on category and menuItem queries, enabled check returning 503 |

#### Combos & Timed Rentals (C1-C4)

| File | Task | Changes |
|------|------|---------|
| `src/app/api/combos/route.ts` | C1 | deletedAt: null filters on combo queries |
| `src/app/api/combos/[id]/route.ts` | C1 | deletedAt: null filters on combo detail query |
| `src/app/api/orders/[id]/items/route.ts` | C1 | 86/availability validation on combo component items |
| `src/lib/inventory/order-deduction.ts` | C2 | Combo expansion: ComboTemplate -> components -> MenuItems, isCombo guard |
| `src/lib/inventory/void-waste.ts` | C2, C4 | Combo expansion for void/waste, pourMultiplier on voids, spirit substitution map |
| `src/app/api/timed-sessions/[id]/route.ts` | C3 | minimumCharge enforcement |
| `src/app/api/orders/[id]/comp-void/route.ts` | C3 | Void sets entertainmentStatus: 'available', un-void restores 'in_use' |
| `src/app/api/orders/[id]/pay/route.ts` | C3 | Per-minute pricing settlement |

#### Tips & Payroll (T1-T4)

| File | Task | Changes |
|------|------|---------|
| `src/app/api/reports/payroll/route.ts` | T1 | Ledger-only formula: declaredTips from DIRECT_TIP + TIP_GROUP credits, bankedTipsCollected excluded |
| `src/app/api/reports/tips/route.ts` | T1 | totalTipOuts uses Math.abs(e.amountCents) for positive display |
| `src/app/api/reports/daily/route.ts` | T2 | cashPayoutsToday from PAYOUT_CASH entries, subtracted from cashDue |
| `src/app/api/reports/employee-shift/route.ts` | T2 | breakMinutes query, shiftHours = shiftHoursGross - breakMinutes / 60 |
| `src/app/api/orders/batch-adjust-tips/route.ts` | T3 | Recalculates Order.total, increments version, allocateTipsForPayment, socket event |
| `src/app/api/tips/transfers/route.ts` | T4 | Entire transfer in db.$transaction() with balance check inside lock |
| `src/app/api/shifts/[id]/route.ts` | T4 | Server-side serverGrossTips, actualTipOutTotal, serverNetTips computation |

#### Payment Safety (P1-P2)

| File | Task | Changes |
|------|------|---------|
| `src/app/api/orders/[id]/close-tab/route.ts` | P1 | db.payment.create() in atomic transaction, tipAmount ?? 0 |
| `src/app/api/datacap/walkout-retry/route.ts` | P1 | Atomic updateMany guard, payment record in same transaction |
| `src/app/api/datacap/refund/route.ts` | P2 | MGR_REFUNDS permission, refund cap against originalPayment.amount - refundedAmount |
| `src/app/api/datacap/partial-reversal/route.ts` | P2 | Permission check + amount cap |
| `src/app/api/datacap/auth-only/route.ts` | P2 | Permission check |
| `src/app/api/chargebacks/route.ts` | P2 | Payment.needsReconciliation = true + AuditLog entry |

#### Crash Guards (E1-E3)

| File | Task | Changes |
|------|------|---------|
| `src/lib/socket-server.ts` | E3 | All 12 socket.on() handlers wrapped in try/catch with structured error logging |

## Bug Cross-Reference

| Bug # | Domain | Description | Fix Summary |
|-------|--------|-------------|-------------|
| #381 | Inventory | pourMultiplier not applied on voids | Applied in void-waste.ts |
| #382 | Inventory | Spirit substitution missing on voids | linkedBottleProduct map in void-waste.ts |
| #384-388 | Online | Server-side pricing, deletedAt, enabled check, rate limit | checkout + menu routes hardened |
| #410-413 | Tips | Batch adjust-tip incomplete | Recalc total, version, ledger, socket |
| #415 | Tips | totalTipOuts sign wrong | Math.abs on DEBIT sum |
| #416 | Tips | Payroll double-count | Ledger-only formula, bankedTipsCollected excluded |
| #417 | Tips | Client-trusted tip fields at shift close | Server-side netTips computation |
| #418-421 | Tips | Transfer race condition | $transaction with lock |
| #423 | Tips | bankedTipsCollected double-count | Excluded from netTips |
| #426 | Reports | Cash reconciliation missing payouts | PAYOUT_CASH deduction |
| #427 | Reports | Shift report ignores breaks | breakMinutes query + deduction |
| #455-457 | Payments | close-tab Payment not created | db.payment.create in tx |
| #459-461 | Payments | Walkout retry double-charge | Atomic updateMany guard |
| #470-473 | Payments | Refund permission + caps | MGR_REFUNDS, amount caps, chargeback reflection |
| #477-478 | Crash | Unhandled promise/exception crashes server | instrumentation.ts handlers |
| #479-482 | Crash | No error boundaries | 4 error.tsx files per route group |
| #483 | Crash | Socket handler exceptions | try/catch on all 12 handlers |

## Key Patterns

- **Atomic transactions**: Tip transfers wrapped in `db.$transaction()` for ACID guarantees
- **Ledger-only formula**: Payroll tips sourced exclusively from ledger entries, not Shift model fields
- **Server-side computation**: Client values never trusted for money-related fields
- **Sliding window rate limit**: IP+location scoped, periodic cleanup with `.unref()`
- **Combo inventory expansion**: ComboTemplate -> components -> MenuItems for accurate deduction
- **Error boundary hierarchy**: Global -> route group with themed styling and auto-retry for KDS
