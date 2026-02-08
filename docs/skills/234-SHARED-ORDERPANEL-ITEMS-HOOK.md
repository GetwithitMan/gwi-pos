---
skill: 234
title: Shared OrderPanel Items Hook
status: DONE
depends_on: [233]
---

# Skill 234: Shared OrderPanel Items Hook

> **Status:** DONE
> **Domain:** Orders
> **Dependencies:** 233 (Modifier Depth Indentation)
> **Last Updated:** 2026-02-07

## Overview

`useOrderPanelItems` is a single-source-of-truth hook that maps Zustand order store items to `OrderPanelItemData[]`, replacing three duplicate item-mapping pipelines that previously existed in FloorPlanHome, BartenderView, and the orders page.

## Problem Solved

Before this hook, each view (FloorPlanHome, BartenderView, orders/page) had its own copy of the item-mapping logic (~30-50 lines each). When new fields were added (depth, preModifier, delayMinutes, status, voidReason, wasMade), each copy had to be updated independently, leading to inconsistencies and bugs.

## How It Works

1. Hook reads `currentOrder.items` from `useOrderStore`
2. Maps each item to `OrderPanelItemData` with all fields:
   - Base fields: id, name, quantity, price, specialNotes
   - Modifier fields: id, name, price, depth, preModifier, spiritTier, linkedBottleProductId, parentModifierId
   - Kitchen status: derived from `isCompleted` and `sentToKitchen`
   - Timed rental detection: checks `menuItems` param for `itemType === 'timed_rental'`
   - Delay fields: delayMinutes, delayStartedAt, delayFiredAt
   - Void/comp fields: status, voidReason, wasMade
   - Coursing: seatNumber, courseNumber, courseStatus
3. Returns memoized array (recalculates only when items or menuItems change)

## Key Files

| File | Purpose |
|------|---------|
| `src/hooks/useOrderPanelItems.ts` | The hook (69 lines) -- single mapping pipeline |
| `src/components/orders/OrderPanelItem.tsx` | Consumes `OrderPanelItemData` type for rendering |
| `src/app/(pos)/orders/page.tsx` | Uses `useOrderPanelItems()` |
| `src/components/floor-plan/FloorPlanHome.tsx` | Uses `useOrderPanelItems(menuItems)` |
| `src/components/bartender/BartenderView.tsx` | Uses `useOrderPanelItems(menuItems)` |

## Connected Parts

- **Order Store** (`src/stores/order-store.ts`): Source of truth for item data
- **OrderPanel**: Receives the mapped items for rendering
- **Modifier Depth (Skill 233)**: Depth and preModifier fields mapped here
- **Per-Item Delays (Skill 231)**: Delay fields mapped here
- **VOID/COMP Stamps (Skill 238)**: Status, voidReason, wasMade fields mapped here
- **Entertainment Sessions**: Timed rental fields (blockTimeMinutes, etc.) mapped here

## Fields Mapped

```typescript
OrderPanelItemData {
  id, name, quantity, price, menuItemId,
  modifiers: [{ id, modifierId, name, price, depth, preModifier, spiritTier, linkedBottleProductId, parentModifierId }],
  ingredientModifications, specialNotes,
  kitchenStatus, isHeld, isCompleted, sentToKitchen, resendCount, completedAt, createdAt,
  isTimedRental, blockTimeMinutes, blockTimeStartedAt, blockTimeExpiresAt,
  seatNumber, courseNumber, courseStatus,
  status, voidReason, wasMade,
  delayMinutes, delayStartedAt, delayFiredAt,
}
```
