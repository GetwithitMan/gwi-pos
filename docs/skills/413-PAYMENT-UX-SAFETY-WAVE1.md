# Skill 413: Payment UX & Safety — Wave 1

**Status:** Done
**Date:** Feb 23, 2026

## Problem

Payment flows (Send, Start Tab, Add To Tab, Pay/Close) had UX issues: full-screen blockers instead of inline status, no failure recovery on Send, no visibility into tab auth state, and backend safety gaps (missing idempotency on close-tab, open-tab timeout leaving orders stuck in pending_auth). The CFD tip screen was a minimal placeholder with no order summary, no custom tip entry, and no disconnect handling.

## Solution

### Send to Kitchen — Optimistic UI Polish (Task #4)

**Files:** `src/hooks/useActiveOrder.ts`, `src/components/orders/OrderPanelActions.tsx`

- 3-state Send button: Idle → Sending... → ✓ Sent! (1.5s green flash)
- bgChain failure revert: items marked unsent again on background send failure
- Button disabled during send to prevent double-tap

### Start Tab — Non-Blocking Inline Status (Task #5)

**Files:** `src/components/payment/PaymentModal.tsx`

- Inline "Authorizing card..." text replaces full-screen modal blocker
- 15s slow-reader timeout warning (doesn't abort — lets call complete)
- Success: green "✓ Visa •••1234 authorized" flash
- Decline: prominent red error text with retry option
- Controls remain visible during authorization

### Add To Tab — Background Indicator (Task #6)

**Files:** `src/components/payment/PaymentModal.tsx`

- Socket listener for `tab:updated` events in PaymentModal
- `increment_failed`: amber "Card limit reached" banner
- `incremented`: silently update authorized amount display
- Non-blocking — server handles increment in background

### Pay/Close — Locked Controls + Safety (Task #7)

**Files:** `src/components/payment/PaymentModal.tsx`

- Inline "Processing payment..." with spinner (controls locked, order still visible)
- Verified: `idempotencyKey` sent in all pay paths
- Verified: version check + 409 handling on all paths
- Verified: double-click prevention via `isProcessing` flag
- No full-screen overlay — user can still see order details

### CFD Tip Screen (Task #8)

**Files:** `src/components/cfd/CFDTipScreen.tsx`, `src/app/(cfd)/cfd/page.tsx`, `src/types/multi-surface.ts`

- Full rework of CFDTipScreen component
- Order summary (subtotal, tax, total) at top of screen
- Tip preset buttons (percentage or dollar) with visual selection state
- No Tip button + Custom tip with numeric keypad
- Confirm CTA with live total (base + tip)
- Disconnect overlay with auto-reconnect polling
- Multi-surface type updates for tip screen events

### Backend Safety Audit (Task #9)

**Files:** `src/app/api/orders/[id]/pay/route.ts`, `src/app/api/orders/[id]/open-tab/route.ts`, `src/app/api/orders/[id]/auto-increment/route.ts`, `src/app/api/orders/[id]/close-tab/route.ts`

- close-tab: double-capture prevention guard (returns early if already paid)
- open-tab: timeout recovery (pending_auth → open on error, prevents stuck orders)
- Structured `[PAYMENT-SAFETY]` logs in all payment catch blocks
- Documented idempotency design in comments
- Version increment verified on all 5 payment routes

### Timing Instrumentation (Task #3)

**Files:** `src/lib/payment-timing.ts` (new), `src/hooks/useActiveOrder.ts`, `src/components/payment/PaymentModal.tsx`

- New `payment-timing.ts` module: 4-timestamp flow measurement (start, apiCall, apiReturn, uiComplete)
- Wired into Send, Cash Pay, Card Pay, Start Tab flows
- Structured `[PAYMENT-TIMING]` JSON logs with deltas between each phase
- Enables performance monitoring of payment latency in production

## Files Modified

| File | Change |
|------|--------|
| `src/hooks/useActiveOrder.ts` | 3-state send status, bgChain failure revert, timing instrumentation |
| `src/components/orders/OrderPanelActions.tsx` | Send button visual states (Idle/Sending/Sent) |
| `src/components/payment/PaymentModal.tsx` | Inline status for Start Tab/Pay/Close, tab:updated listener, timing probes |
| `src/components/cfd/CFDTipScreen.tsx` | Full rework: order summary, tip presets, custom tip, disconnect overlay |
| `src/app/(cfd)/cfd/page.tsx` | CFD tip screen event integration |
| `src/types/multi-surface.ts` | Tip screen event types for CFD communication |
| `src/app/api/orders/[id]/pay/route.ts` | Safety logs, idempotency verification |
| `src/app/api/orders/[id]/open-tab/route.ts` | Timeout recovery (pending_auth → open) |
| `src/app/api/orders/[id]/auto-increment/route.ts` | Safety logs, version increment verification |
| `src/app/api/orders/[id]/close-tab/route.ts` | Double-capture prevention guard |
| `src/lib/payment-timing.ts` | New — 4-timestamp payment flow instrumentation |
