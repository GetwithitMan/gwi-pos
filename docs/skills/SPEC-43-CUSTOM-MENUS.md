# 43 - Custom Menus / Personal Layouts

**Status:** Planning
**Priority:** Medium
**Dependencies:** 03-Menu-Programming, 05-Employees-Roles, 02-Operator-Experience

---

## Overview

The Custom Menus skill allows individual employees to personalize their POS screen layout - rearranging categories, creating fast-access buttons, pinning frequent items, and customizing their workflow. Each bartender or server can optimize their screen for speed.

**Primary Goal:** Maximize order entry speed by letting staff customize their interface to match their personal workflow and most-used items.

---

## User Stories

### As a Bartender...
- I want my most-poured drinks at the top
- I want quick buttons for common orders
- I want to arrange categories my way
- I want my layout to follow me to any terminal

### As a Server...
- I want fast access to my section's popular items
- I want custom quick-order buttons
- I want to hide items I never use
- I want my preferences saved

### As a Manager...
- I want to create suggested layouts
- I want to set default layouts for new staff
- I want to see what customizations staff make
- I want to share layouts between similar roles

---

## Features

### Personal Menu Layout

#### Customization Options
- [ ] Reorder categories
- [ ] Reorder items within categories
- [ ] Pin items to top/quick access
- [ ] Hide unused items
- [ ] Create custom quick buttons
- [ ] Color coding
- [ ] Size adjustments

#### Layout Sync
- [ ] Layout tied to employee profile
- [ ] Auto-loads on login
- [ ] Syncs across terminals
- [ ] Backup/restore layouts

### Quick Access Bar

#### Fast Bar
- [ ] Customizable quick buttons
- [ ] One-tap item ordering
- [ ] Custom button names
- [ ] Button grouping
- [ ] Up to 20 quick buttons

#### Fast Bar Configuration
```yaml
fast_bar:
  employee_id: "emp_123"
  buttons:
    - position: 1
      type: "item"
      item_id: "item_456"
      label: "House Marg"
      color: "#4CAF50"

    - position: 2
      type: "item"
      item_id: "item_789"
      label: "Draft IPA"
      color: "#2196F3"

    - position: 3
      type: "combo"
      name: "Beer & Shot"
      items:
        - item_id: "item_111"
        - item_id: "item_222"

    - position: 4
      type: "category"
      category_id: "cat_333"
      label: "Shots"
```

### Category Customization

#### Arrange Categories
- [ ] Drag and drop reorder
- [ ] Hide categories
- [ ] Create personal categories
- [ ] Category colors
- [ ] Category icons

#### Item Arrangement
- [ ] Reorder items in categories
- [ ] Pin items to top
- [ ] Star favorite items
- [ ] Hide rarely used items

### Quick Combos

#### Personal Combos
- [ ] Create multi-item buttons
- [ ] Name custom combos
- [ ] One-tap adds multiple items
- [ ] Combo with modifiers

#### Combo Examples
```yaml
quick_combos:
  - name: "Bud & Jack"
    items:
      - item: "Bud Light Draft"
        quantity: 1
      - item: "Jack Daniels Shot"
        quantity: 1

  - name: "Happy Hour Well"
    items:
      - item: "Well Vodka"
        modifiers: ["Soda", "Lime"]
```

### Layout Templates

#### Template Types
- [ ] System default
- [ ] Role-based defaults
- [ ] Manager-created templates
- [ ] Shared between staff

#### Template Sharing
- [ ] Export layout
- [ ] Import layout
- [ ] Apply template to role
- [ ] Reset to default

### Visual Customization

#### Appearance Options
- [ ] Button sizes (small, medium, large)
- [ ] Grid density
- [ ] Color themes
- [ ] Font sizes
- [ ] Icon styles

---

## UI/UX Specifications

### Layout Customization Mode

```
+------------------------------------------------------------------+
| CUSTOMIZE YOUR LAYOUT                          [Save] [Cancel]    |
+------------------------------------------------------------------+
|                                                                   |
| FAST BAR (Drag items here for one-tap access)                    |
| +--------------------------------------------------------------+ |
| | [House    ] [Draft   ] [Well     ] [Beer &  ] [    +    ]    | |
| | [ Marg   ] [ IPA    ] [Vodka    ] [  Shot  ] [  Add   ]    | |
| +--------------------------------------------------------------+ |
|                                                                   |
| CATEGORIES (Drag to reorder, click eye to hide)                  |
| +------------------+ +------------------+ +------------------+    |
| | ≡ Beer     👁️ ★ | | ≡ Cocktails 👁️  | | ≡ Shots    👁️   |    |
| +------------------+ +------------------+ +------------------+    |
| +------------------+ +------------------+ +------------------+    |
| | ≡ Wine     👁️   | | ≡ Food     👁️   | | ≡ NA Drinks 👁️  |    |
| +------------------+ +------------------+ +------------------+    |
|                                                                   |
| SELECTED CATEGORY: Beer                                          |
| Drag items to reorder, star to pin to top                        |
| +--------------------------------------------------------------+ |
| | ≡ Bud Light Draft      ★ | ≡ Miller Lite Draft    ★ |       | |
| | ≡ Local IPA            ★ | ≡ Coors Light Draft      |       | |
| | ≡ Domestic Bottle        | ≡ Import Bottle           |       | |
| | ≡ Craft Can              | ≡ [+ 12 more items...]    |       | |
| +--------------------------------------------------------------+ |
|                                                                   |
| APPEARANCE                                                        |
| Button Size: [○ Small  ● Medium  ○ Large]                        |
| Grid: [○ 4x4  ● 5x5  ○ 6x6]                                     |
|                                                                   |
+------------------------------------------------------------------+
```

### Fast Bar in Use

```
+------------------------------------------------------------------+
| ORDER - Bar Tab: Mike                              Total: $24.00  |
+------------------------------------------------------------------+
| FAST BAR                                                          |
| [House   ] [Draft  ] [Well    ] [Beer & ] [Shot   ] [Open   ]    |
| [Marg $12] [IPA $7 ] [Vodka $8] [Shot$14] [Menu   ] [Food   ]    |
+------------------------------------------------------------------+
| CATEGORIES                                                        |
| [★ Beer  ] [Cocktails] [Shots  ] [Wine   ] [Food   ] [NA     ]   |
+------------------------------------------------------------------+
|                                                                   |
| BEER                                             [View All ▼]     |
| +----------+ +----------+ +----------+ +----------+               |
| |Bud Light | |Miller Lite| |Local IPA | |Coors Lt  |               |
| |Draft  $5 | |Draft  $5 | |Draft  $7 | |Draft  $5 |               |
| +----------+ +----------+ +----------+ +----------+               |
| +----------+ +----------+ +----------+ +----------+               |
| |Domestic  | |Import    | |Craft Can | |NA Beer   |               |
| |Bottle $4 | |Bottle $6 | |    $8    | |    $5    |               |
| +----------+ +----------+ +----------+ +----------+               |
|                                                                   |
+------------------------------------------------------------------+
| CURRENT ORDER                                                     |
| Draft IPA                                               $7.00    |
| House Margarita                                        $12.00    |
| Bud Light Draft                                         $5.00    |
+------------------------------------------------------------------+
```

### Template Management (Manager)

```
+------------------------------------------------------------------+
| LAYOUT TEMPLATES                                 [+ New Template]  |
+------------------------------------------------------------------+
|                                                                   |
| SYSTEM TEMPLATES                                                  |
| +--------------------------------------------------------------+ |
| | Default Layout           | All staff default                 | |
| | Bar Optimized            | For bartenders                    | |
| | Server Standard          | For servers                       | |
| +--------------------------------------------------------------+ |
|                                                                   |
| CUSTOM TEMPLATES                                                  |
| +--------------------------------------------------------------+ |
| | Sports Bar Layout        | Created by: Manager Mike          | |
| |                          | [Apply to Role] [Edit] [Delete]   | |
| | High Volume Bar          | Created by: Manager Sarah         | |
| |                          | [Apply to Role] [Edit] [Delete]   | |
| +--------------------------------------------------------------+ |
|                                                                   |
| STAFF CUSTOM LAYOUTS                                              |
| +--------------------------------------------------------------+ |
| | Sarah (Bartender)        | Modified: Today    [View] [Reset] | |
| | Mike (Bartender)         | Modified: Yesterday [View] [Reset]| |
| | Tom (Server)             | Using: Default     [No changes]   | |
| +--------------------------------------------------------------+ |
|                                                                   |
+------------------------------------------------------------------+
```

---

## Data Model

### Employee Layouts
```sql
employee_layouts {
  id: UUID PRIMARY KEY
  employee_id: UUID (FK)
  location_id: UUID (FK)

  -- Settings
  button_size: VARCHAR(20) DEFAULT 'medium'
  grid_columns: INTEGER DEFAULT 5
  theme: VARCHAR(50) DEFAULT 'default'

  -- Full layout data
  layout_data: JSONB
  /*
  {
    "fast_bar": [...],
    "category_order": [...],
    "hidden_categories": [...],
    "item_customizations": {...}
  }
  */

  -- Versioning
  version: INTEGER DEFAULT 1
  last_modified: TIMESTAMP

  created_at: TIMESTAMP
  updated_at: TIMESTAMP
}
```

### Fast Bar Buttons
```sql
fast_bar_buttons {
  id: UUID PRIMARY KEY
  layout_id: UUID (FK)
  employee_id: UUID (FK)

  position: INTEGER
  button_type: VARCHAR(50) (item, combo, category, custom)

  -- For items
  menu_item_id: UUID (FK, nullable)

  -- For combos
  combo_items: JSONB (nullable)

  -- For categories
  category_id: UUID (FK, nullable)

  -- Display
  custom_label: VARCHAR(50) (nullable)
  color: VARCHAR(7) (nullable)
  icon: VARCHAR(50) (nullable)

  is_active: BOOLEAN DEFAULT true

  created_at: TIMESTAMP
}
```

### Category Customizations
```sql
category_customizations {
  id: UUID PRIMARY KEY
  layout_id: UUID (FK)
  category_id: UUID (FK)

  custom_order: INTEGER
  is_hidden: BOOLEAN DEFAULT false
  is_favorite: BOOLEAN DEFAULT false
  custom_color: VARCHAR(7) (nullable)

  created_at: TIMESTAMP
}
```

### Item Customizations
```sql
item_customizations {
  id: UUID PRIMARY KEY
  layout_id: UUID (FK)
  menu_item_id: UUID (FK)

  -- Within category
  custom_order: INTEGER (nullable)
  is_pinned: BOOLEAN DEFAULT false
  is_hidden: BOOLEAN DEFAULT false
  is_favorite: BOOLEAN DEFAULT false

  created_at: TIMESTAMP
}
```

### Layout Templates
```sql
layout_templates {
  id: UUID PRIMARY KEY
  location_id: UUID (FK)

  name: VARCHAR(100)
  description: TEXT (nullable)

  template_type: VARCHAR(50) (system, role, custom)
  for_role_id: UUID (FK, nullable)

  layout_data: JSONB

  created_by: UUID (FK)
  is_active: BOOLEAN DEFAULT true

  created_at: TIMESTAMP
  updated_at: TIMESTAMP
}
```

---

## API Endpoints

### Layouts
```
GET    /api/employees/{id}/layout
PUT    /api/employees/{id}/layout
POST   /api/employees/{id}/layout/reset
GET    /api/employees/{id}/layout/export
POST   /api/employees/{id}/layout/import
```

### Fast Bar
```
GET    /api/employees/{id}/fast-bar
PUT    /api/employees/{id}/fast-bar
POST   /api/employees/{id}/fast-bar/buttons
PUT    /api/employees/{id}/fast-bar/buttons/{id}
DELETE /api/employees/{id}/fast-bar/buttons/{id}
```

### Templates
```
GET    /api/layout-templates
POST   /api/layout-templates
GET    /api/layout-templates/{id}
PUT    /api/layout-templates/{id}
DELETE /api/layout-templates/{id}
POST   /api/layout-templates/{id}/apply-to-role
```

### Customizations
```
PUT    /api/employees/{id}/categories/{cat_id}/customize
PUT    /api/employees/{id}/items/{item_id}/customize
```

---

## Business Rules

1. **Personal Ownership:** Each employee owns their layout
2. **Location Sync:** Layout applies at same location
3. **No Menu Access Changes:** Cannot access items not assigned to role
4. **Template Override:** Role template applies to new employees
5. **Backup on Reset:** Store previous layout before reset

---

## Permissions

| Action | Staff | Manager | Admin |
|--------|-------|---------|-------|
| Customize own layout | Yes | Yes | Yes |
| Reset own layout | Yes | Yes | Yes |
| View others' layouts | No | Yes | Yes |
| Create templates | No | Yes | Yes |
| Apply templates to roles | No | Yes | Yes |
| Reset others' layouts | No | Yes | Yes |

---

## Configuration Options

```yaml
custom_menus:
  enabled: true

  defaults:
    button_size: "medium"
    grid_columns: 5
    show_prices: true

  limits:
    max_fast_bar_buttons: 20
    max_quick_combos: 10
    max_pinned_items: 50

  templates:
    allow_sharing: true
    apply_to_new_employees: true
    default_template: "standard"

  sync:
    sync_across_terminals: true
    sync_across_locations: false
```

---

## Performance Considerations

- Layouts cached locally per terminal
- Only sync on login or explicit save
- Lazy load item customizations
- Efficient diff-based updates

---

*Last Updated: January 27, 2026*
