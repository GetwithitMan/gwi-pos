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
> **Last Updated:** 2026-02-07

## Overview

Per-item delay presets that schedule items to fire to the kitchen after a countdown. Supports 5m/10m/15m/20m presets, live countdown timers, manual "Fire Now" override, and auto-fire when the timer reaches zero.

## How It Works

1. Select item in order panel (or via Quick Pick)
2. Tap delay preset (5m, 10m) in Quick Pick strip or course delay controls
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
| `src/components/orders/QuickPickStrip.tsx` | DLY section with 5m/10m preset buttons |
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
delayMinutes?: number      // Preset (5, 10, 15, 20)
delayStartedAt?: string    // ISO timestamp when Send was pressed
delayFiredAt?: string      // ISO timestamp when fired (auto or manual)
```
