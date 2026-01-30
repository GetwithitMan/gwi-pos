---
skill: 14
title: Order Splitting
status: DONE
depends_on: [30]
---

# Skill 14: Order Splitting (Check Splitting)

> **Status:** DONE
> **Dependencies:** Skill 30 (Payment Processing)
> **Last Updated:** 2026-01-30

## Overview

Comprehensive check splitting system for restaurants and bars. Servers can split checks in multiple ways to accommodate different payment scenarios.

## Split Types Supported

| Type | Description | Use Case |
|------|-------------|----------|
| **Split Evenly** | Divide total by N guests | "Split it 4 ways" |
| **Split by Seat** | Each seat gets own check | Table service with seat tracking |
| **Split by Item** | Move specific items to new check | "I'll pay for my items" |
| **Split Single Item** | Divide one item's cost among guests | Sharing an appetizer |
| **Custom Amount** | Pay specific dollar amount | "I'll put $50 on this card" |

## Database Schema

```prisma
model Order {
  // Split order tracking
  parentOrderId String?  // If this is a split, reference to parent
  parentOrder   Order?   @relation("OrderSplits", fields: [parentOrderId])
  splitOrders   Order[]  @relation("OrderSplits")
  splitIndex    Int?     // 1, 2, 3... for display as "31-1", "31-2"
}

model OrderItem {
  seatNumber Int?  // For split by seat functionality
}
```

## API Endpoints

### Split Order
```
POST /api/orders/[id]/split

Request Body:
{
  type: 'even' | 'by_item' | 'by_seat' | 'custom_amount' | 'get_splits',
  numWays?: number,      // For 'even'
  itemIds?: string[],    // For 'by_item'
  amount?: number,       // For 'custom_amount'
}

Responses by type:

// Even split
{
  type: 'even',
  parentOrder: { id, orderNumber, total },
  splits: [{ id, splitIndex, displayNumber, total, paidAmount, isPaid }],
  numWays: 4,
  message: "Order #31 split into 4 checks"
}

// By seat
{
  type: 'by_seat',
  parentOrder: { id, total, hasUnassignedItems },
  splits: [{ seatNumber, total, splitOrderId, displayNumber, itemCount }],
  seatCount: 3,
  message: "Order #31 split into 3 checks by seat"
}

// By item
{
  type: 'by_item',
  originalOrder: { id, newTotal, itemCount },
  newOrder: { id, splitIndex, displayNumber, total, itemCount, items }
}

// Get splits (navigation)
{
  type: 'get_splits',
  splits: [{ id, displayNumber, total, paidAmount, isPaid, isParent }],
  currentSplitId: "..."
}
```

### Merge Orders
```
POST /api/orders/[id]/merge

Request: { sourceOrderId: string, employeeId: string }

Response:
{
  success: true,
  order: { ... merged order ... },
  sourceOrderVoided: true,
  itemsMoved: 5,
  discountsMoved: 1
}
```

### Transfer Items
```
POST /api/orders/[id]/transfer-items

Request:
{
  toOrderId: string,
  itemIds: string[],
  employeeId: string
}

Response:
{
  success: true,
  transferred: { itemCount, amount, fromOrderId, toOrderId }
}

GET /api/orders/[id]/transfer-items?locationId=xxx
Returns: { orders: [...available open orders...] }
```

## UI Components

### SplitCheckModal
Main split interface with tab navigation.

**Location:** `src/components/payment/SplitCheckModal.tsx`

**Features:**
- Mode selector with icons
- Split evenly with +/- controls
- Split by seat with preview
- Split by item with checkboxes
- Split single item
- Custom amount entry
- Navigate existing splits
- Preview results before confirming

### SplitTicketManager
Full-screen ticket management for advanced splitting.

**Location:** `src/components/orders/SplitTicketManager.tsx`

**Features:**
- Multiple ticket cards
- Drag items between tickets
- Real-time total calculation
- Balance verification
- Create/delete tickets

## User Flow

```
Server taps "Split Check" button
    ↓
SplitCheckModal opens with options:
    [Evenly] [By Seat] [By Item] [Single Item] [Custom Amount]
    ↓
Server selects method and configures:
    - Evenly: Choose number of ways (2-10)
    - By Seat: Preview seats with items
    - By Item: Select items to move
    - Single Item: Select item, choose ways
    - Custom: Enter dollar amount
    ↓
Preview shows resulting checks
    ↓
Server confirms → API creates split orders
    ↓
Table now shows multiple checks (31-1, 31-2, etc.)
```

## Business Rules

1. **Parent Order**
   - Original order becomes "parent"
   - Split orders link via `parentOrderId`
   - Display number format: `{orderNumber}-{splitIndex}`

2. **Tax Handling**
   - Tax recalculated per split check
   - Uses location's default tax rate
   - Proportional distribution

3. **Discounts**
   - Stay with items on `by_item` split
   - Proportionally distributed on `even` split
   - Can be moved via merge

4. **Seat Split Requirements**
   - Requires at least 2 seats with items
   - Unassigned items stay on original check
   - Items must have `seatNumber` assigned

5. **Validation**
   - Cannot split paid/closed orders
   - Cannot move all items (at least one must remain)
   - Split amount cannot exceed remaining balance

## Files

| File | Purpose |
|------|---------|
| `src/app/api/orders/[id]/split/route.ts` | Split API (all types) |
| `src/app/api/orders/[id]/merge/route.ts` | Merge API |
| `src/app/api/orders/[id]/transfer-items/route.ts` | Item transfer API |
| `src/components/payment/SplitCheckModal.tsx` | Main split UI |
| `src/components/orders/SplitTicketManager.tsx` | Advanced ticket UI |
| `src/components/orders/SplitTicketCard.tsx` | Ticket card component |
| `src/lib/split-pricing.ts` | Split calculation utilities |
| `src/hooks/useSplitTickets.ts` | Split ticket state hook |

## Related Skills

| Skill | Relation |
|-------|----------|
| 11 | Seat Tracking - Required for split by seat |
| 15 | Order Merging - Undo splits |
| 30 | Payment Processing - Payment flow |
| 68 | Item Transfer - Move items between orders |
| 69 | Split Item Payment - Split single item cost |

## Testing Checklist

- [ ] Split evenly 2-way
- [ ] Split evenly 4-way (verify rounding)
- [ ] Split by seat (3 seats)
- [ ] Split by item (select 2 of 5 items)
- [ ] Split single item 3 ways
- [ ] Custom amount $25.00
- [ ] Navigate between split checks
- [ ] Merge split checks back together
- [ ] Move items between splits
- [ ] Cannot split paid orders
- [ ] Cannot move all items
- [ ] Tax recalculates correctly
