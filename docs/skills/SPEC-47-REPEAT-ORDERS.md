# 47 - Repeat Orders

**Status:** Planning
**Priority:** High
**Dependencies:** 04-Order-Management, 03-Menu-Programming

---

## Overview

The Repeat Orders skill provides quick reordering functionality - repeat last item, repeat last round, repeat selected items, and quick-add common combinations. Essential for bar service where "another round" is a frequent request. Maximizes speed and minimizes taps.

**Primary Goal:** One-tap reordering for maximum speed in high-volume environments.

---

## User Stories

### As a Bartender...
- I want to repeat a customer's last drink instantly
- I want to repeat a full round for the group
- I want to repeat with modifications
- I want keyboard shortcuts for repeat

### As a Server...
- I want to repeat popular items quickly
- I want to duplicate items to multiple seats
- I want to repeat with different quantities

### As a Customer...
- I want my usual without explaining
- I want the same round again
- I want another of what I just had

---

## Features

### Repeat Last Item

#### One-Tap Repeat
- [ ] Repeat last item added
- [ ] Repeat with all modifiers
- [ ] Repeat with quantity
- [ ] Repeat to same seat

#### Quick Access
```
[+ Last Item] or Press "R" key
↓
Adds: Margarita (same modifiers as last one)
```

### Repeat Round

#### Round Repeat
- [ ] Identify "round" (items added together)
- [ ] Repeat all items in round
- [ ] Adjust individual items
- [ ] Skip selected items

#### Round Detection
```yaml
round_detection:
  # Group items as "round" if:
  time_window_seconds: 60  # Added within 60 seconds
  same_category: true       # Same drink category
  minimum_items: 2          # At least 2 items
```

#### Round Repeat Flow
```
Tab: Mike's Group
─────────────────────
Round 1 (7:30 PM):
  Bud Light x3
  IPA x2
  Margarita x1

[Repeat Round] → Adds all 6 items again
```

### Repeat Selected Items

#### Selection Repeat
- [ ] Select items to repeat
- [ ] Multi-select support
- [ ] Adjust quantities
- [ ] Modify before adding

### Repeat with Modifications

#### Modify and Repeat
- [ ] Repeat then modify
- [ ] Change quantity
- [ ] Add/remove modifiers
- [ ] Change size/variant

### Seat-Based Repeat

#### Per-Seat Repeat
- [ ] Repeat items for specific seat
- [ ] "Another for seat 3"
- [ ] Repeat to different seat

### Quick Combos (Pre-defined Repeats)

#### Saved Combinations
- [ ] Save frequent orders
- [ ] One-tap add multiple items
- [ ] Customer favorites
- [ ] Bartender presets

### Keyboard Shortcuts

#### Speed Keys
```yaml
shortcuts:
  repeat_last: "R"
  repeat_round: "Shift+R"
  repeat_selected: "Ctrl+R"
  quick_combo_1: "F1"
  quick_combo_2: "F2"
  # ... etc
```

---

## UI/UX Specifications

### Order Screen with Repeat

```
+------------------------------------------------------------------+
| ORDER - Bar Tab: Mike's Group                    Total: $48.00    |
+------------------------------------------------------------------+
| QUICK ACTIONS                                                     |
| [+ Last: IPA] [Repeat Round (6)] [Repeat Selected]               |
+------------------------------------------------------------------+
|                                                                   |
| CURRENT ORDER                                                     |
| +--------------------------------------------------------------+ |
| | □ Bud Light Draft                                      $5.00  | |
| | □ Bud Light Draft                                      $5.00  | |
| | □ Bud Light Draft                                      $5.00  | |
| | ■ Local IPA Draft                                      $7.00  | |
| | □ Local IPA Draft                                      $7.00  | |
| | □ House Margarita                                     $12.00  | |
| |                                                                | |
| | ─── Round 1 @ 7:30 PM ────────────────────────────────────    | |
| +--------------------------------------------------------------+ |
|                                                                   |
| MENU                                                              |
| [Beer] [Cocktails] [Shots] [Wine] [NA]                          |
|                                                                   |
+------------------------------------------------------------------+
| [Repeat Last: IPA $7]     [Repeat Round: $41]     [Pay]          |
+------------------------------------------------------------------+
```

### Repeat Round Confirmation

```
+------------------------------------------------------------------+
| REPEAT ROUND                                                      |
+------------------------------------------------------------------+
|                                                                   |
| Repeating Round from 7:30 PM:                                    |
|                                                                   |
| +--------------------------------------------------------------+ |
| | Item                        | Qty | Each   | Total   | Keep  | |
| +--------------------------------------------------------------+ |
| | Bud Light Draft             | 3   | $5.00  | $15.00  | [✓]   | |
| | Local IPA Draft             | 2   | $7.00  | $14.00  | [✓]   | |
| | House Margarita             | 1   | $12.00 | $12.00  | [✓]   | |
| +--------------------------------------------------------------+ |
| | ROUND TOTAL                 | 6   |        | $41.00  |       | |
| +--------------------------------------------------------------+ |
|                                                                   |
| Uncheck items to skip. Adjust quantities if needed.              |
|                                                                   |
| Quick Adjust: [-1 Bud] [+1 IPA] [Skip Marg]                     |
|                                                                   |
| [Cancel]                              [Add Round to Order]        |
+------------------------------------------------------------------+
```

### Quick Access Bar

```
+------------------------------------------------------------------+
| REPEAT QUICK ACCESS                                               |
+------------------------------------------------------------------+
|                                                                   |
| RECENT ITEMS (Tap to repeat)                                     |
| +----------+ +----------+ +----------+ +----------+               |
| |   IPA    | |Bud Light | |Margarita | |Well Vodka|               |
| |   $7.00  | |   $5.00  | |  $12.00  | |   $8.00  |               |
| | [Repeat] | | [Repeat] | | [Repeat] | | [Repeat] |               |
| +----------+ +----------+ +----------+ +----------+               |
|                                                                   |
| LAST ROUND                                                        |
| 3x Bud Light + 2x IPA + 1x Margarita = $41.00                   |
| [Repeat Entire Round]                                            |
|                                                                   |
| SAVED COMBOS                                                      |
| +------------------+ +------------------+ +------------------+    |
| | Beer & Shot      | | Happy Hour Wells | | Pitcher + Glasses|    |
| | Bud + Fireball   | | 4x Well Drinks   | | Pitcher + 4 Mugs |    |
| | $11.00           | | $24.00           | | $18.00           |    |
| +------------------+ +------------------+ +------------------+    |
|                                                                   |
+------------------------------------------------------------------+
```

### Repeat with Modification

```
+------------------------------------------------------------------+
| REPEAT WITH CHANGES                                               |
+------------------------------------------------------------------+
|                                                                   |
| Original: House Margarita                                        |
|           Rocks, No Salt                                         |
|                                                                   |
| MAKE CHANGES:                                                     |
|                                                                   |
| Quantity: [1] [2] [3] [4] [5] [__]                               |
|                                                                   |
| Size:                                                             |
| (•) Regular $12.00                                               |
| ( ) Large $16.00                                                 |
|                                                                   |
| Style:                                                            |
| (•) Rocks                                                        |
| ( ) Frozen                                                       |
|                                                                   |
| Rim:                                                              |
| (•) No Salt                                                      |
| ( ) Salted                                                       |
| ( ) Sugar                                                        |
|                                                                   |
| [Cancel]  [Add As-Is: $12.00]  [Add Modified: $12.00]           |
+------------------------------------------------------------------+
```

---

## Data Model

### Recent Items Cache
```sql
-- In-memory or session storage, not permanent
recent_items_cache {
  session_id: UUID
  employee_id: UUID
  order_id: UUID

  items: JSONB
  /*
  [
    {
      "menu_item_id": "...",
      "name": "Local IPA",
      "modifiers": [...],
      "price": 7.00,
      "added_at": "2026-01-27T19:30:15Z",
      "round_id": "round_1"
    },
    ...
  ]
  */

  last_round_id: VARCHAR(50)
  updated_at: TIMESTAMP
}
```

### Saved Combos
```sql
saved_combos {
  id: UUID PRIMARY KEY
  location_id: UUID (FK)

  name: VARCHAR(100)
  description: TEXT (nullable)

  -- Items
  items: JSONB
  /*
  [
    {
      "menu_item_id": "...",
      "quantity": 1,
      "modifiers": [...]
    },
    ...
  ]
  */

  -- Display
  total_price: DECIMAL(10,2) -- Calculated
  display_order: INTEGER
  icon: VARCHAR(50) (nullable)

  -- Ownership
  created_by: UUID (FK)
  is_personal: BOOLEAN DEFAULT false -- Personal or shared
  for_role_id: UUID (FK, nullable)

  is_active: BOOLEAN DEFAULT true

  created_at: TIMESTAMP
  updated_at: TIMESTAMP
}
```

### Repeat Settings
```sql
repeat_settings {
  location_id: UUID PRIMARY KEY (FK)

  -- Round detection
  round_time_window_seconds: INTEGER DEFAULT 60
  round_minimum_items: INTEGER DEFAULT 2

  -- Display
  show_repeat_button: BOOLEAN DEFAULT true
  show_last_item_button: BOOLEAN DEFAULT true
  show_round_button: BOOLEAN DEFAULT true

  -- Shortcuts
  shortcuts_enabled: BOOLEAN DEFAULT true

  updated_at: TIMESTAMP
}
```

---

## API Endpoints

### Repeat Actions
```
POST   /api/orders/{id}/repeat-last
POST   /api/orders/{id}/repeat-item/{item_id}
POST   /api/orders/{id}/repeat-round/{round_id}
POST   /api/orders/{id}/repeat-selected
```

### Recent Items
```
GET    /api/orders/{id}/recent-items
GET    /api/orders/{id}/rounds
```

### Saved Combos
```
GET    /api/saved-combos
POST   /api/saved-combos
PUT    /api/saved-combos/{id}
DELETE /api/saved-combos/{id}
POST   /api/orders/{id}/add-combo/{combo_id}
```

---

## Business Rules

1. **Modifier Preservation:** Repeats include all original modifiers
2. **Price Update:** Use current prices (may differ from original)
3. **Availability Check:** Verify item still available before repeat
4. **Round Grouping:** Items within time window grouped as round
5. **Seat Preservation:** Repeat to same seat by default
6. **86'd Items:** Alert if repeated item is now unavailable

---

## Permissions

| Action | Server | Bartender | Manager |
|--------|--------|-----------|---------|
| Repeat items | Yes | Yes | Yes |
| Repeat rounds | Yes | Yes | Yes |
| Create personal combos | Yes | Yes | Yes |
| Create shared combos | No | No | Yes |
| Edit shared combos | No | No | Yes |

---

## Configuration Options

```yaml
repeat_orders:
  enabled: true

  round_detection:
    time_window_seconds: 60
    minimum_items: 2
    same_category_only: false

  display:
    show_repeat_last_button: true
    show_repeat_round_button: true
    show_recent_items: true
    recent_items_count: 5

  shortcuts:
    enabled: true
    repeat_last: "R"
    repeat_round: "Shift+R"

  combos:
    allow_personal: true
    allow_shared: true
    max_items_per_combo: 10

  behavior:
    confirm_round_repeat: true
    allow_modification: true
    preserve_seat: true
```

---

## Speed Optimizations

### One-Tap Flow
```
Tap "Repeat Last" → Item added (no confirmation)
Tap "Repeat Round" → Optional confirmation → Items added
```

### Keyboard Flow
```
Press "R" → Last item repeated instantly
Press "Shift+R" → Round repeat dialog
Press "F1-F10" → Quick combo added
```

### Touch Optimizations
- Large tap targets
- Gesture support (swipe to repeat)
- Haptic feedback
- Visual confirmation

---

*Last Updated: January 27, 2026*
