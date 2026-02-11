---
skill: 231
title: Per-Item Delays
status: DONE
depends_on: [13, 230]
---

# Skill 231: Per-Item Delays

> **Status:** DONE
> **Domain:** Orders
> **Dependencies:** 13 (Hold & Fire), 230 (Quick Pick Numbers)
> **Last Updated:** 2026-02-10

## Overview

Per-item delay presets that schedule items to fire to the kitchen after a countdown. Supports 5m/10m presets, custom minute entry via number pad, live countdown timers, manual "Fire Now" override, and auto-fire when the timer reaches zero.

## How It Works

1. Select item in order panel (or via Quick Pick)
2. Tap delay preset (5m, 10m) or custom delay (`···` button → number pad) in Quick Pick strip
3. Item shows blue delay badge -- "starts on Send"
4. On Send to Kitchen: timer starts counting down
5. Countdown renders on the item in OrderPanel (e.g., "Fires in 3:42")
6. At zero: item auto-fires to kitchen
7. "Fire Now" button available to manually fire before timer expires

### Hold/Delay Mutual Exclusivity

- Setting a delay clears any hold on the item
- Holding an item clears any active delay
- They cannot coexist on the same item

### Course-Level Delays

When coursing is enabled, delays can also be set at the course level via `CourseDelayControls`, applying to all items in that course.

## Key Files

| File | Purpose |
|------|---------|
| `src/components/orders/OrderDelayBanner.tsx` | Countdown banner at top of pending section -- 3 states: preset, counting, fired |
| `src/components/orders/CourseDelayControls.tsx` | Delay controls between course groups with preset buttons and countdown |
| `src/components/orders/QuickPickStrip.tsx` | DLY section with 5m/10m presets + custom delay number pad |
| `src/components/orders/OrderPanelItem.tsx` | Delay badge rendering on individual items |
| `src/stores/order-store.ts` | `delayMinutes`, `delayStartedAt`, `delayFiredAt` fields on order items |
| `src/hooks/useOrderPanelItems.ts` | Maps delay fields from store to panel item data |
| `src/app/api/orders/[id]/send/route.ts` | Sets `delayStartedAt` on send |
| `src/app/api/orders/[id]/fire-course/route.ts` | Manual fire API for delayed items |

## Connected Parts

- **Quick Pick (Skill 230)**: DLY preset buttons in gutter strip
- **Hold & Fire (Skill 13)**: Mutually exclusive with delays
- **Course Firing (Skill 12)**: Course-level delays via CourseDelayControls
- **Send to Kitchen (Skill 7)**: Delay timer starts on send
- **KDS**: Delayed items appear on KDS only after timer fires

## Order Store Fields

```typescript
// On each OrderItem:
delayMinutes?: number      // Preset (5, 10) or custom value via number pad
delayStartedAt?: string    // ISO timestamp when Send was pressed
delayFiredAt?: string      // ISO timestamp when fired (auto or manual)
```

## Bug Fixes

### Feb 10, 2026: Countdown Timers Disappearing After Send

**Symptom:** After pressing Send on an order with both immediate and delayed items, countdown timers appeared for a split second then vanished. Items reverted to "starts on Send".

**Root Cause:** In `send/route.ts`, the delayed items filter had a `(!filterItemIds)` guard. When client sent `itemIds` for immediate items only (correct behavior for mixed orders), `filterItemIds` was set, causing `delayedItems = []`. `delayStartedAt` was never written to DB. Client-side `startItemDelayTimers` set it momentarily, but `loadOrder()` overwrote the store with null values from API.

**Fix:** Removed the `(!filterItemIds)` guard so delayed items are always identified and `delayStartedAt` is always stamped in DB regardless of whether `filterItemIds` is provided.

### Feb 10, 2026: Fire Button Added to Held Items

**Change:** `handleFireItem` in `useActiveOrder.ts` now supports held items — releases hold via API first, then fires to kitchen. Fire button added inline to the HELD badge in `OrderPanelItem.tsx`.

### Feb 10, 2026: Custom Delay Number Pad

**Feature:** Added `···` button to the DLY section in QuickPickStrip. Tapping it opens a floating glassmorphism number pad (fixed position, centered on screen) where staff can type any number of minutes (up to 999). Uses the same `onSetDelay(minutes)` flow as presets. When a custom delay is active, the button displays the value (e.g., `7m`) with blue highlight. Pad dismisses on outside click or after confirming.
