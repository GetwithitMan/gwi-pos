# Skill 384 — Card Re-Entry by Datacap Token (RecordNo)

**Domain:** Tabs / Payments
**Date:** 2026-02-20
**Commit:** f391a03

---

## Overview

When a guest already has an open tab and their card is swiped again at any terminal, the system detects the returning card via Datacap's persistent vault token (`RecordNo`) and routes the bartender directly to the existing tab — with zero new pre-auth hold.

---

## How RecordNo Works

Datacap's `RecordNo` is a vault token assigned to a card's PAN. Same physical card = same RecordNo in the Datacap vault. It is returned in the `EMVPreAuth` response (with `requestRecordNo: true`) and stored on `OrderCard.recordNo`.

---

## Two-Stage Detection (Server-Side)

All detection happens inside `POST /api/orders/[id]/open-tab` — no extra client round trips.

### Stage 1 — Before EMVPreAuth (zero new hold)

After `CollectCardData` succeeds, check if Datacap returned a RecordNo (happens for previously-vaulted cards):

```ts
const collectRecordNo = collectResponse.recordNo || null
if (collectRecordNo) {
  const existing = await db.orderCard.findFirst({
    where: {
      recordNo: collectRecordNo,
      deletedAt: null,
      order: { status: 'open', orderType: 'bar_tab', locationId },
    },
    orderBy: { createdAt: 'desc' },
    include: { order: { select: { id: true, tabName: true, orderNumber: true } } },
  })
  if (existing) {
    // Reset pending_auth status, return early — NO EMVPreAuth runs
    void db.order.update({ where: { id: orderId }, data: { tabStatus: 'open' } }).catch(() => {})
    return NextResponse.json({ data: { tabStatus: 'existing_tab_found', existingTab: { ... } } })
  }
}
```

### Stage 2 — After EMVPreAuth (void new hold)

If Stage 1 didn't catch it (first-time cards where CollectCardData doesn't return RecordNo):

```ts
const recordNo = preAuthResponse.recordNo
const existingByRecordNo = await db.orderCard.findFirst({
  where: { recordNo, deletedAt: null, order: { status: 'open', orderType: 'bar_tab', locationId } },
  orderBy: { createdAt: 'desc' },
  include: { order: { select: { id: true, tabName: true, orderNumber: true } } },
})
if (existingByRecordNo) {
  // Void the new hold — RecordNo-based, no card present needed
  void client.voidSale(resolvedReaderId, { recordNo }).catch(err =>
    console.error('[Tab Open] Failed to void duplicate hold:', err)
  )
  void db.order.update({ where: { id: orderId }, data: { tabStatus: 'open' } }).catch(() => {})
  return NextResponse.json({ data: { tabStatus: 'existing_tab_found', existingTab: { ... } } })
}
// No match → proceed with normal OrderCard creation
```

### Response Shape

```ts
{
  data: {
    tabStatus: 'existing_tab_found',
    existingTab: {
      orderId: string
      tabName: string
      tabNumber: number
      authAmount: number
      brand: string
      last4: string
    }
  }
}
```

---

## Client — CardFirstTabFlow UI

New `'existing_tab_found'` status displays:

```
┌──────────────────────────────────┐
│         [card icon blue]         │
│      Tab Already Open            │
│   This card has an existing tab  │
│  ┌──────────────────────────────┐│
│  │ John Smith                   ││
│  │ VISA •••• 4242 · $100 hold   ││
│  └──────────────────────────────┘│
│  [ Different Card ]  [ Open Tab ]│
└──────────────────────────────────┘
```

- **"Open Tab"**: calls `onComplete({ tabStatus: 'existing_tab_found', existingTab })`
- **"Different Card"**: resets `startedRef`, clears `existingTabInfo`, restarts `startFlow()`

---

## Client — onCardTabComplete Handler

In `orders/page.tsx`:
```ts
if (result.tabStatus === 'existing_tab_found' && result.existingTab) {
  // Cancel shell order (fire-and-forget)
  if (cardTabOrderId) {
    fetch(`/api/orders/${cardTabOrderId}`, {
      method: 'PATCH',
      body: JSON.stringify({ status: 'cancelled' }),
    }).catch(() => {})
  }
  setCardTabOrderId(null)
  // Navigate to existing tab via setOrderToLoad
  setOrderToLoad({ id: existingTab.orderId, ... })
  toast.success(`Opened existing tab — ${existingTab.tabName}`)
  return
}
```

---

## Real-Time TabsPanel (Phase 2)

`TabsPanel.tsx` now subscribes to socket events so all terminals stay in sync:

```ts
import { useEvents } from '@/lib/events/use-events'

const { subscribe, isConnected } = useEvents()

useEffect(() => {
  if (!isConnected) return
  const unsubs = [
    subscribe('tab:updated', () => loadTabs()),
    subscribe('orders:list-changed', () => loadTabs()),
  ]
  return () => unsubs.forEach(u => u())
}, [isConnected, subscribe, loadTabs])
```

Also fixed: `void-tab` route was missing `dispatchTabUpdated` — voided tabs now disappear from all terminals in real time.

---

## Schema

```prisma
model OrderCard {
  // ...
  recordNo    String?
  @@index([recordNo])   // ← added for fast token lookup
}
```

---

## Edge Cases

| Scenario | Behavior |
|----------|----------|
| `recordNo` missing (sim mode, old reader) | Skips lookup, normal preAuth flow |
| Multiple open tabs with same token | `orderBy: { createdAt: 'desc' }` picks most recent; logs warning |
| User taps "Different Card" | Resets `startedRef`, restarts CollectCardData |
| User cancels while shell is null | `onCardTabCancel` guards with `if (cardTabOrderId)` — no orphan cancel attempted |
| Stage 2 void fails | Logged, flow still returns `existing_tab_found` (the hold will expire naturally) |
