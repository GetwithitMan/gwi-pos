# Skill 383 — Bartender Speed Optimizations

**Domain:** Orders / Tabs
**Date:** 2026-02-20
**Commit:** (see Living Log)

---

## Overview

Two optimizations that eliminate blocking awaits from the bartender's most frequent actions — sending to a tab and starting a new tab — resulting in near-instant UI feedback.

---

## Optimization 1: Fire-and-Forget Start Tab (Existing Order Path)

**File:** `src/app/(pos)/orders/page.tsx` — `onStartTab()`

**Before:** 6 sequential awaits, 2–5 second UI block while:
1. Verifying card
2. Appending items to tab
3. Sending to kitchen
4. Auto-incrementing hold
5. Socket refresh

**After:** Capture state → clear UI at 0ms → run all network calls in background IIFE.

```ts
// Capture before clearing
const capturedOrderId = existingOrderId
const capturedItems = items.filter(i => !i.sentToKitchen)
const optimisticCardLast4 = tabCardInfo?.cardLast4 ?? ''

// Clear UI immediately — bartender can start next order
clearOrder()
setSavedOrderId(null)
toast.success(optimisticCardLast4 ? `Sending to tab •••${optimisticCardLast4}…` : 'Sending to tab…')

// Fire-and-forget background
void (async () => {
  // verify → append → send → auto-increment (best-effort)
})()
return
```

**Result:** Bartender taps "Send to Tab" → order clears instantly → they can start the next order immediately.

---

## Optimization 2: Instant New-Tab Card Modal

**Files:** `src/components/tabs/CardFirstTabFlow.tsx`, `src/app/(pos)/orders/page.tsx`, `src/app/(pos)/orders/OrderPageModals.tsx`

**Before:** Tapping "+ New Tab" → blocking `await POST /api/orders` (shell creation ~400ms) → modal appears.

**After:** Modal appears instantly in `'preparing'` state. Shell created in background. When shell ID arrives, component auto-starts card flow.

### How it works

**`orders/page.tsx`** — card-required new tab path:
```ts
// Show modal immediately with null orderId
setCardTabOrderId(null)
setShowCardTabFlow(true)

// Create shell in background
void (async () => {
  const shell = await createOrderShell()
  store.updateOrderId(shell.id, shell.orderNumber)
  setSavedOrderId(shell.id)
  setCardTabOrderId(shell.id)  // triggers CardFirstTabFlow to auto-start
})()
```

**`CardFirstTabFlow.tsx`** — handles null orderId:
```ts
// Initial state based on whether orderId exists
const [status, setStatus] = useState(orderId ? 'reading' : 'preparing')

// Auto-start fires when orderId becomes non-null
useEffect(() => {
  if (!orderId) return          // still preparing
  if (startedRef.current) return
  startedRef.current = true
  startFlow()
}, [orderId, startFlow])
```

**`OrderPageModals.tsx`** — render gate removed `cardTabOrderId` requirement:
```tsx
{showCardTabFlow && employee && (  // was: && cardTabOrderId
  <Modal>
    <CardFirstTabFlow orderId={cardTabOrderId} ... />
  </Modal>
)}
```

### Status states in CardFirstTabFlow

| Status | Shown when |
|--------|-----------|
| `preparing` | orderId is null (shell being created, ~300-400ms) |
| `reading` | CollectCardData in progress |
| `authorizing` | EMVPreAuth in progress |
| `done` | Tab opened successfully |
| `error` | Card declined |
| `existing_tab_found` | Returning card detected (see Skill 384) |
