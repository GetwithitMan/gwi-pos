# Skill 350: Split Check Screen Redesign

**Status:** DONE
**Domain:** Orders, Floor Plan
**Created:** 2026-02-15
**Commit:** 99beac4
**Dependencies:** Skill 93 (Split Ticket View), Skill 348 (Per-Seat Color System), Skill 349 (Per-Seat Check Cards)

## Summary

Complete redesign of the split check interface. Replaced the old `SplitTicketManager` component with a new `useSplitCheck` hook and `SplitCheckScreen` component. Introduced 4 split modes (By Seat, Custom, Even, Business/Pleasure), select-then-tap interaction model, and fractional item splitting for penny-exact distribution across multiple checks.

## Problem

The original split ticket interface had several limitations:
1. **Limited modes**: Only supported even split and manual item assignment
2. **No fractional splitting**: Could not split a single expensive item (e.g., $80 bottle) across 2-4 checks
3. **Complex state management**: `SplitTicketManager` was tightly coupled to parent state
4. **No seat awareness**: Did not leverage the new per-seat infrastructure from Skills 348-349
5. **Poor UX**: Drag-and-drop was cumbersome on small touch screens

## Solution

### Four Split Modes

1. **By Seat** — Auto-assigns items to checks based on seat number
2. **Custom** — Manual drag-and-drop or tap assignment of items
3. **Even** — N-way equal split with penny-exact rounding
4. **Business/Pleasure** — Category-based split (food/drinks to separate checks)

### Select-Then-Tap Interaction

Replace drag-and-drop with a simpler flow:
1. User taps an item to select it (highlighted border)
2. User taps destination check card
3. Item moves to that check

For fractional splits:
1. User taps an item to select it
2. User taps "Split Item Across 2 Checks" button
3. Amount is divided evenly with penny remainder going to first check

### Fractional Item Splitting

A single order item can be split across 2-4 checks with penny-exact distribution:
- $80 bottle split 4 ways → Check 1: $20.00, Check 2: $20.00, Check 3: $20.00, Check 4: $20.00
- $25 item split 3 ways → Check 1: $8.34, Check 2: $8.33, Check 3: $8.33

Split items are stored separately from item assignments to prevent double-counting.

### Client-Side Editing

All changes are made locally until the user clicks "Save". Then a single atomic `POST /api/orders/[id]/split-tickets` creates all split orders and updates the source order to `status: 'split'`.

## Key Files

### New Files

| File | Lines | Description |
|------|-------|-------------|
| `src/hooks/useSplitCheck.ts` | 621 | Core split check state machine and business logic |
| `src/components/split-check/SplitCheckCard.tsx` | 185 | Individual check card with items and totals |
| `src/components/split-check/SplitCheckScreen.tsx` | 342 | Full split screen with mode selector and check grid |

### Modified Files

| File | Changes |
|------|---------|
| `src/app/api/orders/[id]/split-tickets/route.ts` | Extended to accept `splitItems` array for fractional splits |
| `src/components/floor-plan/FloorPlanHome.tsx` | Wire split screen launcher |
| `src/app/(pos)/orders/page.tsx` | Wire split screen launcher |

### Deleted Files

| File | Reason |
|------|--------|
| `src/components/split-tickets/SplitTicketManager.tsx` | Replaced by SplitCheckScreen |
| `src/components/split-tickets/SplitTicketCard.tsx` | Replaced by SplitCheckCard |
| `src/hooks/useSplitTickets.ts` | Replaced by useSplitCheck |

## API Changes

### Extended Split Tickets API

The existing `POST /api/orders/[id]/split-tickets` route now accepts an optional `splitItems` array for fractional splitting:

```typescript
interface SplitTicketRequest {
  tickets: Array<{
    tableId?: string
    seatNumbers?: number[]
    items: string[]  // OrderItem IDs assigned to this check
  }>
  splitItems?: Array<{
    itemId: string
    splitAmounts: {
      [checkIndex: number]: number  // Amount in cents for each check
    }
  }>
}
```

**Example fractional split:**

```json
{
  "tickets": [
    { "tableId": "tbl_1", "items": ["item_1"] },
    { "tableId": "tbl_2", "items": ["item_2"] }
  ],
  "splitItems": [
    {
      "itemId": "item_expensive",
      "splitAmounts": {
        "0": 4000,  // $40 to Check 1
        "1": 4000   // $40 to Check 2
      }
    }
  ]
}
```

The API creates new `OrderItem` records for each fractional split with the split amount and a note indicating the split (e.g., "Split 1/2").

## useSplitCheck Hook Interface

```typescript
interface UseSplitCheckReturn {
  // State
  checks: SplitCheck[]
  mode: SplitMode
  selectedItemId: string | null
  hasUnsavedChanges: boolean

  // Actions
  setMode: (mode: SplitMode) => void
  selectItem: (itemId: string | null) => void
  moveItemToCheck: (itemId: string, checkIndex: number) => void
  splitItemAcrossChecks: (itemId: string, numChecks: number) => void
  addCheck: () => void
  removeCheck: (index: number) => void
  reset: () => void

  // Persistence
  save: () => Promise<void>
}
```

### Mode Behavior

#### By Seat Mode
Auto-creates one check per seat number. Items automatically assigned based on `seatNumber` field.

```typescript
if (mode === 'seat') {
  const seats = [...new Set(items.map(i => i.seatNumber).filter(Boolean))]
  checks = seats.map(seat => ({
    items: items.filter(i => i.seatNumber === seat)
  }))
}
```

#### Custom Mode
User manually assigns items via select-then-tap. Items start in Check 1.

#### Even Mode
Creates N checks with equal distribution. Total is divided evenly with remainder pennies distributed one per check.

```typescript
const totalCents = calculateTotal(items)
const numChecks = checks.length
const baseAmount = Math.floor(totalCents / numChecks)
const remainder = totalCents % numChecks

checks = Array.from({ length: numChecks }, (_, i) => ({
  amount: baseAmount + (i < remainder ? 1 : 0)
}))
```

#### Business/Pleasure Mode
Creates 2 checks:
- Check 1: All food and entertainment items
- Check 2: All liquor and drink items

## Component Architecture

### SplitCheckScreen

Top-level screen component with three sections:
1. **Header**: Mode selector, Add Check button, Save/Cancel buttons
2. **Items Pool**: Unassigned items (in Custom mode only)
3. **Checks Grid**: All split checks with items and totals

```typescript
<div className="flex flex-col h-full">
  {/* Header */}
  <div className="flex items-center justify-between p-4">
    <ModeSelector />
    <ActionButtons />
  </div>

  {/* Items Pool (Custom mode only) */}
  {mode === 'custom' && <UnassignedItems />}

  {/* Checks Grid */}
  <div className="grid grid-cols-2 gap-4 p-4">
    {checks.map((check, i) => (
      <SplitCheckCard key={i} checkIndex={i} />
    ))}
  </div>
</div>
```

### SplitCheckCard

Individual check card showing:
- Check number badge with color (using seat color palette from Skill 348)
- Item list with item names, modifiers, and prices
- Fractional split badges (e.g., "Split 1/2")
- Subtotal, tax, and total
- Remove button (disabled in By Seat mode)

```typescript
<div className="border rounded-lg p-4">
  <div className="flex items-center justify-between mb-4">
    <Badge color={getSeatColor(checkIndex)}>
      Check {checkIndex + 1}
    </Badge>
    {mode !== 'seat' && <RemoveButton />}
  </div>

  <div className="space-y-2">
    {items.map(item => (
      <ItemRow key={item.id} item={item} />
    ))}
  </div>

  <div className="mt-4 pt-4 border-t">
    <TotalRow label="Subtotal" amount={subtotal} />
    <TotalRow label="Tax" amount={tax} />
    <TotalRow label="Total" amount={total} bold />
  </div>
</div>
```

## Data Flow

### Split Creation Flow

```
User taps "Split Check"
        ↓
SplitCheckScreen mounts
        ↓
useSplitCheck initializes with source order
        ↓
User selects mode (e.g., "By Seat")
        ↓
Hook auto-creates checks based on seat numbers
        ↓
User reviews/adjusts assignments
        ↓
User clicks "Save"
        ↓
POST /api/orders/[orderId]/split-tickets
        ↓
API creates split orders (e.g., 31-1, 31-2, 31-3)
        ↓
Source order #31 set to status='split'
        ↓
Floor plan refreshes (table now shows "N splits")
```

### Fractional Split Calculation

```typescript
function splitItemAcrossChecks(itemId: string, numChecks: number) {
  const item = items.find(i => i.id === itemId)
  const totalCents = item.price * 100
  const baseAmount = Math.floor(totalCents / numChecks)
  const remainder = totalCents % numChecks

  const splitAmounts: Record<number, number> = {}
  for (let i = 0; i < numChecks; i++) {
    splitAmounts[i] = baseAmount + (i < remainder ? 1 : 0)
  }

  return {
    itemId,
    splitAmounts
  }
}
```

Remainder pennies are distributed to the first N checks. Example for $25 split 3 ways:
- `baseAmount` = 833 cents ($8.33)
- `remainder` = 1 cent
- Check 0: 833 + 1 = 834 cents ($8.34)
- Check 1: 833 cents ($8.33)
- Check 2: 833 cents ($8.33)

## getAssignments Fix

The `getAssignments()` helper in `useSplitCheck` must exclude fractionally-split items from the regular item assignments to prevent double-counting:

```typescript
function getAssignments() {
  const splitItemIds = new Set(splitItems.map(si => si.itemId))

  return checks.map(check => ({
    ...check,
    items: check.items.filter(itemId => !splitItemIds.has(itemId))
  }))
}
```

Without this fix, an $80 bottle split 2 ways would appear in both checks as:
- Check 1: [$80 bottle] + $40 split = $120 (wrong)
- Check 2: [$80 bottle] + $40 split = $120 (wrong)

With the fix:
- Check 1: $40 split only
- Check 2: $40 split only

## Related Skills

- **Skill 93**: Split Ticket View (original implementation)
- **Skill 348**: Per-Seat Color System (color palette for check badges)
- **Skill 349**: Per-Seat Check Cards (seat grouping foundation)
- **Skill 351**: Split Ticket Visibility & Navigation (floor plan integration, split overview panel)

## Future Enhancements

- **Drag-and-drop**: Add as alternative to select-then-tap for desktop users
- **Per-check discounts**: Apply different discounts to each split check
- **Seat reassignment**: Drag seats between checks in By Seat mode
- **Split history**: Show split change log for audit trail
- **Merge checks**: Combine 2+ split checks back together
- **Export splits**: Print or email individual checks to guests
