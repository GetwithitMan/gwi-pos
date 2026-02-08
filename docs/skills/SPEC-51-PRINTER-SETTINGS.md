# 51 - Printer Settings & Formatting

**Status:** Planning
**Priority:** High
**Dependencies:** 50-Epson-Printing, 34-Device-Management

---

## Overview

The Printer Settings skill provides comprehensive control over print output formatting - font sizes, item indentation, modifier display, line spacing, column widths, and ticket layouts. Enables venue-specific customization of receipts and kitchen tickets without code changes.

**Primary Goal:** Flexible, configurable print formatting that adapts to venue preferences and kitchen workflow needs.

---

## User Stories

### As a Manager...
- I want to adjust font sizes for readability
- I want to customize receipt layout
- I want modifiers clearly visible on kitchen tickets
- I want to preview changes before applying

### As Kitchen Staff...
- I want large, readable text on tickets
- I want modifiers indented and clear
- I want allergies to stand out
- I want consistent ticket formatting

### As an Owner...
- I want branded receipt headers
- I want to control what prints on receipts
- I want professional-looking output

---

## Features

### Font Configuration

#### Size Options
```yaml
font_sizes:
  # Scale: 1-8 (1 = normal, 2 = double, etc.)
  receipt:
    header_logo: 2
    header_text: 1
    item_name: 1
    item_price: 1
    modifier: 1
    subtotal: 1
    total: 2
    footer: 1

  kitchen_ticket:
    order_number: 4      # Very large for visibility
    table_name: 2
    item_name: 2
    item_quantity: 2
    modifier: 1
    notes: 2
    allergy: 3           # Extra large for safety
    server_name: 1
    timestamp: 1
```

#### Font Selection
```yaml
fonts:
  primary: "FONT_A"      # Standard proportional
  secondary: "FONT_B"    # Condensed

  usage:
    headers: "FONT_A"
    items: "FONT_A"
    modifiers: "FONT_B"  # Smaller/condensed
    notes: "FONT_A"
```

### Indentation Rules

#### Item & Modifier Hierarchy
```yaml
indentation:
  # Characters of indentation per level
  indent_size: 3
  indent_char: " "

  levels:
    item: 0              # No indent for items
    modifier_l1: 1       # "   → Modifier"
    modifier_l2: 2       # "      → Sub-modifier"
    modifier_l3: 3       # "         → Sub-sub"
    notes: 1             # "   * Note text"

  # Modifier prefix symbols
  prefixes:
    modifier: "→ "
    add: "+ "
    remove: "- "
    note: "* "
    allergy: "⚠️ "
```

#### Visual Example
```
1x Grilled Salmon                    $28.00
   → Gluten Free
   → Substitute: Rice
      → Brown Rice
   * Extra crispy please
   ⚠️ CELIAC - USE SEPARATE PAN

1x Caesar Salad                      $14.00
   - Croutons
   + Extra Parmesan
   → Dressing on Side
```

### Column Layout

#### Receipt Columns
```yaml
receipt_layout:
  paper_width_chars: 48    # 80mm paper

  columns:
    # Item line: "2x Burger                    $15.00"
    quantity_width: 3
    name_width: 32
    price_width: 10
    gap: 3

    # Modifier line: "   → Extra Cheese         $1.50"
    modifier_indent: 3
    modifier_name_width: 29
    modifier_price_width: 10

  alignment:
    quantity: "left"
    name: "left"
    price: "right"
```

#### Kitchen Ticket Layout
```yaml
kitchen_layout:
  paper_width_chars: 42    # Often 76mm

  sections:
    header:
      order_number: "center"
      order_type: "center"
      table_name: "center"

    items:
      quantity: "left"
      name: "left"
      full_width: true      # Items span full width

    modifiers:
      indent: 3
      full_width: true

    footer:
      server: "left"
      time: "right"
```

### Print Templates

#### Receipt Template Sections
```yaml
receipt_template:
  sections:
    header:
      enabled: true
      logo:
        enabled: true
        alignment: "center"
      business_name:
        enabled: true
        font_size: 2
        bold: true
      address:
        enabled: true
        lines: 2
      phone:
        enabled: true
      website:
        enabled: false

    order_info:
      order_number: true
      order_type: true
      server_name: true
      table_name: true
      date: true
      time: true
      guests: false

    items:
      show_quantity: true
      show_modifiers: true
      show_modifier_prices: true
      show_item_notes: true
      group_by_course: false

    totals:
      subtotal: true
      discounts: true
      tax_breakdown: true
      total:
        bold: true
        font_size: 2
      tip_line: true
      tip_suggestions: [18, 20, 25]

    payment:
      tender_type: true
      card_last_four: true
      approval_code: false

    footer:
      thank_you_message: "Thank you for dining with us!"
      return_policy: false
      social_media: false
      custom_message: ""

    barcode:
      enabled: false
      type: "CODE128"
      data: "order_number"
```

#### Kitchen Ticket Template
```yaml
kitchen_template:
  sections:
    header:
      order_number:
        font_size: 4
        bold: true
        alignment: "center"
      order_type:
        font_size: 2
        bold: true
      table_name:
        font_size: 2
        bold: false
      guest_count:
        enabled: true
      time_ordered:
        enabled: true

    course_dividers:
      enabled: true
      style: "===== COURSE 2 ====="

    items:
      quantity:
        font_size: 2
        bold: true
      name:
        font_size: 2
        bold: true
      modifiers:
        font_size: 1
        indent: 3
        prefix: "→ "
      notes:
        font_size: 2
        bold: true
        box: true          # Draw box around notes
      allergy:
        font_size: 3
        bold: true
        box: true
        invert: false      # White on black

    item_spacing:
      between_items: 1     # Blank lines
      between_modifiers: 0
      after_notes: 1

    footer:
      server_name: true
      sent_time: true
      seat_numbers: false

    cut:
      partial: false       # Full cut
      feed_lines: 4
```

### Special Formatting

#### Allergy Highlighting
```yaml
allergy_formatting:
  enabled: true

  display_options:
    font_size: 3
    bold: true
    underline: false
    invert: false          # Black on white (or inverted)

  box:
    enabled: true
    style: "double"        # single, double, heavy
    padding: 1

  prefix: "⚠️ ALLERGY: "
  uppercase: true

  # Example output:
  # ╔═══════════════════════════════╗
  # ║ ⚠️ ALLERGY: GLUTEN            ║
  # ║ Celiac - use separate pan     ║
  # ╚═══════════════════════════════╝
```

#### Order Notes
```yaml
note_formatting:
  item_notes:
    font_size: 1
    bold: true
    prefix: "* "
    box: false

  order_notes:
    font_size: 2
    bold: true
    box: true
    box_style: "single"
    header: "*** ORDER NOTE ***"
```

#### Void/Comp Indicators
```yaml
special_indicators:
  voided_items:
    strikethrough: true    # If printer supports
    prefix: "[VOID] "

  comped_items:
    prefix: "[COMP] "
    show_original_price: true

  rush_orders:
    prefix: "🔥 RUSH 🔥"
    font_size: 2
    bold: true
```

---

## UI/UX Specifications

### Print Settings Dashboard

```
+------------------------------------------------------------------+
| PRINTER SETTINGS                                                   |
+------------------------------------------------------------------+
|                                                                   |
| [Receipt Settings]  [Kitchen Tickets]  [Bar Tickets]  [Reports]  |
|                                                                   |
+------------------------------------------------------------------+
|                                                                   |
| RECEIPT SETTINGS                                                   |
|                                                                   |
| HEADER                                              [Preview ▼]   |
| +--------------------------------------------------------------+ |
| | Business Name   [GWI Restaurant________________]              | |
| | Font Size       [2 - Double___▼]                              | |
| | Bold            [✓]                                           | |
| |                                                                | |
| | Show Logo       [✓]    [Upload Logo]                          | |
| | Address Line 1  [123 Main Street______________]               | |
| | Address Line 2  [City, State 12345____________]               | |
| | Phone           [(555) 123-4567_______________]               | |
| +--------------------------------------------------------------+ |
|                                                                   |
| ITEMS                                                              |
| +--------------------------------------------------------------+ |
| | Item Name Size    [1 - Normal___▼]                            | |
| | Show Quantity     [✓]                                         | |
| | Show Modifiers    [✓]                                         | |
| | Modifier Indent   [3 spaces_____▼]                            | |
| | Modifier Prefix   [→ ___________▼]                            | |
| | Show Mod Prices   [✓]                                         | |
| +--------------------------------------------------------------+ |
|                                                                   |
| TOTALS                                                             |
| +--------------------------------------------------------------+ |
| | Total Font Size   [2 - Double___▼]                            | |
| | Total Bold        [✓]                                         | |
| | Show Tax Breakdown [✓]                                        | |
| | Tip Suggestions   [18%, 20%, 25%__]                           | |
| +--------------------------------------------------------------+ |
|                                                                   |
| [Reset to Default]                    [Save Settings]             |
+------------------------------------------------------------------+
```

### Kitchen Ticket Settings

```
+------------------------------------------------------------------+
| KITCHEN TICKET SETTINGS                                           |
+------------------------------------------------------------------+
|                                                                   |
| ORDER HEADER                                                       |
| +--------------------------------------------------------------+ |
| | Order # Size      [4 - Quad_____▼]  Very large for visibility | |
| | Order # Bold      [✓]                                         | |
| | Table Name Size   [2 - Double___▼]                            | |
| | Show Order Type   [✓]                                         | |
| | Show Guest Count  [✓]                                         | |
| +--------------------------------------------------------------+ |
|                                                                   |
| ITEMS                                                              |
| +--------------------------------------------------------------+ |
| | Quantity Size     [2 - Double___▼]                            | |
| | Quantity Bold     [✓]                                         | |
| | Item Name Size    [2 - Double___▼]                            | |
| | Item Name Bold    [✓]                                         | |
| +--------------------------------------------------------------+ |
|                                                                   |
| MODIFIERS                                                          |
| +--------------------------------------------------------------+ |
| | Modifier Size     [1 - Normal___▼]                            | |
| | Indent Spaces     [3__]                                       | |
| | Prefix            [→ ___________▼]                            | |
| |                                                                | |
| | Modifier Prefixes:                                             | |
| | Standard          [→ ]                                        | |
| | Add               [+ ]                                        | |
| | Remove            [- ]                                        | |
| | No/Without        [NO ]                                       | |
| +--------------------------------------------------------------+ |
|                                                                   |
| SPECIAL NOTES                                                      |
| +--------------------------------------------------------------+ |
| | Note Font Size    [2 - Double___▼]                            | |
| | Note Bold         [✓]                                         | |
| | Draw Box Around   [✓]                                         | |
| | Box Style         [Single Line__▼]                            | |
| +--------------------------------------------------------------+ |
|                                                                   |
| ALLERGY ALERTS                                                     |
| +--------------------------------------------------------------+ |
| | Allergy Font Size [3 - Triple___▼]                            | |
| | Allergy Bold      [✓]                                         | |
| | Draw Box          [✓]                                         | |
| | Box Style         [Double Line_▼]                             | |
| | Prefix            [⚠️ ALLERGY: __]                            | |
| | UPPERCASE         [✓]                                         | |
| +--------------------------------------------------------------+ |
|                                                                   |
| SPACING                                                            |
| +--------------------------------------------------------------+ |
| | Lines Between Items     [1__]                                 | |
| | Lines After Notes       [1__]                                 | |
| | Feed Lines Before Cut   [4__]                                 | |
| +--------------------------------------------------------------+ |
|                                                                   |
| [Reset to Default]  [Test Print]              [Save Settings]     |
+------------------------------------------------------------------+
```

### Live Preview

```
+------------------------------------------------------------------+
| PREVIEW                                                           |
+------------------------------------------------------------------+
|                                                                   |
| +------------------------------------------+                     |
| |          GWI RESTAURANT                   |                     |
| |          123 Main Street                  |                     |
| |          City, State 12345                |                     |
| |          (555) 123-4567                   |                     |
| |                                           |                     |
| | ----------------------------------------- |                     |
| | Order: #1247          Table: 12           |                     |
| | Server: Sarah         1/27/26 7:30 PM     |                     |
| | ----------------------------------------- |                     |
| |                                           |                     |
| | 1x Grilled Salmon              $28.00     |                     |
| |    → Gluten Free                          |                     |
| |    → Substitute: Rice                     |                     |
| |    ┌─────────────────────────────────┐   |                     |
| |    │ * Extra crispy on the rice     │   |                     |
| |    └─────────────────────────────────┘   |                     |
| |                                           |                     |
| | 1x Caesar Salad                $14.00     |                     |
| |    - Croutons                             |                     |
| |    → Dressing on Side                     |                     |
| |                                           |                     |
| | ----------------------------------------- |                     |
| | Subtotal                       $42.00     |                     |
| | Tax                             $3.36     |                     |
| | ----------------------------------------- |                     |
| | TOTAL                          $45.36     |                     |
| |                                           |                     |
| | Suggested Tips:                           |                     |
| | 18%: $8.16  20%: $9.07  25%: $11.34      |                     |
| |                                           |                     |
| | Tip: $________                            |                     |
| | Total: $________                          |                     |
| |                                           |                     |
| | Thank you for dining with us!             |                     |
| +------------------------------------------+                     |
|                                                                   |
| [< Prev Example]                        [Next Example >]          |
|                                                                   |
+------------------------------------------------------------------+
```

### Modifier Display Options

```
+------------------------------------------------------------------+
| MODIFIER DISPLAY OPTIONS                                          |
+------------------------------------------------------------------+
|                                                                   |
| DISPLAY STYLE                                                      |
| ( ) Inline with item: "Burger (No Onion, Extra Cheese)"          |
| (•) Separate lines with indent:                                   |
|     "Burger                                                       |
|        → No Onion                                                 |
|        → Extra Cheese"                                            |
|                                                                   |
| PRE-MODIFIER DISPLAY                                               |
| +--------------------------------------------------------------+ |
| | Example: "Lite Mayo, Extra Pickles, No Onion"                 | |
| |                                                                | |
| | (•) Show prefix: "LITE Mayo, EXTRA Pickles, NO Onion"         | |
| | ( ) Combine: "L-Mayo, X-Pickles, NO-Onion"                    | |
| | ( ) Symbols: "↓Mayo, ↑Pickles, ✗Onion"                        | |
| +--------------------------------------------------------------+ |
|                                                                   |
| NESTED MODIFIER DISPLAY                                            |
| +--------------------------------------------------------------+ |
| | Example: Steak → Temperature → Medium Rare                     | |
| |                                                                | |
| | ( ) Flat: All modifiers same indent level                      | |
| | (•) Hierarchical: Nested modifiers indented further            | |
| |     "→ Temperature                                             | |
| |        → Medium Rare"                                          | |
| | ( ) Collapsed: Only show final selection                       | |
| |     "→ Medium Rare"                                            | |
| +--------------------------------------------------------------+ |
|                                                                   |
| PRICING DISPLAY                                                    |
| +--------------------------------------------------------------+ |
| | (•) Show modifier prices:    "→ Extra Cheese      $1.50"      | |
| | ( ) Hide modifier prices:    "→ Extra Cheese"                  | |
| | ( ) Show only upcharges:     "→ Extra Cheese     +$1.50"      | |
| +--------------------------------------------------------------+ |
|                                                                   |
+------------------------------------------------------------------+
```

---

## Data Model

### Print Settings
```sql
print_settings {
  id: UUID PRIMARY KEY
  location_id: UUID (FK)

  -- Template type
  template_type: VARCHAR(50) (receipt, kitchen, bar, report)
  name: VARCHAR(100)

  -- Settings JSON
  settings: JSONB
  /*
  {
    "header": {
      "business_name": "GWI Restaurant",
      "font_size": 2,
      "bold": true,
      ...
    },
    "items": {...},
    "modifiers": {...},
    "totals": {...},
    "footer": {...}
  }
  */

  is_default: BOOLEAN DEFAULT false
  is_active: BOOLEAN DEFAULT true

  created_at: TIMESTAMP
  updated_at: TIMESTAMP
}
```

### Font Settings
```sql
font_settings {
  location_id: UUID PRIMARY KEY (FK)

  -- Receipt fonts
  receipt_header_size: INTEGER DEFAULT 2
  receipt_item_size: INTEGER DEFAULT 1
  receipt_total_size: INTEGER DEFAULT 2

  -- Kitchen fonts
  kitchen_order_size: INTEGER DEFAULT 4
  kitchen_item_size: INTEGER DEFAULT 2
  kitchen_modifier_size: INTEGER DEFAULT 1
  kitchen_note_size: INTEGER DEFAULT 2
  kitchen_allergy_size: INTEGER DEFAULT 3

  updated_at: TIMESTAMP
}
```

### Modifier Display Settings
```sql
modifier_display_settings {
  location_id: UUID PRIMARY KEY (FK)

  -- Display style
  display_style: VARCHAR(50) DEFAULT 'separate' (inline, separate)
  indent_spaces: INTEGER DEFAULT 3

  -- Prefixes
  standard_prefix: VARCHAR(10) DEFAULT '→ '
  add_prefix: VARCHAR(10) DEFAULT '+ '
  remove_prefix: VARCHAR(10) DEFAULT '- '
  note_prefix: VARCHAR(10) DEFAULT '* '

  -- Pre-modifiers
  premod_style: VARCHAR(50) DEFAULT 'prefix' (prefix, combine, symbols)

  -- Nested
  nested_style: VARCHAR(50) DEFAULT 'hierarchical' (flat, hierarchical, collapsed)

  -- Pricing
  show_modifier_prices: BOOLEAN DEFAULT true
  price_style: VARCHAR(50) DEFAULT 'absolute' (absolute, plus_minus, hide)

  updated_at: TIMESTAMP
}
```

### Allergy Formatting
```sql
allergy_display_settings {
  location_id: UUID PRIMARY KEY (FK)

  font_size: INTEGER DEFAULT 3
  bold: BOOLEAN DEFAULT true
  underline: BOOLEAN DEFAULT false

  draw_box: BOOLEAN DEFAULT true
  box_style: VARCHAR(20) DEFAULT 'double'

  prefix: VARCHAR(30) DEFAULT '⚠️ ALLERGY: '
  uppercase: BOOLEAN DEFAULT true

  updated_at: TIMESTAMP
}
```

---

## API Endpoints

### Settings
```
GET    /api/print-settings
GET    /api/print-settings/{type}
PUT    /api/print-settings/{type}
POST   /api/print-settings/{type}/reset

GET    /api/print-settings/fonts
PUT    /api/print-settings/fonts

GET    /api/print-settings/modifiers
PUT    /api/print-settings/modifiers

GET    /api/print-settings/allergies
PUT    /api/print-settings/allergies
```

### Preview & Test
```
POST   /api/print-settings/preview
POST   /api/print-settings/test-print
```

### Templates
```
GET    /api/print-templates
POST   /api/print-templates
PUT    /api/print-templates/{id}
DELETE /api/print-templates/{id}
POST   /api/print-templates/{id}/duplicate
```

---

## Business Rules

1. **Kitchen Readability:** Kitchen ticket fonts minimum size 2 for items
2. **Allergy Visibility:** Allergy notes always prominent, minimum size 3
3. **Consistent Formatting:** Same settings apply to all printers of type
4. **Preview Required:** Changes must be previewed before applying
5. **Test Print:** Recommend test print after settings change
6. **Template Backup:** Save previous settings when changing

---

## Permissions

| Action | Server | Manager | Admin |
|--------|--------|---------|-------|
| View settings | No | Yes | Yes |
| Modify receipt settings | No | Yes | Yes |
| Modify kitchen settings | No | Yes | Yes |
| Test print | No | Yes | Yes |
| Reset to default | No | No | Yes |
| Manage templates | No | No | Yes |

---

## Configuration Options

```yaml
print_formatting:
  defaults:
    receipt:
      paper_width: 80  # mm
      chars_per_line: 48

    kitchen:
      paper_width: 80
      chars_per_line: 42

  fonts:
    min_size: 1
    max_size: 8
    default_size: 1

  indentation:
    min_indent: 0
    max_indent: 10
    default_indent: 3

  modifiers:
    default_prefix: "→ "
    max_nesting_display: 3

  allergies:
    force_prominent: true
    min_font_size: 2
    force_box: true

  preview:
    auto_refresh: true
    sample_order: true
```

---

## Print Examples

### Receipt (Formatted)
```
        GWI RESTAURANT
        123 Main Street
       City, State 12345
        (555) 123-4567

------------------------------------------
Order: #1247              Table: 12
Server: Sarah M.      1/27/26  7:30 PM
------------------------------------------

1x Grilled Salmon                  $28.00
   → Gluten Free
   → Substitute: Rice

1x Caesar Salad                    $14.00
   - Croutons
   → Dressing on Side
   + Extra Parmesan                 $2.00

1x NY Strip - Medium               $38.00
   → Side: Mashed Potatoes

------------------------------------------
Subtotal                           $82.00
Tax (8%)                            $6.56
------------------------------------------
TOTAL                              $88.56

Suggested Tips:
18%: $15.94  20%: $17.71  25%: $22.14

Tip:    $__________
Total:  $__________

    Thank you for dining with us!
```

### Kitchen Ticket (Formatted)
```
============================================
               #1247
            TABLE SERVICE
              TABLE 12
             2 Guests
============================================

2x  GRILLED SALMON
    → Gluten Free
    → Substitute: Rice
    ┌──────────────────────────────────┐
    │ * Extra crispy on the rice       │
    └──────────────────────────────────┘
    ╔══════════════════════════════════╗
    ║ ⚠️ ALLERGY: GLUTEN               ║
    ║ CELIAC - USE SEPARATE PAN        ║
    ╚══════════════════════════════════╝

1x  CAESAR SALAD
    - Croutons
    → Dressing on Side
    + Extra Parmesan

1x  NY STRIP
    → Medium
    → Side: Mashed Potatoes

============================================
Server: Sarah M.           Sent: 7:30 PM
============================================
```

---

*Last Updated: January 27, 2026*
