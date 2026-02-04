# 55 - Floor Plan Editor

**Status:** Planning
**Priority:** High
**Dependencies:** 04-Order-Management, 26-Host-Management, 34-Device-Management

---

## Overview

The Floor Plan Editor skill provides a visual drag-and-drop interface for creating and managing restaurant floor layouts. Design table arrangements, define sections, assign servers, and visualize real-time table status. Supports multiple floors, outdoor areas, and event configurations.

**Primary Goal:** Create intuitive visual floor plans that make table management, server assignment, and guest seating effortless.

---

## User Stories

### As a Manager...
- I want to design our floor layout visually
- I want to create different layouts for different days
- I want to assign sections to servers
- I want to see table status at a glance

### As a Host...
- I want to see which tables are available
- I want to seat guests by tapping tables
- I want to see estimated turn times
- I want to manage waitlist visually

### As a Server...
- I want to see my section highlighted
- I want to tap tables to open orders
- I want to see table timers
- I want to transfer tables visually

---

## Features

### Floor Plan Designer

#### Drag-and-Drop Interface
```
+------------------------------------------------------------------+
| FLOOR PLAN EDITOR                                    [Save] [Exit] |
+------------------------------------------------------------------+
| [Add Table ▼] [Add Object ▼] [Sections] [Grid: On] [Snap: On]    |
+------------------------------------------------------------------+
|                                                                   |
|  OBJECTS              |  FLOOR: Main Dining                       |
|  +-----------------+  |  +--------------------------------------+ |
|  | ○ Round 2-top   |  |  |                                      | |
|  | ○ Round 4-top   |  |  |   [1]     [2]     [3]                | |
|  | □ Square 4-top  |  |  |    ○       ○       ○                 | |
|  | ▭ Rect 6-top    |  |  |                                      | |
|  | ▭ Rect 8-top    |  |  |   [4]     [5]     [6]                | |
|  | ═ Bar Seat      |  |  |    □       □       □                 | |
|  | ▬ Booth 4       |  |  |                                      | |
|  | ▬ Booth 6       |  |  |   [7]━━━━━━━━━━━━━━━[8]              | |
|  +-----------------+  |  |       Booth          Booth            | |
|                       |  |                                      | |
|  DECORATIVE           |  |  ┌─────────────────────────────────┐ | |
|  +-----------------+  |  |  │            BAR                  │ | |
|  | ▢ Wall          |  |  |  │  [B1] [B2] [B3] [B4] [B5] [B6] │ | |
|  | ▤ Window        |  |  |  └─────────────────────────────────┘ | |
|  | ◇ Plant         |  |  |                                      | |
|  | ▣ Host Stand    |  |  |  [====== ENTRANCE ======]           | |
|  | ⊞ Kitchen Door  |  |  |                                      | |
|  +-----------------+  |  +--------------------------------------+ |
|                       |                                           |
|  SELECTED: Table 5    |  PROPERTIES                               |
|  +-----------------+  |  +---------------------------------+      |
|  | Table #: [5__]  |  |  | Name: [Table 5______________]  |      |
|  | Capacity: [4_]  |  |  | Section: [Section A____▼]     |      |
|  | Shape: Square   |  |  | Min Party: [1_]  Max: [4_]    |      |
|  | [Delete Table]  |  |  | Reservable: [✓]               |      |
|  +-----------------+  |  | Combinable: [✓] With: [4, 6]  |      |
|                       |  +---------------------------------+      |
+------------------------------------------------------------------+
```

#### Table Shapes & Sizes
```yaml
table_shapes:
  round:
    sizes: [2, 4, 6, 8, 10]
    icon: "○"

  square:
    sizes: [2, 4]
    icon: "□"

  rectangle:
    sizes: [4, 6, 8, 10, 12]
    icon: "▭"

  booth:
    sizes: [2, 4, 6]
    icon: "▬"

  bar_seat:
    sizes: [1]
    icon: "═"

  high_top:
    sizes: [2, 4]
    icon: "◎"

  community:
    sizes: [10, 12, 16, 20]
    icon: "▭▭"
```

#### Grid & Snapping
```yaml
grid_settings:
  show_grid: true
  grid_size: 24  # pixels
  snap_to_grid: true
  snap_to_objects: true
  snap_threshold: 12  # pixels

  alignment_guides:
    enabled: true
    show_on_drag: true
    color: "#4A90D9"
```

### Section Management

#### Define Sections
```
+------------------------------------------------------------------+
| SECTIONS                                                          |
+------------------------------------------------------------------+
|                                                                   |
| +--------------------------------------------------------------+ |
| | Section A (Front)                               [Edit] [Del]  | |
| | Color: 🔵 Blue                                                | |
| | Tables: 1, 2, 3, 4, 5, 6                                     | |
| | Capacity: 24 seats                                            | |
| +--------------------------------------------------------------+ |
| | Section B (Back)                                [Edit] [Del]  | |
| | Color: 🟢 Green                                               | |
| | Tables: 7, 8, 9, 10                                          | |
| | Capacity: 20 seats                                            | |
| +--------------------------------------------------------------+ |
| | Bar                                             [Edit] [Del]  | |
| | Color: 🟣 Purple                                              | |
| | Tables: B1, B2, B3, B4, B5, B6                               | |
| | Capacity: 12 seats                                            | |
| +--------------------------------------------------------------+ |
| | Patio (Seasonal)                                [Edit] [Del]  | |
| | Color: 🟡 Yellow                                              | |
| | Tables: P1, P2, P3, P4                                       | |
| | Capacity: 16 seats                                            | |
| | Status: Currently Closed                                      | |
| +--------------------------------------------------------------+ |
|                                                                   |
| [+ Add Section]                                                   |
+------------------------------------------------------------------+
```

#### Server Assignment
```
+------------------------------------------------------------------+
| SERVER ASSIGNMENTS - Tonight                                       |
+------------------------------------------------------------------+
|                                                                   |
| Drag servers to sections:                                        |
|                                                                   |
| AVAILABLE SERVERS          ASSIGNED                               |
| +------------------+       +----------------------------------+   |
| |                  |       | Section A (Front)                |   |
| | [Jessica R.]     |       | +---+ +---+ +---+ +---+ +---+   |   |
| |                  |       | | 1 | | 2 | | 3 | | 4 | | 5 |   |   |
| +------------------+       | +---+ +---+ +---+ +---+ +---+   |   |
|                            | 👤 Sarah M.                      |   |
|                            +----------------------------------+   |
|                            +----------------------------------+   |
|                            | Section B (Back)                 |   |
|                            | +---+ +---+ +---+ +---+          |   |
|                            | | 7 | | 8 | | 9 | |10 |          |   |
|                            | +---+ +---+ +---+ +---+          |   |
|                            | 👤 Mike T.                       |   |
|                            +----------------------------------+   |
|                            +----------------------------------+   |
|                            | Bar                               |   |
|                            | [B1][B2][B3][B4][B5][B6]         |   |
|                            | 👤 David K.                      |   |
|                            +----------------------------------+   |
|                                                                   |
| [Save Assignments]                     [Clear All]               |
+------------------------------------------------------------------+
```

### Live Floor View

#### Real-Time Status
```
+------------------------------------------------------------------+
| FLOOR VIEW - Main Dining                    [Edit Mode] [Refresh] |
+------------------------------------------------------------------+
|                                                                   |
|  Legend: 🟢 Open  🔵 Seated  🟡 Check Dropped  🔴 Needs Attention |
|                                                                   |
|  +--------------------------------------------------------------+|
|  |                                                               ||
|  |    [1]🟢     [2]🔵      [3]🔵                                 ||
|  |     ○       ○ 45m      ○ 12m                                 ||
|  |    Open    $87.50     $42.00                                 ||
|  |                                                               ||
|  |    [4]🔵     [5]🟡      [6]🟢                                 ||
|  |     □ 1h15m  □ 1h45m    □                                    ||
|  |    $124.00  $156.00   Open                                   ||
|  |                                                               ||
|  |   [7]━━━━━━━🔵━━━━━[8]━━━━━━━━🔴━━━━━                        ||
|  |       Booth 52m          Booth 2h10m                         ||
|  |        $98.00            $212.00 ⚠️                          ||
|  |                                                               ||
|  |  ┌─────────────────────────────────────────────────────────┐ ||
|  |  │                        BAR                               │ ||
|  |  │  [B1]🔵 [B2]🔵 [B3]🟢 [B4]🟢 [B5]🔵 [B6]🔵              │ ||
|  |  │   $24    $67   Open   Open   $45    $38                 │ ||
|  |  └─────────────────────────────────────────────────────────┘ ||
|  |                                                               ||
|  +--------------------------------------------------------------+|
|                                                                   |
|  SUMMARY: 8 Occupied | 4 Open | 2 Check Dropped | 1 Attention   |
|                                                                   |
+------------------------------------------------------------------+
```

#### Table Detail Popup
```
+----------------------------------+
|  TABLE 5                    [X]  |
+----------------------------------+
|                                  |
|  Status: 🟡 Check Dropped        |
|  Server: Sarah M.                |
|  Guests: 4                       |
|  Seated: 1h 45m ago              |
|                                  |
|  Current Check: $156.00          |
|  Avg $/Guest: $39.00             |
|                                  |
|  ─────────────────────────────  |
|                                  |
|  ACTIONS                         |
|  [Open Order]                    |
|  [Transfer Table]                |
|  [Add to Waitlist Note]          |
|  [Clear Table]                   |
|                                  |
+----------------------------------+
```

### Multiple Floors/Areas

#### Area Management
```
+------------------------------------------------------------------+
| FLOOR PLANS                                        [+ Add Floor]  |
+------------------------------------------------------------------+
|                                                                   |
| +--------------------------------------------------------------+ |
| | 📐 Main Dining                              [Edit] [Duplicate]| |
| | Tables: 15 | Capacity: 62 | Sections: 3                      | |
| | Status: Active                                                | |
| +--------------------------------------------------------------+ |
| | 📐 Bar Area                                 [Edit] [Duplicate]| |
| | Tables: 6 | Capacity: 12 | Sections: 1                       | |
| | Status: Active                                                | |
| +--------------------------------------------------------------+ |
| | 📐 Patio                                    [Edit] [Duplicate]| |
| | Tables: 8 | Capacity: 32 | Sections: 1                       | |
| | Status: Seasonal (Closed)                                     | |
| +--------------------------------------------------------------+ |
| | 📐 Private Room                             [Edit] [Duplicate]| |
| | Tables: 2 | Capacity: 24 | Sections: 1                       | |
| | Status: Reservation Only                                      | |
| +--------------------------------------------------------------+ |
| | 📐 Event Layout - Wedding                   [Edit] [Duplicate]| |
| | Tables: 20 | Capacity: 200 | Sections: 4                     | |
| | Status: Saved Layout (Not Active)                             | |
| +--------------------------------------------------------------+ |
|                                                                   |
+------------------------------------------------------------------+
```

### Table Combining

#### Combine Tables
```
+------------------------------------------------------------------+
| COMBINE TABLES                                                    |
+------------------------------------------------------------------+
|                                                                   |
|  Select tables to combine for larger parties:                    |
|                                                                   |
|  +---+  +---+  +---+                                             |
|  |[4]|--|[5]|--|[6]|  ← Click tables to link                     |
|  +---+  +---+  +---+                                             |
|                                                                   |
|  Combined Capacity: 12 guests                                    |
|  Combined Name: [Tables 4-5-6______]                             |
|                                                                   |
|  Options:                                                         |
|  [✓] Save as preset combination                                  |
|  [ ] Auto-combine when reservation requests 10+                  |
|                                                                   |
|  [Cancel]                              [Save Combination]        |
+------------------------------------------------------------------+
```

### Saved Layouts

#### Layout Presets
```yaml
saved_layouts:
  standard:
    name: "Standard Service"
    description: "Normal daily operations"
    active_areas: ["Main Dining", "Bar", "Patio"]

  brunch:
    name: "Weekend Brunch"
    description: "Rearranged for brunch flow"
    active_areas: ["Main Dining", "Bar"]
    table_changes:
      - combine: [4, 5]
      - disable: [B5, B6]

  private_event:
    name: "Private Event"
    description: "Main dining closed for event"
    active_areas: ["Bar", "Patio"]
    disabled_areas: ["Main Dining"]

  outdoor_only:
    name: "Outdoor Only"
    description: "Nice weather - patio focused"
    active_areas: ["Patio", "Bar"]
```

---

## UI/UX Specifications

### Touch Gestures
```yaml
gestures:
  tap:
    action: "Select table/object"

  double_tap:
    action: "Open table order"

  drag:
    action: "Move selected object"

  pinch:
    action: "Zoom floor plan"

  two_finger_drag:
    action: "Pan floor plan"

  long_press:
    action: "Show context menu"

  swipe_left:
    action: "Switch to next floor"
```

### Color Coding
```yaml
status_colors:
  open:
    color: "#4CAF50"  # Green
    label: "Available"

  seated:
    color: "#2196F3"  # Blue
    label: "Occupied"

  check_dropped:
    color: "#FFC107"  # Yellow
    label: "Check Dropped"

  needs_attention:
    color: "#F44336"  # Red
    label: "Needs Attention"

  reserved:
    color: "#9C27B0"  # Purple
    label: "Reserved"

  blocked:
    color: "#9E9E9E"  # Gray
    label: "Blocked/Closed"

section_colors:
  - "#2196F3"  # Blue
  - "#4CAF50"  # Green
  - "#9C27B0"  # Purple
  - "#FF9800"  # Orange
  - "#E91E63"  # Pink
  - "#00BCD4"  # Cyan
```

---

## Data Model

### Floor Plans
```sql
floor_plans {
  id: UUID PRIMARY KEY
  location_id: UUID (FK)

  name: VARCHAR(100)
  description: TEXT (nullable)
  floor_number: INTEGER DEFAULT 1

  -- Canvas
  canvas_width: INTEGER DEFAULT 1200
  canvas_height: INTEGER DEFAULT 800
  background_image: VARCHAR(500) (nullable)

  -- Status
  is_active: BOOLEAN DEFAULT true
  is_default: BOOLEAN DEFAULT false

  created_at: TIMESTAMP
  updated_at: TIMESTAMP
}
```

### Floor Plan Objects
```sql
floor_plan_objects {
  id: UUID PRIMARY KEY
  floor_plan_id: UUID (FK)

  -- Object type
  object_type: VARCHAR(50)  -- table, wall, decoration, label

  -- Position
  x: INTEGER
  y: INTEGER
  width: INTEGER
  height: INTEGER
  rotation: INTEGER DEFAULT 0

  -- Table-specific
  table_id: UUID (FK, nullable)

  -- Decoration-specific
  decoration_type: VARCHAR(50) (nullable)
  label_text: VARCHAR(100) (nullable)

  -- Display
  z_index: INTEGER DEFAULT 0

  created_at: TIMESTAMP
  updated_at: TIMESTAMP
}
```

### Tables
```sql
tables {
  id: UUID PRIMARY KEY
  location_id: UUID (FK)
  floor_plan_id: UUID (FK)
  section_id: UUID (FK, nullable)

  -- Identity
  table_number: VARCHAR(20)
  display_name: VARCHAR(50)

  -- Capacity
  shape: VARCHAR(20)
  min_capacity: INTEGER DEFAULT 1
  max_capacity: INTEGER

  -- Features
  is_reservable: BOOLEAN DEFAULT true
  is_combinable: BOOLEAN DEFAULT false
  combinable_with: UUID[]

  -- Status
  status: VARCHAR(50) DEFAULT 'open'
  is_active: BOOLEAN DEFAULT true

  created_at: TIMESTAMP
  updated_at: TIMESTAMP
}
```

### Sections
```sql
sections {
  id: UUID PRIMARY KEY
  location_id: UUID (FK)
  floor_plan_id: UUID (FK)

  name: VARCHAR(100)
  color: VARCHAR(7)

  -- Assignment
  assigned_server_id: UUID (FK, nullable)

  -- Status
  is_active: BOOLEAN DEFAULT true
  is_seasonal: BOOLEAN DEFAULT false

  display_order: INTEGER

  created_at: TIMESTAMP
  updated_at: TIMESTAMP
}
```

### Table Combinations
```sql
table_combinations {
  id: UUID PRIMARY KEY
  location_id: UUID (FK)

  name: VARCHAR(100)
  table_ids: UUID[]
  combined_capacity: INTEGER

  is_preset: BOOLEAN DEFAULT false

  -- If currently active
  is_active: BOOLEAN DEFAULT false
  activated_at: TIMESTAMP (nullable)

  created_at: TIMESTAMP
}
```

### Saved Layouts
```sql
saved_layouts {
  id: UUID PRIMARY KEY
  location_id: UUID (FK)

  name: VARCHAR(100)
  description: TEXT (nullable)

  -- Configuration
  active_floor_plans: UUID[]
  disabled_tables: UUID[]
  table_combinations: UUID[]
  section_overrides: JSONB

  -- Usage
  is_default: BOOLEAN DEFAULT false

  created_at: TIMESTAMP
  updated_at: TIMESTAMP
}
```

---

## API Endpoints

### Floor Plans
```
GET    /api/floor-plans
GET    /api/floor-plans/{id}
POST   /api/floor-plans
PUT    /api/floor-plans/{id}
DELETE /api/floor-plans/{id}
POST   /api/floor-plans/{id}/duplicate
```

### Objects
```
GET    /api/floor-plans/{id}/objects
POST   /api/floor-plans/{id}/objects
PUT    /api/floor-plan-objects/{id}
DELETE /api/floor-plan-objects/{id}
PUT    /api/floor-plan-objects/bulk  # Move multiple
```

### Tables
```
GET    /api/tables
GET    /api/tables/{id}
POST   /api/tables
PUT    /api/tables/{id}
DELETE /api/tables/{id}
GET    /api/tables/{id}/status
PUT    /api/tables/{id}/status
```

### Sections
```
GET    /api/sections
POST   /api/sections
PUT    /api/sections/{id}
DELETE /api/sections/{id}
PUT    /api/sections/{id}/assign-server
```

### Layouts
```
GET    /api/saved-layouts
POST   /api/saved-layouts
PUT    /api/saved-layouts/{id}
DELETE /api/saved-layouts/{id}
POST   /api/saved-layouts/{id}/activate
```

### Combinations
```
GET    /api/table-combinations
POST   /api/table-combinations
DELETE /api/table-combinations/{id}
POST   /api/table-combinations/{id}/activate
POST   /api/table-combinations/{id}/deactivate
```

---

## Business Rules

1. **Unique Table Numbers:** Table numbers unique within location
2. **Section Assignment:** Tables can only belong to one section
3. **Capacity Limits:** Combined tables sum individual capacities
4. **Active Orders:** Can't delete tables with active orders
5. **Server Sections:** Servers only see their assigned sections (unless manager)
6. **Layout Switching:** Warn if switching layouts with active orders

---

## Permissions

| Action | Host | Server | Manager | Admin |
|--------|------|--------|---------|-------|
| View floor plan | Yes | Yes | Yes | Yes |
| Seat tables | Yes | Own section | Yes | Yes |
| Edit floor plan | No | No | Yes | Yes |
| Create sections | No | No | Yes | Yes |
| Assign servers | No | No | Yes | Yes |
| Combine tables | Yes | No | Yes | Yes |
| Switch layouts | No | No | Yes | Yes |

---

## Configuration Options

```yaml
floor_plan:
  editor:
    grid_size: 24
    snap_to_grid: true
    snap_to_objects: true
    show_measurements: true
    auto_save: true
    auto_save_interval_seconds: 30

  display:
    show_table_timers: true
    show_check_amounts: true
    show_guest_count: true
    show_server_name: false

  status_thresholds:
    seated_warning_minutes: 90   # Yellow after 90 min
    seated_critical_minutes: 120 # Red after 120 min

  sections:
    require_server_assignment: true
    allow_server_overlap: false

  combinations:
    save_presets: true
    max_tables_combined: 5
```

---

*Last Updated: January 27, 2026*
