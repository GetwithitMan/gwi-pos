# 48 - Custom Notes

**Status:** Planning
**Priority:** High
**Dependencies:** 03-Menu-Programming, 04-Order-Management

---

## Overview

The Custom Notes skill enables free-text notes at multiple levels - order notes, item notes, modifier notes, and special request tracking. Allows customers to communicate specific requests that don't fit into predefined modifiers. Notes display prominently on kitchen tickets.

**Primary Goal:** Capture and communicate special requests that fall outside standard modifiers with clear visibility in kitchen production.

---

## User Stories

### As a Server...
- I want to add special instructions to items
- I want to note allergies prominently
- I want to add order-level notes
- I want quick access to common notes

### As a Kitchen Staff...
- I want to see special requests clearly
- I want notes to stand out on tickets
- I want to know if it's an allergy
- I want modifier-specific notes visible

### As a Customer...
- I want to make special requests
- I want my allergies clearly communicated
- I want modifications not on the menu

---

## Features

### Note Levels

#### Order Notes
- [ ] Notes for entire order
- [ ] Timing requests
- [ ] Delivery instructions
- [ ] General information

#### Item Notes
- [ ] Notes for specific items
- [ ] Special preparation
- [ ] Allergy warnings
- [ ] Custom requests

#### Modifier Notes
- [ ] Notes attached to modifiers
- [ ] Specificity level
- [ ] Nested instructions

### Note Types

#### Standard Notes
- [ ] Free text entry
- [ ] Quick note templates
- [ ] Character limit
- [ ] Multi-line support

#### Allergy Notes
- [ ] Marked as allergy
- [ ] High visibility formatting
- [ ] Allergy icons
- [ ] Kitchen alert

#### Priority Notes
- [ ] Normal priority
- [ ] Important
- [ ] Critical (allergies)

### Quick Notes

#### Preset Notes
- [ ] Common requests saved
- [ ] One-tap application
- [ ] Category organized
- [ ] Customizable list

#### Quick Note Examples
```yaml
quick_notes:
  preparation:
    - "Extra crispy"
    - "Light on oil"
    - "Well done"
    - "Sauce on side"
    - "Cut in half"

  allergies:
    - "⚠️ GLUTEN ALLERGY"
    - "⚠️ NUT ALLERGY"
    - "⚠️ DAIRY ALLERGY"
    - "⚠️ SHELLFISH ALLERGY"

  timing:
    - "Rush - in a hurry"
    - "Hold until other items ready"
    - "Stagger courses"

  packaging:
    - "To-go box needed"
    - "Separate containers"
    - "Extra napkins"
```

### Note Display

#### On POS
- [ ] Note indicator on items
- [ ] Expandable note view
- [ ] Edit existing notes
- [ ] Clear note display

#### On Kitchen Ticket
```
==============================
TICKET #1247 - TABLE 12
==============================

1x Grilled Salmon
   → GLUTEN FREE
   → Substitute rice for pasta
   ┌────────────────────────┐
   │ ⚠️ CELIAC - NO GLUTEN │
   │ Use separate pan       │
   └────────────────────────┘

1x Caesar Salad
   → No croutons
   → Dressing on side
   ┌────────────────────────┐
   │ Extra parmesan please  │
   └────────────────────────┘

*** ORDER NOTE ***
Birthday dinner - dessert with candle

==============================
```

#### On Customer Display
- [ ] Show/hide notes option
- [ ] Allergy confirmation
- [ ] Custom request display

### Note Templates

#### Template Management
- [ ] Create templates
- [ ] Organize by category
- [ ] Role-specific templates
- [ ] Location templates

### Character Limits

#### Configurable Limits
```yaml
note_limits:
  order_note: 500
  item_note: 200
  modifier_note: 100
  quick_note: 50
```

---

## UI/UX Specifications

### Add Note to Item

```
+------------------------------------------------------------------+
| ADD NOTE - Grilled Salmon                                         |
+------------------------------------------------------------------+
|                                                                   |
| NOTE TYPE                                                         |
| (•) Special Request                                               |
| ( ) ⚠️ Allergy Alert                                              |
|                                                                   |
| QUICK NOTES (Tap to add)                                         |
| [Extra crispy] [Well done] [Sauce on side] [Cut in half]        |
| [Light oil] [No salt] [Spicy] [Mild]                            |
|                                                                   |
| ALLERGIES                                                         |
| [⚠️ Gluten] [⚠️ Dairy] [⚠️ Nuts] [⚠️ Shellfish] [⚠️ Other]      |
|                                                                   |
| CUSTOM NOTE                                                       |
| +--------------------------------------------------------------+ |
| | Customer is celiac - please use dedicated cookware. No        | |
| | flour, breadcrumbs, or soy sauce.                             | |
| |                                                                | |
| +--------------------------------------------------------------+ |
| 89/200 characters                                                |
|                                                                   |
| PREVIEW ON TICKET:                                               |
| ┌──────────────────────────────────────────────────────────────┐|
| │ 1x Grilled Salmon                                             ||
| │    ⚠️ ALLERGY: GLUTEN                                         ||
| │    Customer is celiac - please use dedicated cookware.        ||
| │    No flour, breadcrumbs, or soy sauce.                       ||
| └──────────────────────────────────────────────────────────────┘|
|                                                                   |
| [Cancel]                                         [Save Note]      |
+------------------------------------------------------------------+
```

### Order-Level Note

```
+------------------------------------------------------------------+
| ORDER NOTE - Table 12                                             |
+------------------------------------------------------------------+
|                                                                   |
| QUICK NOTES                                                       |
| [Birthday] [Anniversary] [Rush] [VIP] [Comp'd]                   |
|                                                                   |
| TIMING                                                            |
| [Stagger courses] [All together] [Dessert later]                |
|                                                                   |
| NOTE                                                              |
| +--------------------------------------------------------------+ |
| | Birthday dinner for Sarah. Please bring dessert with a        | |
| | candle at the end. The group knows but she doesn't!           | |
| |                                                                | |
| +--------------------------------------------------------------+ |
| 124/500 characters                                               |
|                                                                   |
| [Cancel]                                         [Save Note]      |
+------------------------------------------------------------------+
```

### Item with Note Display

```
+------------------------------------------------------------------+
| ORDER - Table 12                                   Total: $87.50  |
+------------------------------------------------------------------+
|                                                                   |
| ITEMS                                                             |
| +--------------------------------------------------------------+ |
| | Grilled Salmon                                        $28.00  | |
| |   Substitute: Rice                                            | |
| |   📝 "Customer is celiac - please use..."  ⚠️ ALLERGY        | |
| |                                          [Edit Note]          | |
| +--------------------------------------------------------------+ |
| | Caesar Salad                                          $14.00  | |
| |   No Croutons, Dressing on Side                              | |
| |   📝 "Extra parmesan please"             [Edit Note]          | |
| +--------------------------------------------------------------+ |
| | NY Strip Steak - Medium                               $38.00  | |
| |   Side: Mashed Potatoes                                       | |
| |   No notes                                [Add Note]          | |
| +--------------------------------------------------------------+ |
|                                                                   |
| ORDER NOTE: 📝 "Birthday dinner for Sarah..."  [Edit]            |
|                                                                   |
+------------------------------------------------------------------+
```

### Quick Notes Management

```
+------------------------------------------------------------------+
| QUICK NOTES MANAGEMENT                           [+ Add Note]     |
+------------------------------------------------------------------+
|                                                                   |
| PREPARATION                                                       |
| +--------------------------------------------------------------+ |
| | Extra crispy        | [Edit] [Delete]                        | |
| | Well done           | [Edit] [Delete]                        | |
| | Sauce on side       | [Edit] [Delete]                        | |
| | Light on oil        | [Edit] [Delete]                        | |
| | [+ Add to Preparation]                                        | |
| +--------------------------------------------------------------+ |
|                                                                   |
| ALLERGIES                                                         |
| +--------------------------------------------------------------+ |
| | ⚠️ GLUTEN ALLERGY   | System | Cannot Delete                 | |
| | ⚠️ NUT ALLERGY      | System | Cannot Delete                 | |
| | ⚠️ DAIRY ALLERGY    | System | Cannot Delete                 | |
| | ⚠️ SOY ALLERGY      | Custom | [Edit] [Delete]               | |
| | [+ Add Allergy Note]                                          | |
| +--------------------------------------------------------------+ |
|                                                                   |
| TIMING                                                            |
| +--------------------------------------------------------------+ |
| | Rush - in a hurry   | [Edit] [Delete]                        | |
| | Hold for others     | [Edit] [Delete]                        | |
| | [+ Add to Timing]                                             | |
| +--------------------------------------------------------------+ |
|                                                                   |
+------------------------------------------------------------------+
```

---

## Data Model

### Item Notes
```sql
order_item_notes {
  id: UUID PRIMARY KEY
  order_item_id: UUID (FK)
  order_id: UUID (FK)

  note_text: TEXT
  note_type: VARCHAR(50) (standard, allergy, priority)

  -- Allergy
  is_allergy: BOOLEAN DEFAULT false
  allergy_type: VARCHAR(100) (nullable)

  -- Priority
  priority: VARCHAR(20) DEFAULT 'normal' (normal, important, critical)

  -- Source
  from_quick_note_id: UUID (FK, nullable)

  created_by: UUID (FK)
  created_at: TIMESTAMP
  updated_at: TIMESTAMP
}
```

### Order Notes
```sql
order_notes {
  id: UUID PRIMARY KEY
  order_id: UUID (FK)

  note_text: TEXT
  note_type: VARCHAR(50) (general, timing, special)

  -- Visibility
  print_on_ticket: BOOLEAN DEFAULT true
  show_on_display: BOOLEAN DEFAULT false

  created_by: UUID (FK)
  created_at: TIMESTAMP
  updated_at: TIMESTAMP
}
```

### Modifier Notes
```sql
order_item_modifier_notes {
  id: UUID PRIMARY KEY
  order_item_modifier_id: UUID (FK)

  note_text: TEXT

  created_by: UUID (FK)
  created_at: TIMESTAMP
}
```

### Quick Notes
```sql
quick_notes {
  id: UUID PRIMARY KEY
  location_id: UUID (FK)

  note_text: VARCHAR(100)
  category: VARCHAR(50)

  -- Type
  is_allergy: BOOLEAN DEFAULT false
  priority: VARCHAR(20) DEFAULT 'normal'

  -- Display
  display_order: INTEGER
  icon: VARCHAR(50) (nullable)
  color: VARCHAR(7) (nullable)

  -- System
  is_system: BOOLEAN DEFAULT false

  is_active: BOOLEAN DEFAULT true

  created_at: TIMESTAMP
}
```

### Note Settings
```sql
note_settings {
  location_id: UUID PRIMARY KEY (FK)

  -- Limits
  order_note_limit: INTEGER DEFAULT 500
  item_note_limit: INTEGER DEFAULT 200
  modifier_note_limit: INTEGER DEFAULT 100

  -- Display
  highlight_allergies: BOOLEAN DEFAULT true
  allergy_color: VARCHAR(7) DEFAULT '#FF0000'
  print_notes_on_ticket: BOOLEAN DEFAULT true

  -- Alerts
  kitchen_alert_on_allergy: BOOLEAN DEFAULT true
  require_allergy_acknowledgment: BOOLEAN DEFAULT false

  updated_at: TIMESTAMP
}
```

---

## API Endpoints

### Item Notes
```
GET    /api/orders/{id}/items/{item_id}/notes
POST   /api/orders/{id}/items/{item_id}/notes
PUT    /api/order-item-notes/{id}
DELETE /api/order-item-notes/{id}
```

### Order Notes
```
GET    /api/orders/{id}/notes
POST   /api/orders/{id}/notes
PUT    /api/order-notes/{id}
DELETE /api/order-notes/{id}
```

### Quick Notes
```
GET    /api/quick-notes
POST   /api/quick-notes
PUT    /api/quick-notes/{id}
DELETE /api/quick-notes/{id}
GET    /api/quick-notes/categories
```

---

## Business Rules

1. **Allergy Visibility:** Allergy notes always print prominently
2. **Character Limits:** Enforce per-level character limits
3. **Kitchen Alerts:** Sound/visual alert for new allergy tickets
4. **Note Editing:** Notes can be edited until order sent
5. **Audit Trail:** Log note changes for accountability
6. **Template Reuse:** Quick notes save time and ensure consistency

---

## Permissions

| Action | Server | Manager | Admin |
|--------|--------|---------|-------|
| Add notes | Yes | Yes | Yes |
| Edit own notes | Yes | Yes | Yes |
| Edit others' notes | No | Yes | Yes |
| Delete notes | No | Yes | Yes |
| Manage quick notes | No | Yes | Yes |
| Configure settings | No | No | Yes |

---

## Configuration Options

```yaml
custom_notes:
  limits:
    order_note: 500
    item_note: 200
    modifier_note: 100

  display:
    highlight_allergies: true
    allergy_color: "#FF0000"
    allergy_icon: "⚠️"
    note_icon: "📝"

  printing:
    print_notes: true
    print_order_notes: true
    box_allergy_notes: true
    uppercase_allergies: true

  alerts:
    kitchen_alert_allergy: true
    require_acknowledgment: false
    flash_screen: true
    play_sound: true

  quick_notes:
    show_categories: true
    allow_custom_creation: true
    max_quick_notes: 50
```

---

## Ticket Formatting

### Standard Note
```
1x Caesar Salad
   No Croutons
   ─────────────────────
   Note: Extra parmesan
   ─────────────────────
```

### Allergy Note
```
1x Grilled Salmon
   Substitute: Rice
   ╔═══════════════════════════╗
   ║ ⚠️ ALLERGY: GLUTEN        ║
   ║ Celiac - use separate pan ║
   ╚═══════════════════════════╝
```

### Order Note
```
╔═════════════════════════════════╗
║ ORDER NOTE:                     ║
║ Birthday dinner - bring dessert ║
║ with candle at the end          ║
╚═════════════════════════════════╝
```

---

*Last Updated: January 27, 2026*
