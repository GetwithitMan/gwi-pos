# 11 - Splitting

**Status:** Planning
**Priority:** High
**Dependencies:** 04-Order-Management

---

## Overview

The Splitting skill handles all the ways checks and payments can be divided - by guest count, by seat, by item, or custom splits. This is critical for guest satisfaction and must be extremely intuitive.

**Primary Goal:** Make splitting checks fast, flexible, and foolproof with minimal clicks.

---

## User Stories

### As a Server...
- I want to split a check evenly by number of people
- I want to split by seat so each guest pays for their items
- I want to move specific items to a separate check
- I want to split a single item across multiple checks

### As a Guest (via Server)...
- I want to pay for just my items
- I want to split the total evenly with my friends
- I want to pay a specific dollar amount
- I want to pay my portion plus tip separately

### As a Manager...
- I want to see how often checks are split
- I want to track tip accuracy on split checks
- I want to undo problematic splits

---

## Features

### Split Types

#### Split by Guest Count
- [ ] "Split X ways" - Divide total evenly
- [ ] Quick buttons: 2, 3, 4, 5, 6+ ways
- [ ] Handle uneven splits (remainder goes to one check)
- [ ] Each split becomes separate payment

#### Split by Seat
- [ ] Items tagged to seats during ordering
- [ ] One check per seat automatically
- [ ] Shared items handled (split or assign)
- [ ] Visual seat-to-check mapping

#### Split by Item
- [ ] Drag items to new checks
- [ ] Multi-select items
- [ ] Create any number of new checks
- [ ] Remaining items stay on original

#### Custom Split
- [ ] Select specific items for each person
- [ ] Name each split check
- [ ] Handle shared items with split or assign

#### Payment Split Only
- [ ] Keep single check
- [ ] Multiple payments on same check
- [ ] Track who paid what
- [ ] Different tip amounts per payment

### Shared Item Handling

#### Options for Shared Items
- [ ] **Assign to One:** Put on one person's check
- [ ] **Split Evenly:** Divide cost among all checks
- [ ] **Split Custom:** Divide by specific amounts
- [ ] **Ask Each Time:** Prompt for each shared item

#### Shared Item Examples
```
Nachos (Shared) - $12.00
├── Option 1: All on Check A
├── Option 2: $6.00 on Check A, $6.00 on Check B
├── Option 3: $4.00 each on Checks A, B, C
└── Option 4: Custom amounts
```

### Split Item Feature

#### Single Item Split
- [ ] Split one item across multiple checks
- [ ] Example: $100 bottle of wine → 4 × $25.00
- [ ] Maintains item integrity in reporting
- [ ] Shows as "1/4 Bottle Wine" on each check

### Split Workflow

#### Quick Split (Even)
```
[Split] → [How many ways?]
       → [2] [3] [4] [5] [Custom #]
       → [Confirm] → Done
```

#### Seat Split
```
[Split] → [By Seat]
       → Review seat assignments
       → Handle shared items
       → [Confirm] → Done
```

#### Item Split
```
[Split] → [By Item]
       → Select items for Check A
       → Select items for Check B
       → Handle remaining
       → [Confirm] → Done
```

### Post-Split Management

#### After Splitting
- [ ] View all related checks
- [ ] Move items between split checks
- [ ] Merge split checks back together
- [ ] Track original check reference

#### Split Check Display
- [ ] Show "Split from #1234"
- [ ] Visual grouping of related checks
- [ ] Combined total view option

### Split and Pay

#### Pay While Splitting
- [ ] Split and immediately take payment
- [ ] One guest pays while others stay open
- [ ] Process one at a time or batch

---

## UI/UX Specifications

### Split Options Modal

```
+------------------------------------------------------------------+
| SPLIT CHECK #1234                                     [Cancel]   |
| Table 12 - 4 guests - $156.78                                    |
+------------------------------------------------------------------+
|                                                                  |
|   How would you like to split this check?                        |
|                                                                  |
|   +------------------+  +------------------+                     |
|   |   SPLIT EVENLY   |  |   BY SEAT        |                     |
|   |   Divide total   |  |   Items by guest |                     |
|   +------------------+  +------------------+                     |
|                                                                  |
|   +------------------+  +------------------+                     |
|   |   BY ITEM        |  |   PAYMENT ONLY   |                     |
|   |   Pick & choose  |  |   Multiple pays  |                     |
|   +------------------+  +------------------+                     |
|                                                                  |
+------------------------------------------------------------------+
```

### Split Evenly Interface

```
+------------------------------------------------------------------+
| SPLIT EVENLY - Check #1234                            [Cancel]   |
+------------------------------------------------------------------+
|                                                                  |
|   Total: $156.78        Split:  [  4  ] ways                     |
|                                                                  |
|   +----------+  +----------+  +----------+  +----------+         |
|   | Check A  |  | Check B  |  | Check C  |  | Check D  |         |
|   |  $39.20  |  |  $39.20  |  |  $39.19  |  |  $39.19  |         |
|   +----------+  +----------+  +----------+  +----------+         |
|                                                                  |
|   Quick: [2-way] [3-way] [4-way] [5-way] [6-way]                |
|                                                                  |
|   [Back]                                    [Split Check]        |
+------------------------------------------------------------------+
```

### Split by Item Interface

```
+------------------------------------------------------------------+
| SPLIT BY ITEM - Check #1234                           [Cancel]   |
+------------------------------------------------------------------+
| ORIGINAL CHECK           |  NEW CHECKS                           |
| (drag items right)       |                                       |
| +-----------------------+|  +-------------+  +-------------+     |
| | ☐ Ribeye      $29.99 ||  | CHECK A     |  | CHECK B     |     |
| | ☐ Salmon      $24.99 ||  | $0.00       |  | $0.00       |     |
| | ☐ Burger      $14.99 ||  |             |  |             |     |
| | ☐ Salad        $8.99 ||  | [Drop here] |  | [Drop here] |     |
| | ☐ Wine (btl)  $45.00 ||  |             |  |             |     |
| | ☐ 2x IPA      $14.00 ||  |             |  |             |     |
| | ☐ Dessert     $12.00 ||  +-------------+  +-------------+     |
| +-----------------------+|                                       |
|                          |  [+ Add Another Check]                |
| Remaining: $149.96       |                                       |
+------------------------------------------------------------------+
| [Back]                                    [Confirm Split]        |
+------------------------------------------------------------------+
```

### Split by Seat Interface

```
+------------------------------------------------------------------+
| SPLIT BY SEAT - Check #1234                           [Cancel]   |
+------------------------------------------------------------------+
| SEAT 1 - $44.98         | SEAT 2 - $52.98                       |
| +---------------------+ | +---------------------+                |
| | Ribeye      $29.99  | | | Salmon      $24.99  |                |
| | Salad        $8.99  | | | Burger      $14.99  |                |
| | IPA          $7.00  | | | IPA          $7.00  |                |
| |                     | | | Dessert      $6.00* |                |
| +---------------------+ | +---------------------+                |
|                         |                                        |
| SEAT 3 - $38.99         | SEAT 4 - $19.99                       |
| +---------------------+ | +---------------------+                |
| | Wine (1/2)  $22.50  | | | Wine (1/2)  $22.50  |*Wine split 2way|
| | IPA          $7.00  | | |                     |                |
| | Dessert      $6.00* | | | *Dessert split     |                |
| | App (1/4)    $3.49  | | | App (1/4)    $3.49  |                |
| +---------------------+ | +---------------------+                |
|                         |                                        |
| SHARED ITEMS:                                                    |
| Nachos $13.96 - [Split 4 ways ▼]                                |
+------------------------------------------------------------------+
| [Back]                                    [Create 4 Checks]      |
+------------------------------------------------------------------+
```

### Payment Split Interface

```
+------------------------------------------------------------------+
| SPLIT PAYMENT - Check #1234                           [Cancel]   |
| Total: $156.78    Remaining: $78.39                              |
+------------------------------------------------------------------+
| PAYMENTS RECEIVED                                                |
| +-------------------------------------------------------------+ |
| | Payment 1: Visa ***4521           $50.00   Tip: $10.00      | |
| | Payment 2: Cash                   $28.39   Tip: $5.00       | |
| +-------------------------------------------------------------+ |
|                                                                  |
| REMAINING: $78.39                                                |
|                                                                  |
| Add Payment:                                                     |
| +------------+  +------------+  +------------+                   |
| |    CARD    |  |    CASH    |  |  EXACT $   |                   |
| +------------+  +------------+  +------------+                   |
|                                                                  |
| Or pay specific amount: [$________] [Apply]                      |
|                                                                  |
+------------------------------------------------------------------+
| [Back]                               [Finish] (if $0 remaining)  |
+------------------------------------------------------------------+
```

---

## Data Model

### Split Check Links
```sql
check_splits {
  id: UUID PRIMARY KEY

  -- Original check
  original_order_id: UUID (FK)

  -- Split info
  split_type: VARCHAR(50) (even, seat, item, custom, payment_only)
  split_count: INTEGER

  -- When
  split_at: TIMESTAMP
  split_by: UUID (FK) -- Employee

  created_at: TIMESTAMP
}
```

### Split Check Children
```sql
check_split_children {
  id: UUID PRIMARY KEY
  split_id: UUID (FK)
  order_id: UUID (FK) -- The new child check

  child_number: INTEGER (1, 2, 3...)
  label: VARCHAR(50) (nullable) -- "Guest 1", "Sarah", etc.

  created_at: TIMESTAMP
}
```

### Split Item Tracking
```sql
split_items {
  id: UUID PRIMARY KEY
  split_id: UUID (FK)

  original_order_item_id: UUID (FK)
  target_order_id: UUID (FK)

  -- For items split by amount/portion
  split_quantity: DECIMAL(10,3) (nullable) -- 0.5 for half
  split_amount: DECIMAL(10,2) (nullable)

  created_at: TIMESTAMP
}
```

---

## API Endpoints

### Splitting
```
POST   /api/orders/{id}/split/even          -- Split evenly
POST   /api/orders/{id}/split/seat          -- Split by seat
POST   /api/orders/{id}/split/items         -- Split by items
POST   /api/orders/{id}/split/custom        -- Custom split
POST   /api/orders/{id}/split/payment       -- Payment split only
```

### Managing Splits
```
GET    /api/orders/{id}/split-group         -- Get related splits
POST   /api/orders/{id}/merge               -- Merge back together
POST   /api/orders/{id}/move-items          -- Move items between
DELETE /api/splits/{id}                     -- Undo split
```

### Preview
```
POST   /api/orders/{id}/split/preview       -- Preview split result
```

---

## Business Rules

1. **Tax Calculation:** Each split check calculates tax independently (may result in slight variance)
2. **Discount Distribution:** Discounts distribute proportionally across splits
3. **Tip Tracking:** Tips on split checks track back to original server
4. **Void on Split:** Voiding item on split check doesn't affect siblings
5. **Merge Rules:** Only checks from same original can merge
6. **Rounding:** Last check absorbs any rounding differences

---

## Permissions

| Action | Server | Manager | Admin |
|--------|--------|---------|-------|
| Split checks | Yes | Yes | Yes |
| Merge checks | Yes | Yes | Yes |
| Undo splits | No | Yes | Yes |
| Split own checks | Yes | Yes | Yes |
| Split any check | No | Yes | Yes |

---

## Configuration Options

```yaml
splitting:
  enabled: true

  types:
    even_split: true
    seat_split: true
    item_split: true
    payment_split: true

  defaults:
    default_shared_item_handling: "prompt"  # or "assign_first", "split_evenly"
    max_splits: 20

  display:
    show_split_indicator: true
    group_related_checks: true
```

---

## Open Questions

1. **Gratuity on Splits:** If auto-gratuity applied, how to handle on splits?

2. **Split Limits:** Maximum number of ways to split?

3. **Undo Depth:** How far back can splits be undone?

4. **Gift Card Splits:** Handle gift cards across split payments?

---

## Status & Progress

### Planning
- [x] Initial requirements documented
- [ ] Split workflow finalized
- [ ] Edge cases documented
- [ ] UI mockups

### Development
- [ ] Split by count
- [ ] Split by seat
- [ ] Split by item
- [ ] Payment split
- [ ] Merge functionality
- [ ] Undo capability
- [ ] UI components

---

*Last Updated: January 27, 2026*
