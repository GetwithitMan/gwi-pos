# Skill 351: Split Ticket Visibility, Navigation & Transfer Integration

**Status:** DONE
**Domain:** Orders, Floor Plan
**Created:** 2026-02-15
**Commit:** 99beac4
**Dependencies:** Skill 350 (Split Check Screen Redesign), Skill 348 (Per-Seat Color System), Skill 71 (Item Transfer)

## Summary

Extended floor plan and order management to show split ticket status and navigate between split checks. Added `SplitTicketsOverview` component, wired transfer functionality into split flow, and implemented merge-back capability. Tables with split orders now show a violet badge with split count, and the order panel displays split navigation (← →) between checks.

## Problem

After implementing the new split check screen (Skill 350), the system had no way to:
1. **Visualize split status**: Tables with split orders looked the same as regular orders
2. **Navigate splits**: No way to view/edit individual split checks after creation
3. **Merge back**: No way to recombine split checks if customer changes mind
4. **Transfer items**: Existing transfer modal was not wired into split flow
5. **Track payments**: Could not see which splits were paid vs unpaid

## Solution

### Floor Plan Visibility

Extended `/api/floorplan/snapshot` to include split order status:
- Filter includes `status: { in: ['open', 'split'] }` (was just 'open')
- Lightweight sub-select for `splitOrders` (only id, orderNumber, paidAmount, total)
- `FloorPlanTable` type extended with `status` and `splitOrders` array

### Split Badge on TableNode

Tables with split orders show a violet badge with split count:

```typescript
{table.status === 'split' && table.splitOrders && (
  <Badge variant="violet" size="sm">
    {table.splitOrders.length} splits
  </Badge>
)}
```

Uses violet (purple) to distinguish from other status colors:
- Green: paid/closed
- Blue: open order
- Yellow: needs attention
- Red: overdue
- Violet: split checks

### SplitTicketsOverview Component

New right-side panel component showing all split checks for a table. Displays:
- Table name and original order number
- Grid of split check cards (2 columns)
- Each card shows: order number, items count, total, paid amount
- "Paid" badge (green) or "Unpaid" badge (gray)
- "View" button to open that split in OrderPanel

```typescript
<div className="fixed right-0 top-16 bottom-0 w-96 bg-white border-l shadow-lg">
  <div className="p-4 border-b">
    <h2>Split Checks - Table {tableName}</h2>
    <p className="text-sm text-gray-500">
      Original Order #{orderNumber}
    </p>
  </div>

  <div className="grid grid-cols-2 gap-4 p-4">
    {splitOrders.map(split => (
      <SplitCheckCard
        key={split.id}
        orderNumber={split.orderNumber}
        total={split.total}
        paidAmount={split.paidAmount}
        itemsCount={split.items.length}
        onView={() => openSplit(split.id)}
      />
    ))}
  </div>

  <div className="p-4 border-t">
    <Button onClick={mergeSplits} variant="secondary">
      Merge All Splits
    </Button>
  </div>
</div>
```

### Split-Aware Table Tap

When user taps a table with split status:
1. Check if table has `status === 'split'`
2. If yes, open `SplitTicketsOverview` instead of regular `OrderPanel`
3. If user clicks "View" on a split card, open that split in `OrderPanel`

```typescript
function handleTableTap(table: FloorPlanTable) {
  if (table.status === 'split' && table.splitOrders) {
    // Show split overview
    setActiveSplitTable(table)
    setShowSplitOverview(true)
  } else {
    // Show regular order panel
    openOrderPanel(table.id)
  }
}
```

### Split Navigation in OrderPanel

When viewing a split order, the header shows:
- Split indicator: "Split 31-1 (1/3)"
- Previous/Next arrows: ← →
- Click arrows to navigate between splits

```typescript
{isSplit && (
  <div className="flex items-center gap-2">
    <button onClick={goToPreviousSplit} disabled={isFirstSplit}>
      <ChevronLeft />
    </button>
    <span className="text-sm font-medium">
      Split {orderNumber} ({currentIndex}/{totalSplits})
    </span>
    <button onClick={goToNextSplit} disabled={isLastSplit}>
      <ChevronRight />
    </button>
  </div>
)}
```

Navigation logic:
1. Parse order number to extract base and suffix (e.g., "31-1" → base=31, suffix=1)
2. Query for all orders with same `sourceOrderId`
3. Sort by suffix
4. Find current index in sorted array
5. Navigate to previous/next via `activeOrder.loadOrder(nextId)`

### Merge Back (Un-Split)

New `DELETE /api/orders/[id]/split-tickets` route to merge splits back to source:

**Rules:**
- Only allowed if no split orders have payments
- All split order items are moved back to source order
- Split orders are soft-deleted (`deletedAt: new Date()`)
- Source order status changed from 'split' to 'open'

```typescript
// DELETE /api/orders/[id]/split-tickets
const splitOrders = await db.order.findMany({
  where: { sourceOrderId: orderId },
  include: { payments: true }
})

// Check if any splits have payments
const hasPayments = splitOrders.some(o => o.payments.length > 0)
if (hasPayments) {
  return NextResponse.json(
    { error: 'Cannot merge splits with payments' },
    { status: 400 }
  )
}

// Move all items back to source
await db.orderItem.updateMany({
  where: { orderId: { in: splitOrders.map(o => o.id) } },
  data: { orderId: sourceOrderId }
})

// Soft delete splits
await db.order.updateMany({
  where: { id: { in: splitOrders.map(o => o.id) } },
  data: { deletedAt: new Date() }
})

// Reopen source
await db.order.update({
  where: { id: sourceOrderId },
  data: { status: 'open' }
})
```

### Transfer Integration

Wired existing `ItemTransferModal` into split flow with new sub-menu:

**Transfer Options:**
1. **Transfer Items** — Move items between splits on same table (existing modal)
2. **Transfer Table** — Move entire split to different table
3. **Transfer to Tab** — Convert split to bar tab (coming soon)

```typescript
<Menu>
  <MenuButton>Transfer ▾</MenuButton>
  <MenuItems>
    <MenuItem onClick={openItemTransferModal}>
      Transfer Items
    </MenuItem>
    <MenuItem onClick={openTableTransferModal}>
      Transfer Table
    </MenuItem>
    <MenuItem onClick={openTabTransferModal} disabled>
      Transfer to Tab (Coming Soon)
    </MenuItem>
  </MenuItems>
</Menu>
```

**Item transfer between splits:**
- User selects items from current split
- Modal shows list of other splits on same table as destinations
- Items are moved via existing `POST /api/orders/[fromId]/transfer-items`
- Socket event triggers refresh of both splits

## Key Files

### New Files

| File | Lines | Description |
|------|-------|-------------|
| `src/components/split-tickets/SplitTicketsOverview.tsx` | 187 | Right-side panel showing all splits for a table |

### Modified Files

| File | Changes |
|------|---------|
| `src/app/api/floorplan/snapshot/route.ts` | Extended to include `status: 'split'` and `splitOrders` sub-select |
| `src/hooks/use-floor-plan.ts` | Updated `FloorPlanTable` type with `status` and `splitOrders` |
| `src/components/floor-plan/TableNode.tsx` | Added violet split badge |
| `src/components/floor-plan/FloorPlanHome.tsx` | Split-aware table tap handler |
| `src/components/orders/OrderPanel.tsx` | Split navigation header (← →) |
| `src/app/(pos)/orders/page.tsx` | Wired split overview and transfer sub-menu |
| `src/app/api/orders/[id]/split-tickets/route.ts` | Added DELETE endpoint for merge-back |

## API Changes

### Extended Snapshot API

```typescript
// GET /api/floorplan/snapshot
{
  tables: [
    {
      id: "tbl_1",
      name: "Table 31",
      status: "split",  // NEW — was implicitly 'open'
      openOrder: {
        id: "ord_source",
        orderNumber: "31",
        status: "split",
        total: 12500
      },
      splitOrders: [  // NEW — lightweight sub-select
        {
          id: "ord_1",
          orderNumber: "31-1",
          paidAmount: 4200,
          total: 4200
        },
        {
          id: "ord_2",
          orderNumber: "31-2",
          paidAmount: 0,
          total: 4200
        },
        {
          id: "ord_3",
          orderNumber: "31-3",
          paidAmount: 0,
          total: 4100
        }
      ]
    }
  ]
}
```

### New DELETE Endpoint

```typescript
// DELETE /api/orders/[id]/split-tickets
// Merges all split orders back to source

Request: (no body)

Response (Success):
{
  "data": {
    "mergedCount": 3,
    "sourceOrderId": "ord_source"
  }
}

Response (Error - has payments):
{
  "error": "Cannot merge splits with payments. Pay or void all splits first."
}
```

## Data Flow

### Floor Plan Load with Splits

```
User opens floor plan
        ↓
GET /api/floorplan/snapshot
        ↓
Query includes status: { in: ['open', 'split'] }
        ↓
For split tables, sub-select splitOrders
        ↓
Map to FloorPlanTable with status + splitOrders
        ↓
TableNode shows violet badge "3 splits"
```

### Split Navigation Flow

```
User taps split table
        ↓
FloorPlanHome checks table.status === 'split'
        ↓
Show SplitTicketsOverview (not OrderPanel)
        ↓
User clicks "View" on split card
        ↓
OrderPanel opens with split order
        ↓
Header shows "Split 31-1 (1/3)" with ← →
        ↓
User clicks → arrow
        ↓
activeOrder.loadOrder(nextSplitId)
        ↓
OrderPanel re-renders with next split
```

### Merge Back Flow

```
User on SplitTicketsOverview
        ↓
User clicks "Merge All Splits"
        ↓
Confirm modal: "Merge 3 splits back to Order #31?"
        ↓
DELETE /api/orders/[sourceId]/split-tickets
        ↓
API checks: no payments on any split
        ↓
Move all items back to source order
        ↓
Soft delete all split orders
        ↓
Set source order status='open'
        ↓
Socket event: orders:list-changed
        ↓
Floor plan refreshes
        ↓
Table shows regular order panel (no splits badge)
```

### Transfer Items Between Splits

```
User on split order (e.g., 31-1)
        ↓
User clicks Transfer > Transfer Items
        ↓
ItemTransferModal opens
        ↓
User selects items to transfer
        ↓
Modal shows destination list:
  - Split 31-2
  - Split 31-3
        ↓
User selects destination (e.g., 31-2)
        ↓
POST /api/orders/31-1/transfer-items
{
  "targetOrderId": "ord_split_2",
  "itemIds": ["item_1", "item_2"]
}
        ↓
API moves items between orders
        ↓
Socket event: orders:items-transferred
        ↓
Both splits refresh via socket listener
```

## FloorPlanTable Type Extension

```typescript
interface FloorPlanTable {
  id: string
  name: string
  x: number
  y: number
  seats: FloorPlanSeat[]
  openOrder: {
    id: string
    orderNumber: string
    status: OrderStatus  // NEW
    total: number
    paidAmount: number
  } | null
  splitOrders?: Array<{  // NEW
    id: string
    orderNumber: string
    paidAmount: number
    total: number
  }>
  status?: 'open' | 'split'  // NEW
}
```

## Split Status Logic

A table has split status when:
1. It has a source order with `status: 'split'`
2. That order has 1+ child orders with `sourceOrderId` pointing to it

Floor plan query:
```typescript
const tables = await db.table.findMany({
  where: { locationId, sectionId },
  include: {
    orders: {
      where: {
        status: { in: ['open', 'split'] },
        deletedAt: null
      },
      select: {
        id: true,
        orderNumber: true,
        status: true,
        total: true,
        paidAmount: true,
        splitOrders: {  // Sub-select for splits
          where: { deletedAt: null },
          select: {
            id: true,
            orderNumber: true,
            paidAmount: true,
            total: true
          }
        }
      }
    }
  }
})
```

## Related Skills

- **Skill 350**: Split Check Screen Redesign (split creation flow)
- **Skill 348**: Per-Seat Color System (violet color for split badges)
- **Skill 71**: Item Transfer (base transfer modal and API)
- **Skill 93**: Split Ticket View (original implementation)
- **Skill 113**: FloorPlanHome Integration (floor plan as primary POS interface)

## Future Enhancements

- **Transfer to Tab**: Convert split check to bar tab
- **Split payment tracking**: Show paid/unpaid badge on floor plan table
- **Partial merge**: Merge only some splits, keep others
- **Split templates**: Save common split patterns (e.g., "2-top even split")
- **Split notes**: Add notes to individual splits (e.g., "Birthday guest")
- **Split ownership**: Track which server owns each split for tip attribution
