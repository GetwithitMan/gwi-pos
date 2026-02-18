# Skill 370: Split Order Combined View

**Status:** DONE
**Domain:** Orders, Floor Plan
**Created:** 2026-02-17
**Commit:** c1155d5
**Dependencies:** Skill 352 (Single Live Split Board), Skill 351 (Split Ticket Visibility)

## Summary

When tapping a table with split orders, all child split items are now fetched from the API and merged into the parent order view. Items are tagged with `splitLabel` (e.g. "75-1", "75-2") and displayed grouped under purple headers with per-check subtotals. This gives servers a complete view of everything ordered at a table without navigating into each split individually.

## Problem

1. **No combined view**: Tapping a split table only showed the parent order (which had $0 and no items after splitting). To see what was on each check, the server had to navigate into each split individually.
2. **Split items invisible from order panel**: The order panel had no concept of split labels or grouped rendering.
3. **API response mismatch**: The split-tickets endpoint returned `{ splitOrders: [...] }` but code expected `{ data: [...] }`.
4. **Field mapping gaps**: Split ticket items used different field names (`menuItemId` vs `itemId`, `modifierId` vs other modifier fields) and lacked `sentToKitchen`/`kitchenStatus` fields.

## Solution

### Split Items Fetch & Merge

In `FloorPlanHome.tsx`, after loading a parent order with `status === 'split'`:
1. Fetch all child splits from `GET /api/orders/{parentId}/split-tickets`
2. Parse response correctly (`res.splitOrders` not `res.data`)
3. Map each child's items with `splitLabel` (e.g. "75-1" for order 75, split 1)
4. Set `sentToKitchen: true` and `kitchenStatus: 'sent'` since split items have already been sent
5. Map modifier fields: `modifierId` from the split ticket modifier data
6. Merge all mapped items into the parent order's items array

### Split Group Rendering

In `OrderPanel.tsx`:
- New `splitGroups` memo computes grouped items by `splitLabel`
- Purple "Check 75-1" / "Check 75-2" headers with subtotals
- Groups rendered in both pending and sent sections
- Items within each group maintain their original ordering

### Type Extensions

Added `splitLabel?: string` to:
- `OrderItem` in `order-store.ts`
- `LoadedOrderData` in `order-store.ts`
- `OrderPanelItemData` in `OrderPanelItem.tsx`
- `InlineOrderItem` in `FloorPlanHome.tsx`

## Files Modified

| File | Changes |
|------|---------|
| `src/stores/order-store.ts` | Added `splitLabel` to OrderItem and LoadedOrderData types |
| `src/components/floor-plan/FloorPlanHome.tsx` | Split items fetch from API, field mapping, merge into parent view, hide seats for split orders |
| `src/components/orders/OrderPanel.tsx` | `splitGroups` memo, purple group headers with subtotals, rendering in pending/sent sections |
| `src/components/orders/OrderPanelItem.tsx` | Added `splitLabel` to OrderPanelItemData type |

## API Details

**Endpoint:** `GET /api/orders/{parentId}/split-tickets`

**Response shape:**
```json
{
  "splitOrders": [
    {
      "id": "...",
      "orderNumber": 75,
      "splitIndex": 1,
      "items": [
        {
          "id": "...",
          "menuItemId": "...",
          "name": "Burger",
          "quantity": 1,
          "price": 12.99,
          "modifiers": [
            { "modifierId": "...", "name": "No Onions", "price": 0 }
          ]
        }
      ]
    }
  ]
}
```

## Key Decisions

1. **Merge into parent view** rather than showing splits separately — gives servers the "full table picture" at a glance
2. **Purple headers** to visually distinguish split groups from seat groups (which use per-seat colors)
3. **Read-only merged view** — editing individual split items still requires selecting that specific split chip
4. **Fire-and-forget fetch** — split items load after initial order load to avoid blocking the panel open
