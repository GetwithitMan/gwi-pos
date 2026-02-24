# Skill 422: Wave 1 Go-Live Safety Fixes

**Status:** Done
**Date:** Feb 23, 2026

## Problem

Pre-go-live safety audit identified 17 critical issues across payments, KDS, printing, security, and store stability that must be fixed before any real venue runs on the system. Issues ranged from void not reversing card charges (CRITICAL) to toast timer memory leaks (MEDIUM).

## Solution

### 17 Items Fixed

| # | ID | Severity | Bug | File(s) | Fix |
|---|-----|----------|-----|---------|-----|
| 1 | P1 | CRITICAL | Void doesn't reverse card charge | `comp-void/route.ts` | Datacap voidSale/emvReturn after DB void |
| 2 | P2 | CRITICAL | Simulated mode unguarded in prod | `datacap/client.ts` | NODE_ENV=production blocks simulated |
| 3 | P3 | CRITICAL | Invisible charge on DB failure | `pay/route.ts`, `DatacapPaymentProcessor` | Auto-void at Datacap on DB write failure |
| 4 | P4 | CRITICAL | Reopen+repay double-charges | `reopen/route.ts` | forceReopen guard + void old payments |
| 5 | P5 | HIGH | Split parent race condition | `pay/route.ts` | FOR UPDATE lock before sibling check |
| 6 | K1 | HIGH | Voided items stay on KDS | `comp-void/route.ts` | kds:item-status socket dispatch |
| 7 | K2 | HIGH | Resent items don't reappear on KDS | `kds/route.ts` | kds:item-status on resend |
| 8 | K3 | HIGH | Un-bump doesn't sync across KDS | `kds/expo/route.ts` | Socket dispatch on bump/serve/status |
| 9 | PR1 | MEDIUM | Direct print always returns 200 | `print/direct/route.ts` | Real failure status returned |
| 10 | PR2 | MEDIUM | Backup printer reads wrong field | `print/kitchen/route.ts` | Use PrintRoute backupPrinterIds |
| 11 | PR3 | MEDIUM | Cash drawer returns 200 on failure | `print/cash-drawer/route.ts` | HTTP 500 on failure |
| 12 | S1 | HIGH | No PIN brute-force protection | `auth/login/route.ts` | Rate limiter (5/employee, 10/IP) |
| 13 | S2 | HIGH | No session timeout | `useIdleTimer.ts`, `IdleTimerProvider` | 30min auto-logout, 25min warning |
| 14 | S3 | HIGH | Auth in editable localStorage | `auth-session.ts` | httpOnly signed JWT cookies |
| 15 | ST1 | MEDIUM | Toast timer memory leak | `toast-store.ts` | Store+clear timeout IDs, cap at 25 |
| 16 | ST2 | MEDIUM | previousOrder not cleared on logout | `order-store.ts` | Clear in clearOrder + all 3 logout paths |

### P1 (CRITICAL): Void Doesn't Reverse Card Charge — `comp-void/route.ts`

**Problem:** When voiding an order that was paid by card, the void only marked the order as voided in the database. The actual card charge at Datacap was never reversed, leaving the customer charged for a voided order.

**Fix:** After DB void, call Datacap `voidSale` (for same-batch) or `emvReturn` (for settled transactions) to reverse the card charge.

### P2 (CRITICAL): Simulated Mode Unguarded in Production — `datacap/client.ts`

**Problem:** The simulated payment mode (used for development/testing) had no production guard. If `settings.payments.processor` was accidentally set to `'simulated'` in production, all payments would appear to succeed without actually charging cards.

**Fix:** Added `NODE_ENV === 'production'` guard that blocks simulated mode entirely in production builds.

### P3 (CRITICAL): Invisible Charge on DB Failure — `pay/route.ts`, `DatacapPaymentProcessor`

**Problem:** If a card payment succeeded at Datacap but the subsequent database write failed, the customer was charged but the POS showed no record of the payment. The charge was invisible — no way to void or refund.

**Fix:** Added auto-void at Datacap if the DB write fails. The card charge is automatically reversed, and the error is surfaced to the user.

### P4 (CRITICAL): Reopen+Repay Double-Charges — `reopen/route.ts`

**Problem:** Reopening a paid order and paying it again could result in double-charging the customer. The original payment was not voided when the order was reopened.

**Fix:** Added `forceReopen` guard that voids all existing payments before allowing the order to be reopened and repaid.

### P5 (HIGH): Split Parent Race Condition — `pay/route.ts`

**Problem:** When paying the last split child, the sibling check to determine if all children are paid ran without a lock. Two concurrent payments on the last two children could both see unpaid siblings and skip parent auto-close.

**Fix:** Added `FOR UPDATE` lock on the parent order row before checking sibling payment status.

### K1 (HIGH): Voided Items Stay on KDS — `comp-void/route.ts`

**Problem:** When an item was voided, no socket event was dispatched to KDS screens. The voided item remained visible on the kitchen display until the next full refresh.

**Fix:** Added `kds:item-status` socket dispatch with `voided` status after item void.

### K2 (HIGH): Resent Items Don't Reappear on KDS — `kds/route.ts`

**Problem:** When a previously bumped item was resent to the kitchen, no socket event notified KDS screens. The resent item was invisible on all kitchen displays.

**Fix:** Added `kds:item-status` socket dispatch on resend so items reappear on KDS.

### K3 (HIGH): Un-Bump Doesn't Sync Across KDS — `kds/expo/route.ts`

**Problem:** When un-bumping an item on one KDS screen (moving it back from completed to active), other KDS screens were not notified. The item showed different states on different screens.

**Fix:** Added socket dispatch for bump, serve, and status change events so all KDS screens stay in sync.

### PR1 (MEDIUM): Direct Print Always Returns 200 — `print/direct/route.ts`

**Problem:** The direct print endpoint always returned HTTP 200 even when the print job failed. The POS had no way to know if a print actually succeeded.

**Fix:** Return real HTTP failure status codes when print jobs fail.

### PR2 (MEDIUM): Backup Printer Reads Wrong Field — `print/kitchen/route.ts`

**Problem:** When the primary printer was unavailable and failover was triggered, the backup printer lookup read from the wrong field. The backup printer was never actually used.

**Fix:** Read from `PrintRoute.backupPrinterIds` instead of the incorrect field.

### PR3 (MEDIUM): Cash Drawer Returns 200 on Failure — `print/cash-drawer/route.ts`

**Problem:** The cash drawer kick endpoint always returned HTTP 200, even when the drawer failed to open. No way to detect cash drawer failures.

**Fix:** Return HTTP 500 when the cash drawer command fails.

### S1 (HIGH): No PIN Brute-Force Protection — `auth/login/route.ts`

**Problem:** The PIN login endpoint had no rate limiting. An attacker could try all 10,000 4-digit PINs in seconds via automated requests.

**Fix:** Added rate limiter: 5 attempts per employee per minute, 10 attempts per IP per minute.

### S2 (HIGH): No Session Timeout — `useIdleTimer.ts`, `IdleTimerProvider`

**Problem:** Once logged in, sessions never expired. An unattended terminal stayed logged in indefinitely, allowing anyone to use it.

**Fix:** Added 30-minute idle timeout with a 25-minute warning toast. Auto-logout on timeout.

### S3 (HIGH): Auth Stored in Editable localStorage — `auth-session.ts`

**Problem:** Authentication tokens were stored in localStorage, which is readable and editable from browser DevTools. Any user could copy or modify their auth token.

**Fix:** Moved auth to httpOnly signed JWT cookies that cannot be read or modified from JavaScript.

### ST1 (MEDIUM): Toast Timer Memory Leak — `toast-store.ts`

**Problem:** Toast notification auto-dismiss timers were created with `setTimeout` but never cleared when toasts were manually dismissed. Rapid toast creation accumulated orphaned timers.

**Fix:** Store timeout IDs in the toast state, clear on manual dismiss, and cap maximum toasts at 25.

### ST2 (MEDIUM): previousOrder Not Cleared on Logout — `order-store.ts`

**Problem:** The `previousOrder` field in the order Zustand store was not cleared during logout. A subsequent login by a different employee could see the previous employee's last order data.

**Fix:** Clear `previousOrder` in `clearOrder()` and in all 3 logout paths (manual, idle timeout, session expired).

## Files Modified

| File | IDs | Changes |
|------|-----|---------|
| `src/app/api/orders/[id]/comp-void/route.ts` | P1, K1 | Datacap void/return after DB void; kds:item-status socket dispatch |
| `src/lib/datacap/client.ts` | P2 | NODE_ENV=production blocks simulated mode |
| `src/app/api/orders/[id]/pay/route.ts` | P3, P5 | Auto-void on DB failure; FOR UPDATE lock on split parent |
| `src/components/payment/DatacapPaymentProcessor.tsx` | P3 | Auto-void on DB write failure |
| `src/app/api/orders/[id]/reopen/route.ts` | P4 | forceReopen guard + void old payments |
| `src/app/api/kds/route.ts` | K2 | kds:item-status socket dispatch on resend |
| `src/app/api/kds/expo/route.ts` | K3 | Socket dispatch on bump/serve/status |
| `src/app/api/print/direct/route.ts` | PR1 | Real failure status codes |
| `src/app/api/print/kitchen/route.ts` | PR2 | Use PrintRoute.backupPrinterIds |
| `src/app/api/print/cash-drawer/route.ts` | PR3 | HTTP 500 on failure |
| `src/app/api/auth/login/route.ts` | S1 | Rate limiter (5/employee, 10/IP per min) |
| `src/hooks/useIdleTimer.ts` | S2 | 30min idle timeout hook |
| `src/components/IdleTimerProvider.tsx` | S2 | Provider component with 25min warning |
| `src/lib/auth-session.ts` | S3 | httpOnly signed JWT cookies |
| `src/stores/toast-store.ts` | ST1 | Store+clear timeout IDs, cap at 25 |
| `src/stores/order-store.ts` | ST2 | Clear previousOrder on logout |

## Testing

1. **P1 — Void reverses card charge** — Pay by card, void order. Verify Datacap void/return is called.
2. **P2 — Simulated blocked in prod** — Set NODE_ENV=production + processor=simulated. Verify payment is rejected.
3. **P3 — Auto-void on DB failure** — Simulate DB failure after card charge. Verify auto-void at Datacap.
4. **P4 — Reopen voids old payments** — Pay order, reopen with forceReopen. Verify old payments voided.
5. **P5 — Split parent lock** — Pay last two split children concurrently. Verify parent closes exactly once.
6. **K1 — Voided items removed from KDS** — Void an item. Verify KDS removes it immediately.
7. **K2 — Resent items reappear on KDS** — Bump item, resend. Verify it reappears on KDS.
8. **K3 — Un-bump syncs across KDS** — Un-bump on screen A. Verify screen B shows it active.
9. **PR1 — Print failure reported** — Send print to offline printer. Verify non-200 response.
10. **PR2 — Backup printer used** — Disable primary printer. Verify backup printer receives job.
11. **PR3 — Cash drawer failure reported** — Send drawer kick to disconnected printer. Verify 500 response.
12. **S1 — Brute-force blocked** — Send 6 rapid login attempts. Verify 6th is rate-limited.
13. **S2 — Idle timeout** — Leave terminal idle 30 minutes. Verify auto-logout.
14. **S3 — Auth not in localStorage** — Login, check localStorage. Verify no auth token present.
15. **ST1 — No timer leak** — Create and dismiss 50 toasts rapidly. Verify no orphaned timers.
16. **ST2 — previousOrder cleared** — Login as employee A, create order, logout, login as employee B. Verify no previous order from A.
