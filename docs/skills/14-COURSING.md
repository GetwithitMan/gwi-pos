# 14 - Coursing

**Status:** Planning
**Priority:** High
**Dependencies:** 04-Order-Management, 03-Menu-Programming

---

## Overview

The Coursing skill manages the flow of multi-course meals, controlling when items are fired to the kitchen and ensuring proper pacing of the dining experience. Essential for fine dining and full-service restaurants.

**Primary Goal:** Give servers complete control over course timing while providing kitchen with clear, organized workflow.

---

## User Stories

### As a Server...
- I want to assign items to courses as I take the order
- I want to fire courses when my table is ready
- I want to see at a glance which courses have been fired
- I want to hold a course if the table needs more time

### As a Kitchen Manager...
- I want to see all courses for each table
- I want to know which courses are ready to fire
- I want clear organization of tickets by course
- I want alerts when tables are waiting too long

### As a Manager...
- I want to track course timing for quality control
- I want to identify bottlenecks in service
- I want to ensure consistent pacing

---

## Features

### Course Management

#### Default Courses
- [ ] Appetizers / First Course
- [ ] Soup / Salad
- [ ] Entrees / Main Course
- [ ] Dessert
- [ ] After Dinner (coffee, digestifs)

#### Custom Courses
- [ ] Create custom course names
- [ ] Set course order/sequence
- [ ] Assign default course to menu items
- [ ] Unlimited course support

#### Course Configuration
```yaml
courses:
  - name: "Appetizers"
    short_name: "APP"
    sequence: 1
    color: "#FF9800"
    auto_fire: false

  - name: "Salads"
    short_name: "SAL"
    sequence: 2
    color: "#4CAF50"
    auto_fire: false

  - name: "Entrees"
    short_name: "ENT"
    sequence: 3
    color: "#2196F3"
    auto_fire: false

  - name: "Desserts"
    short_name: "DES"
    sequence: 4
    color: "#9C27B0"
    auto_fire: false
```

### Course Assignment

#### During Order Entry
- [ ] Auto-assign based on item default
- [ ] Override course for any item
- [ ] Visual course indicator on items
- [ ] Drag items between courses

#### Course Assignment UI
```
[Select Course: APP | SAL | ENT | DES]

Items auto-assigned:
- Wings → APP
- Caesar Salad → SAL
- Ribeye → ENT
- Cheesecake → DES

Override: Drag "Caesar Salad" to APP if guest wants it as starter
```

### Fire Control

#### Fire Operations
- [ ] Fire single course
- [ ] Fire multiple courses
- [ ] Fire all remaining courses
- [ ] Rush course (priority flag)

#### Fire Status
- [ ] **Held:** Not yet fired
- [ ] **Fired:** Sent to kitchen
- [ ] **In Progress:** Kitchen working
- [ ] **Ready:** Ready for pickup
- [ ] **Served:** Delivered to table

#### Fire Confirmation
- [ ] Confirm before firing
- [ ] Fire with timing notes
- [ ] Estimated ready time

### Course Timing

#### Pacing Options
- [ ] **Manual:** Server fires each course
- [ ] **Auto-Suggest:** System suggests when to fire
- [ ] **Auto-Fire:** Fire automatically after interval

#### Timing Rules
```yaml
timing:
  auto_suggest: true
  suggest_after_minutes:
    after_appetizers: 15
    after_salads: 10
    after_entrees: 20

  auto_fire: false
  auto_fire_delay_minutes: 25
```

#### Timing Alerts
- [ ] Table waiting too long
- [ ] Course ready, not picked up
- [ ] Suggested fire time reached

### Kitchen Display Integration

#### Course Display
- [ ] Group tickets by course
- [ ] Color-coded by course
- [ ] Fire time visible
- [ ] Table number prominent

#### Kitchen Actions
- [ ] Mark course in progress
- [ ] Mark course ready
- [ ] Alert server
- [ ] Request hold

### Course Tracking

#### Per-Table View
- [ ] All courses for table
- [ ] Status of each course
- [ ] Items in each course
- [ ] Timing information

#### Server Overview
- [ ] All tables with pending courses
- [ ] Next course to fire
- [ ] Overdue courses

---

## UI/UX Specifications

### Order Entry with Courses

```
+------------------------------------------------------------------+
| ORDER - Table 12 (4 guests)                                      |
+------------------------------------------------------------------+
| COURSE: [APP] [SAL] [ENT] [DES]                 All Courses View |
+------------------------------------------------------------------+
|                                                                  |
| APPETIZERS (2 items)                              [Fire Course]  |
| +----------------------------------------------------------+    |
| | Wings (L)                               $18.99            |    |
| | Calamari                                $14.99            |    |
| +----------------------------------------------------------+    |
|                                                                  |
| SALADS (2 items)                                  [Held]         |
| +----------------------------------------------------------+    |
| | Caesar - Seat 1                          $8.99            |    |
| | House - Seat 3                           $6.99            |    |
| +----------------------------------------------------------+    |
|                                                                  |
| ENTREES (4 items)                                 [Held]         |
| +----------------------------------------------------------+    |
| | Ribeye MR - Seat 1                      $34.99            |    |
| | Salmon - Seat 2                         $28.99            |    |
| | Chicken - Seat 3                        $22.99            |    |
| | Pasta - Seat 4                          $18.99            |    |
| +----------------------------------------------------------+    |
|                                                                  |
| DESSERTS (0 items)                                               |
| [+ Add items to this course]                                    |
|                                                                  |
+------------------------------------------------------------------+
| [Send Order]        [Fire All]         [Hold All]               |
+------------------------------------------------------------------+
```

### Course Control Panel

```
+------------------------------------------------------------------+
| COURSE CONTROL - Table 12                                        |
+------------------------------------------------------------------+
|                                                                  |
| APP ████████████ FIRED 6:45 PM → SERVED 6:58 PM   ✓             |
|                                                                  |
| SAL ████████░░░░ FIRED 7:02 PM → IN PROGRESS      ~             |
|                                                                  |
| ENT ░░░░░░░░░░░░ HELD           Suggest fire: 7:15 PM           |
|     [Fire Now]  [Fire in 5 min]  [Hold]                         |
|                                                                  |
| DES ░░░░░░░░░░░░ NO ITEMS YET                                   |
|                                                                  |
+------------------------------------------------------------------+
| Timeline: APP served (13 min) → SAL in progress → ENT waiting   |
+------------------------------------------------------------------+
```

### Kitchen Display (Course View)

```
+------------------------------------------------------------------+
| KITCHEN - COURSE VIEW                              7:15 PM       |
+------------------------------------------------------------------+
| APPETIZERS                                                       |
| +------------------+ +------------------+                        |
| | TABLE 8          | | TABLE 15         |                        |
| | 7:12 PM (3 min)  | | 7:14 PM (1 min)  |                        |
| | Wings, Nachos    | | Calamari         |                        |
| | [READY]          | | [WORKING]        |                        |
| +------------------+ +------------------+                        |
|                                                                  |
| ENTREES                                                          |
| +------------------+ +------------------+ +------------------+   |
| | TABLE 5          | | TABLE 12         | | TABLE 3          |   |
| | 7:05 PM (10 min) | | 7:08 PM (7 min)  | | 7:10 PM (5 min)  |   |
| | Ribeye MR        | | Ribeye MR        | | Salmon, Chicken  |   |
| | Salmon           | | Salmon, Chicken  | | Pasta x2         |   |
| |                  | | Pasta            | |                  |   |
| | [WORKING]        | | [WORKING]        | | [WORKING]        |   |
| +------------------+ +------------------+ +------------------+   |
|                                                                  |
+------------------------------------------------------------------+
```

### Server Course Overview

```
+------------------------------------------------------------------+
| MY TABLES - COURSE STATUS                                        |
+------------------------------------------------------------------+
| TABLE | GUESTS | CURRENT COURSE | STATUS        | ACTION         |
+------------------------------------------------------------------+
| 5     | 2      | Entrees        | In Progress   | --             |
| 8     | 4      | Appetizers     | Ready!        | [Pick Up]      |
| 12    | 4      | Salads         | In Progress   | Fire ENT?      |
| 15    | 2      | Appetizers     | In Progress   | --             |
| 18    | 6      | Entrees        | Waiting 12min | [Rush]         |
+------------------------------------------------------------------+
```

---

## Data Model

### Course Definitions
```sql
course_definitions {
  id: UUID PRIMARY KEY
  location_id: UUID (FK)

  name: VARCHAR(100)
  short_name: VARCHAR(10)
  sequence: INTEGER
  color: VARCHAR(7)

  -- Behavior
  auto_fire: BOOLEAN DEFAULT false
  auto_fire_delay_minutes: INTEGER (nullable)

  is_active: BOOLEAN DEFAULT true

  created_at: TIMESTAMP
  updated_at: TIMESTAMP

  UNIQUE (location_id, sequence)
}
```

### Item Default Courses
```sql
menu_item_courses {
  menu_item_id: UUID (FK)
  course_definition_id: UUID (FK)

  PRIMARY KEY (menu_item_id)
}
```

### Order Courses
```sql
order_courses {
  id: UUID PRIMARY KEY
  order_id: UUID (FK)
  course_definition_id: UUID (FK)

  -- Status
  status: VARCHAR(50) (held, fired, in_progress, ready, served)

  -- Timing
  fired_at: TIMESTAMP (nullable)
  in_progress_at: TIMESTAMP (nullable)
  ready_at: TIMESTAMP (nullable)
  served_at: TIMESTAMP (nullable)

  -- Control
  hold_until: TIMESTAMP (nullable)
  rush: BOOLEAN DEFAULT false
  notes: TEXT (nullable)

  -- Who
  fired_by: UUID (FK, nullable)

  created_at: TIMESTAMP
  updated_at: TIMESTAMP

  UNIQUE (order_id, course_definition_id)
}
```

### Order Item Course Assignment
```sql
-- Add to order_items table:
order_items {
  ...
  course_id: UUID (FK to order_courses, nullable)
  ...
}
```

---

## API Endpoints

### Course Definitions
```
GET    /api/courses
POST   /api/courses
PUT    /api/courses/{id}
DELETE /api/courses/{id}
PUT    /api/courses/reorder
```

### Order Course Control
```
GET    /api/orders/{id}/courses
POST   /api/orders/{id}/courses/{course_id}/fire
POST   /api/orders/{id}/courses/{course_id}/hold
POST   /api/orders/{id}/courses/{course_id}/rush
POST   /api/orders/{id}/courses/fire-all
PUT    /api/orders/{id}/items/{item_id}/course
```

### Kitchen
```
POST   /api/orders/{id}/courses/{course_id}/in-progress
POST   /api/orders/{id}/courses/{course_id}/ready
GET    /api/kitchen/courses
WS     /ws/kitchen/courses
```

### Server Overview
```
GET    /api/employees/{id}/tables/courses
GET    /api/courses/overview
```

---

## Business Rules

1. **Fire Order:** Courses must fire in sequence (can't fire dessert before appetizers)
2. **Item Assignment:** All items must have a course assignment
3. **Empty Courses:** Can fire empty course to skip it
4. **Course Modification:** Can't modify items in fired course (need void)
5. **Kitchen Acknowledgment:** Kitchen can request hold before starting

---

## Permissions

| Action | Server | Kitchen | Manager | Admin |
|--------|--------|---------|---------|-------|
| Assign courses | Yes | No | Yes | Yes |
| Fire courses | Yes | No | Yes | Yes |
| Mark ready | No | Yes | Yes | Yes |
| Rush orders | Yes | No | Yes | Yes |
| Configure courses | No | No | Yes | Yes |

---

## Configuration Options

```yaml
coursing:
  enabled: true

  defaults:
    require_course_assignment: true
    auto_assign_from_item: true
    allow_skip_courses: true

  timing:
    suggest_fire: true
    suggest_intervals:
      appetizers_to_salads: 12
      salads_to_entrees: 10
      entrees_to_desserts: 20

  alerts:
    waiting_too_long_minutes: 15
    ready_not_picked_up_minutes: 5
```

---

## Open Questions

1. **Course Skipping:** Allow firing out of sequence with manager approval?

2. **Partial Fire:** Fire some items from a course early?

3. **Guest Pace:** Guests eating at different speeds - handle individually?

4. **Pre-made Items:** Some items (salads) made ahead - different timing?

---

## Status & Progress

### Planning
- [x] Initial requirements documented
- [ ] Course workflow finalized
- [ ] Kitchen integration detailed

### Development
- [ ] Course definitions
- [ ] Order course management
- [ ] Fire control
- [ ] Kitchen display
- [ ] Timing alerts
- [ ] Reporting

---

*Last Updated: January 27, 2026*
