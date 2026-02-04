# 53 - Enterprise Multi-Location Management

**Status:** Planning
**Priority:** Critical (Infrastructure)
**Dependencies:** 09-Features-Config, 03-Menu-Programming, 05-Employees-Roles

---

## Overview

The Enterprise Multi-Location Management skill enables centralized control of multiple restaurant locations from a single dashboard. Build menus once and deploy to all or selected locations, manage employees across sites, view consolidated reporting, and maintain brand consistency while allowing location-specific customizations.

**Primary Goal:** Manage 2 to 200+ locations from one central hub with efficient menu deployment, consolidated reporting, and role-based access control.

---

## User Stories

### As a Multi-Unit Owner...
- I want to see all locations at a glance
- I want to update menus across all locations at once
- I want consolidated sales reports
- I want to compare location performance

### As a Regional Manager...
- I want to manage my assigned locations
- I want to deploy menu changes to my region
- I want to see regional performance metrics
- I want to manage regional staff

### As a Location Manager...
- I want to see only my location's data
- I want limited menu customization ability
- I want to manage my staff
- I want my location's reports

### As Corporate...
- I want brand consistency across all locations
- I want to control what locations can modify
- I want audit trails for all changes
- I want enterprise-wide analytics

---

## Features

### Organization Hierarchy

#### Structure Levels
```yaml
hierarchy:
  enterprise:
    name: "GWI Restaurants Inc."
    level: 0

  regions:
    - name: "West Coast"
      level: 1
      locations: ["LA Downtown", "LA Beach", "San Diego", "Seattle"]

    - name: "East Coast"
      level: 1
      locations: ["NYC Times Square", "NYC Brooklyn", "Boston", "Miami"]

  districts:
    - name: "Southern California"
      level: 2
      parent: "West Coast"
      locations: ["LA Downtown", "LA Beach", "San Diego"]

  locations:
    - name: "LA Downtown"
      level: 3
      id: "loc_001"
```

#### Hierarchy Visualization
```
Enterprise (GWI Restaurants Inc.)
├── Region: West Coast
│   ├── District: Southern California
│   │   ├── Location: LA Downtown
│   │   ├── Location: LA Beach
│   │   └── Location: San Diego
│   └── District: Pacific Northwest
│       └── Location: Seattle
├── Region: East Coast
│   ├── Location: NYC Times Square
│   ├── Location: NYC Brooklyn
│   ├── Location: Boston
│   └── Location: Miami
└── Region: Central
    ├── Location: Chicago
    └── Location: Dallas
```

### Centralized Menu Management

#### Menu Templates
```yaml
menu_templates:
  master_menu:
    name: "Core Menu v3.2"
    type: "master"
    applies_to: "all"
    locked_items: true  # Locations can't remove

  regional_additions:
    name: "West Coast Specials"
    type: "regional"
    applies_to: ["West Coast"]
    additive: true  # Adds to master

  location_customization:
    name: "LA Beach Local Items"
    type: "location"
    applies_to: ["LA Beach"]
    requires_approval: true
```

#### Menu Deployment Flow
```
+------------------------------------------------------------------+
|                    MENU DEPLOYMENT                                |
+------------------------------------------------------------------+
|                                                                   |
| SOURCE MENU: Core Menu v3.2                                       |
| Last Updated: Jan 27, 2026 by Corporate                          |
|                                                                   |
| DEPLOY TO:                                                        |
| +--------------------------------------------------------------+ |
| | [ ] All Locations (12)                                        | |
| |                                                                | |
| | [✓] West Coast (4)                                            | |
| |     [✓] LA Downtown                                           | |
| |     [✓] LA Beach                                              | |
| |     [✓] San Diego                                             | |
| |     [✓] Seattle                                               | |
| |                                                                | |
| | [ ] East Coast (4)                                            | |
| | [ ] Central (2)                                               | |
| +--------------------------------------------------------------+ |
|                                                                   |
| DEPLOYMENT OPTIONS                                                |
| (•) Replace existing menu                                        |
| ( ) Merge with existing (add new items only)                     |
| ( ) Update prices only                                           |
|                                                                   |
| SCHEDULE                                                          |
| (•) Deploy immediately                                           |
| ( ) Schedule for: [_________] at [____]                         |
|                                                                   |
| [ ] Notify location managers                                      |
| [ ] Require acknowledgment                                        |
|                                                                   |
| [Cancel]                              [Deploy to 4 Locations]    |
+------------------------------------------------------------------+
```

### Menu Locking & Permissions

#### Lock Levels
```yaml
menu_locks:
  enterprise_locked:
    description: "Cannot be modified by anyone below enterprise"
    applies_to:
      - "Core menu items"
      - "Brand signature dishes"
      - "Pricing minimums"

  region_locked:
    description: "Cannot be modified below region level"
    applies_to:
      - "Regional specials"
      - "Regional pricing"

  location_customizable:
    description: "Location can modify within limits"
    allows:
      - "Local specials (up to 10 items)"
      - "Price adjustments (±10%)"
      - "86 items"
      - "Modifier additions"
    requires_approval:
      - "New menu categories"
      - "Price changes >10%"
```

### Employee Management

#### Cross-Location Access
```yaml
employee_access:
  corporate_admin:
    access: "all_locations"
    permissions: "full"

  regional_manager:
    access: ["West Coast"]
    permissions: "manage_locations"
    can_hire: true
    can_terminate: false  # Requires corporate

  district_manager:
    access: ["Southern California"]
    permissions: "manage_locations"

  floating_employee:
    home_location: "LA Downtown"
    can_work_at: ["LA Beach", "San Diego"]
    permissions: "same_as_home"
```

#### Employee Transfer
```
+------------------------------------------------------------------+
| TRANSFER EMPLOYEE                                                 |
+------------------------------------------------------------------+
|                                                                   |
| EMPLOYEE: Sarah Martinez                                          |
| Current Location: LA Downtown                                     |
| Role: Server                                                      |
|                                                                   |
| TRANSFER TYPE                                                     |
| ( ) Permanent Transfer                                            |
| (•) Temporary Assignment                                          |
| ( ) Add Secondary Location                                        |
|                                                                   |
| DESTINATION                                                        |
| [LA Beach_______________▼]                                        |
|                                                                   |
| DURATION (if temporary)                                           |
| Start: [01/28/2026]  End: [02/15/2026]                           |
|                                                                   |
| [ ] Keep same role                                                |
| [ ] Transfer tip pool eligibility                                 |
| [✓] Notify both location managers                                 |
|                                                                   |
| [Cancel]                              [Process Transfer]          |
+------------------------------------------------------------------+
```

### Consolidated Reporting

#### Enterprise Dashboard
```
+------------------------------------------------------------------+
| ENTERPRISE DASHBOARD                          Jan 27, 2026        |
+------------------------------------------------------------------+
|                                                                   |
| OVERVIEW                                                          |
| +------------------+ +------------------+ +------------------+    |
| | Total Sales      | | Locations Open   | | Labor %          |   |
| | $847,250         | | 11 / 12          | | 28.4%            |   |
| | ↑ 8% vs LW       | | Seattle closed   | | Target: 28%      |   |
| +------------------+ +------------------+ +------------------+    |
|                                                                   |
| SALES BY REGION                                                   |
| +--------------------------------------------------------------+ |
| | Region        | Today     | MTD        | vs LY    | Trend    | |
| +--------------------------------------------------------------+ |
| | West Coast    | $78,420   | $1.2M      | +12%     | ↑        | |
| | East Coast    | $92,150   | $1.4M      | +8%      | ↑        | |
| | Central       | $34,680   | $520K      | +15%     | ↑        | |
| +--------------------------------------------------------------+ |
|                                                                   |
| TOP PERFORMING LOCATIONS                                          |
| +--------------------------------------------------------------+ |
| | #  | Location          | Sales    | Tickets | Avg Check     | |
| +--------------------------------------------------------------+ |
| | 1  | NYC Times Square  | $42,150  | 847     | $49.76        | |
| | 2  | LA Downtown       | $38,420  | 712     | $53.96        | |
| | 3  | Miami             | $28,340  | 524     | $54.08        | |
| +--------------------------------------------------------------+ |
|                                                                   |
| ALERTS                                                            |
| [!] Seattle - Location closed (equipment issue)                  |
| [!] Boston - Labor at 32% (over target)                         |
| [i] NYC Brooklyn - New menu deployed successfully               |
|                                                                   |
+------------------------------------------------------------------+
```

#### Location Comparison
```
+------------------------------------------------------------------+
| LOCATION COMPARISON                                               |
+------------------------------------------------------------------+
|                                                                   |
| Compare: [LA Downtown] vs [LA Beach] vs [San Diego]              |
| Period: [This Month_____▼]                                       |
|                                                                   |
| +--------------------------------------------------------------+ |
| | Metric              | LA Downtown | LA Beach  | San Diego    | |
| +--------------------------------------------------------------+ |
| | Total Sales         | $412,500    | $328,400  | $287,600     | |
| | Ticket Count        | 8,240       | 7,120     | 5,890        | |
| | Average Check       | $50.06      | $46.12    | $48.83       | |
| | Labor %             | 27.2%       | 29.8%     | 26.4%        | |
| | Food Cost %         | 28.1%       | 29.2%     | 27.8%        | |
| | Table Turns/Day     | 4.2         | 3.8       | 3.5          | |
| | Online Order %      | 18%         | 24%       | 12%          | |
| | Top Item            | Salmon      | Fish Taco | Carne Asada  | |
| +--------------------------------------------------------------+ |
|                                                                   |
| [Export Comparison]  [Create Report]  [Set as Benchmark]         |
+------------------------------------------------------------------+
```

### Settings Inheritance

#### Configuration Hierarchy
```yaml
settings_inheritance:
  enterprise:
    # Applies to all unless overridden
    tax_rounding: "standard"
    receipt_footer: "Thank you for dining with GWI Restaurants!"
    logo: "gwr_corporate_logo.png"

  region:
    # Can override enterprise
    west_coast:
      time_zone: "America/Los_Angeles"

    east_coast:
      time_zone: "America/New_York"

  location:
    # Can override region (if permitted)
    la_beach:
      receipt_footer: "Thanks for visiting LA Beach!"
      local_tax_rate: 9.5%
```

#### Settings Override UI
```
+------------------------------------------------------------------+
| SETTINGS: LA Beach                                                |
+------------------------------------------------------------------+
|                                                                   |
| RECEIPT SETTINGS                                                  |
|                                                                   |
| Header Logo                                                       |
| [Corporate Logo ▼]  [🔒 Locked by Enterprise]                    |
|                                                                   |
| Footer Message                                                    |
| [Thanks for visiting LA Beach!____]                              |
| [Override allowed] [Reset to Enterprise Default]                  |
|                                                                   |
| Tax Rate                                                          |
| [9.5%_______]                                                    |
| [Location-specific required]                                      |
|                                                                   |
| Tip Suggestions                                                   |
| [18%, 20%, 22%_____]                                             |
| [🔒 Locked by Enterprise]                                        |
|                                                                   |
| Auto-Gratuity Threshold                                           |
| [6 guests___]                                                    |
| [Override allowed] [Currently: Using Enterprise Default: 8]      |
|                                                                   |
+------------------------------------------------------------------+
```

### Audit & Compliance

#### Change Tracking
```
+------------------------------------------------------------------+
| ENTERPRISE AUDIT LOG                                              |
+------------------------------------------------------------------+
| Filter: [All Locations▼] [All Types▼] [Last 7 Days▼]            |
|                                                                   |
| +--------------------------------------------------------------+ |
| | Time        | Location    | User          | Action            | |
| +--------------------------------------------------------------+ |
| | 2:45 PM     | Corporate   | Admin: Mike   | Menu deployed     | |
| |             |             |               | to West Coast (4) | |
| | 2:30 PM     | LA Beach    | Mgr: Sarah    | Price override    | |
| |             |             |               | Fish Taco $14→$15 | |
| | 1:15 PM     | NYC TS      | Mgr: John     | Employee added    | |
| |             |             |               | New hire: Alex R. | |
| | 11:00 AM    | Corporate   | Admin: Lisa   | Settings changed  | |
| |             |             |               | Tip % updated     | |
| | 10:30 AM    | Boston      | Mgr: Kate     | 86'd item         | |
| |             |             |               | Lobster Roll      | |
| +--------------------------------------------------------------+ |
|                                                                   |
| [Export Log]  [Set Alert Rules]  [Compliance Report]             |
+------------------------------------------------------------------+
```

---

## Data Model

### Organizations
```sql
organizations {
  id: UUID PRIMARY KEY

  name: VARCHAR(200)
  type: VARCHAR(50)  -- enterprise, region, district, location
  parent_id: UUID (FK, nullable)

  -- Hierarchy path for fast queries
  path: LTREE  -- e.g., "enterprise.west_coast.socal.la_downtown"
  level: INTEGER

  -- Settings
  settings: JSONB
  settings_locked: JSONB  -- Which settings can't be overridden

  -- Status
  is_active: BOOLEAN DEFAULT true

  created_at: TIMESTAMP
  updated_at: TIMESTAMP
}
```

### Menu Templates
```sql
menu_templates {
  id: UUID PRIMARY KEY
  organization_id: UUID (FK)  -- Owner org level

  name: VARCHAR(200)
  version: VARCHAR(20)

  -- Scope
  template_type: VARCHAR(50)  -- master, regional, local
  applies_to: UUID[]  -- Organization IDs

  -- Content
  menu_data: JSONB

  -- Control
  is_locked: BOOLEAN DEFAULT false
  requires_approval: BOOLEAN DEFAULT false

  -- Versioning
  parent_version_id: UUID (FK, nullable)

  created_by: UUID (FK)
  created_at: TIMESTAMP
  published_at: TIMESTAMP (nullable)
}
```

### Menu Deployments
```sql
menu_deployments {
  id: UUID PRIMARY KEY

  template_id: UUID (FK)
  target_organization_id: UUID (FK)

  -- Deployment info
  deployment_type: VARCHAR(50)  -- replace, merge, prices_only
  status: VARCHAR(50)  -- pending, in_progress, completed, failed

  -- Scheduling
  scheduled_for: TIMESTAMP (nullable)
  deployed_at: TIMESTAMP (nullable)

  -- Results
  items_added: INTEGER DEFAULT 0
  items_updated: INTEGER DEFAULT 0
  items_removed: INTEGER DEFAULT 0
  errors: JSONB (nullable)

  deployed_by: UUID (FK)
  created_at: TIMESTAMP
}
```

### Employee Organization Access
```sql
employee_organization_access {
  id: UUID PRIMARY KEY
  employee_id: UUID (FK)
  organization_id: UUID (FK)

  -- Access type
  access_type: VARCHAR(50)  -- primary, secondary, temporary

  -- Temporary access
  valid_from: TIMESTAMP (nullable)
  valid_until: TIMESTAMP (nullable)

  -- Permissions at this org
  role_id: UUID (FK)

  granted_by: UUID (FK)
  created_at: TIMESTAMP
}
```

### Organization Settings
```sql
organization_settings {
  organization_id: UUID PRIMARY KEY (FK)

  -- Settings with inheritance
  settings: JSONB
  /*
  {
    "tax_rate": {"value": 9.5, "inherited": false},
    "tip_suggestions": {"value": [18,20,22], "inherited": true, "from": "enterprise"},
    "receipt_footer": {"value": "Thanks!", "inherited": false}
  }
  */

  -- Locks
  locked_settings: VARCHAR[]  -- Settings this org can't override

  updated_at: TIMESTAMP
  updated_by: UUID (FK)
}
```

---

## API Endpoints

### Organizations
```
GET    /api/organizations
GET    /api/organizations/{id}
GET    /api/organizations/{id}/children
GET    /api/organizations/{id}/hierarchy
POST   /api/organizations
PUT    /api/organizations/{id}
DELETE /api/organizations/{id}
```

### Menu Management
```
GET    /api/menu-templates
POST   /api/menu-templates
PUT    /api/menu-templates/{id}
POST   /api/menu-templates/{id}/deploy
GET    /api/menu-templates/{id}/deployments
POST   /api/menu-templates/{id}/publish
```

### Enterprise Reporting
```
GET    /api/enterprise/dashboard
GET    /api/enterprise/sales
GET    /api/enterprise/comparison
GET    /api/enterprise/locations/performance
GET    /api/enterprise/audit-log
```

### Settings
```
GET    /api/organizations/{id}/settings
PUT    /api/organizations/{id}/settings
GET    /api/organizations/{id}/settings/effective  -- With inheritance
POST   /api/organizations/{id}/settings/lock
POST   /api/organizations/{id}/settings/unlock
```

---

## Business Rules

1. **Hierarchy Enforcement:** Child orgs inherit parent settings unless overridden
2. **Lock Cascade:** Enterprise locks cascade to all children
3. **Menu Versioning:** All menu changes create new versions
4. **Approval Flow:** Location changes above threshold require regional/enterprise approval
5. **Audit Everything:** All cross-location actions logged
6. **Employee Access:** Employees can only access authorized locations
7. **Data Isolation:** Location data isolated unless aggregated at higher level

---

## Permissions

| Action | Location Mgr | District Mgr | Regional Mgr | Enterprise |
|--------|--------------|--------------|--------------|------------|
| View own location | Yes | Yes | Yes | Yes |
| View district locations | No | Yes | Yes | Yes |
| View all locations | No | No | Yes | Yes |
| Edit local menu | Limited | Yes | Yes | Yes |
| Deploy menus | No | No | Yes | Yes |
| Create menu templates | No | No | No | Yes |
| Transfer employees | Request | Within district | Within region | Anywhere |
| View enterprise reports | No | No | Yes | Yes |
| Modify org structure | No | No | No | Yes |
| Lock settings | No | No | Regional | Enterprise |

---

## Configuration Options

```yaml
enterprise:
  hierarchy:
    max_levels: 5
    require_region: true
    allow_districts: true

  menu_management:
    require_approval_for_local: true
    max_local_items: 20
    price_variance_allowed: 10  # Percent
    version_history_days: 365

  employee_management:
    allow_multi_location: true
    max_secondary_locations: 3
    require_transfer_approval: true

  reporting:
    consolidation_delay_minutes: 15
    comparison_metrics:
      - sales
      - labor_percent
      - food_cost
      - average_check
      - table_turns

  settings:
    inheritable:
      - receipt_footer
      - tip_suggestions
      - auto_gratuity_threshold
    always_local:
      - tax_rate
      - address
      - phone
    enterprise_only:
      - logo
      - brand_colors
      - payment_processor
```

---

*Last Updated: January 27, 2026*
