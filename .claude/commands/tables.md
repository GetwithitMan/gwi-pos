# Table Management

Create, configure, and manage tables and sections.

## Overview

Table management handles the creation and organization of tables within sections, integrating with floor plans and reservations.

## Sections

### What is a Section?
A grouping of tables, typically by area:
- Main Dining
- Patio
- Bar Area
- Private Room

### Create Section
1. Go to `/tables`
2. Click "Add Section"
3. Enter name
4. Set sort order

### Assign Server to Section
1. Edit section
2. Select server(s)
3. Server sees only their section's tables

## Tables

### Create Table
1. Select section
2. Click "Add Table"
3. Configure:
   - Name/Number (T1, Patio 3)
   - Capacity (2, 4, 6, 8+)
   - Shape (square, round, rectangle)
   - Position (if using floor plan)

### Table Properties

| Property | Description |
|----------|-------------|
| name | Display name |
| capacity | Max guests |
| section | Parent section |
| shape | Visual shape |
| status | Available, Occupied, Reserved |
| posX, posY | Floor plan position |
| minPartySize | Minimum to seat |
| isActive | Available for seating |

## Table Status

| Status | Color | Meaning |
|--------|-------|---------|
| Available | Green | Ready for seating |
| Occupied | Blue | Has active order |
| Reserved | Yellow | Has reservation |
| Blocked | Red | Not available |
| Dirty | Gray | Needs cleaning |

### Status Changes

**Automatic:**
- Available → Occupied (order started)
- Occupied → Available (order closed)
- Reserved → Occupied (reservation seated)

**Manual:**
- Mark as blocked (maintenance)
- Mark as dirty (needs bussing)
- Clear to available

## Floor Plan

See `floor-plan.md` for visual arrangement.

### Grid View
- Tables arranged by section
- Click to select
- Status colors visible

### Map View
- Actual floor layout
- Drag to position
- Scale to match space

## Table Selection (POS)

### Start Dine-In Order
1. Click "Table" order type
2. Table picker opens
3. See available tables
4. Click to select
5. Enter guest count
6. Order starts

### Transfer Table
1. Open order
2. Click "Transfer"
3. Select new table
4. Order moves to new table

### Merge Tables
1. Open order
2. Click "Merge"
3. Select tables to combine
4. Single check for group

## Reservations Integration

- Reserved tables shown with reservation time
- Conflict warning if double-booked
- Auto-block during reservation window

## API Endpoints

### List Tables
```
GET /api/tables?locationId=xxx
```

### Get Table
```
GET /api/tables/[id]
```

### Create Table
```
POST /api/tables
{
  "locationId": "xxx",
  "sectionId": "yyy",
  "name": "T10",
  "capacity": 4,
  "shape": "round"
}
```

### Update Status
```
PATCH /api/tables/[id]
{
  "status": "occupied"
}
```

### List Sections
```
GET /api/sections?locationId=xxx
```

## Database Models

### Section
```prisma
model Section {
  id         String   @id
  locationId String
  name       String
  sortOrder  Int
  isActive   Boolean
  tables     Table[]
  employees  SectionAssignment[]
}
```

### Table
```prisma
model Table {
  id           String   @id
  locationId   String
  sectionId    String
  name         String
  capacity     Int
  shape        String?
  status       String   @default("available")
  posX         Int?
  posY         Int?
  minPartySize Int?
  isActive     Boolean  @default(true)
  orders       Order[]
}
```

## Key Files

| File | Purpose |
|------|---------|
| `src/app/(admin)/tables/page.tsx` | Table management |
| `src/app/api/tables/route.ts` | Tables CRUD |
| `src/app/api/sections/route.ts` | Sections CRUD |
| `src/components/orders/TablePickerModal.tsx` | Table selection |
| `src/components/tables/FloorPlanEditor.tsx` | Floor plan |
