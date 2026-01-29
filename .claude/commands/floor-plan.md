# Floor Plan Editor (Skill 80)

Visual floor plan management for tables, sections, and seating.

## Overview

The floor plan editor at `/tables` allows drag-and-drop arrangement of tables across sections, with visual representation of table shapes, sizes, and status.

## Accessing Floor Plan

1. Go to Settings menu (hamburger icon)
2. Click "Tables" or navigate to `/tables`

## Sections

### Create Section
1. Click "Add Section" button
2. Enter section name (e.g., "Patio", "Bar Area", "Main Dining")
3. Optionally assign employees to section

### Edit Section
- Click section name to rename
- Drag section tabs to reorder
- Assign servers via section settings

## Tables

### Add Table
1. Select section
2. Click "Add Table" button
3. Configure:
   - Table name/number (e.g., "T1", "Bar 1")
   - Shape: Square, Round, Rectangle
   - Size: Small (2), Medium (4), Large (6), Extra Large (8+)
   - Position: Drag to place

### Table Properties

| Property | Description |
|----------|-------------|
| Name | Display name (T1, Patio 3, etc.) |
| Capacity | Max guest count |
| Shape | Visual representation |
| Status | Available, Occupied, Reserved, Blocked |
| Section | Which section it belongs to |
| Position | X/Y coordinates on floor plan |

### Table Status Colors

| Status | Color | Description |
|--------|-------|-------------|
| Available | Green | Ready for seating |
| Occupied | Blue | Has active order |
| Reserved | Yellow | Upcoming reservation |
| Blocked | Red | Not available |

## Drag & Drop

### Moving Tables
1. Click and hold table
2. Drag to new position
3. Release to place
4. Position auto-saves

### Resizing Tables
- Drag corners to resize (if enabled)
- Or change size in table properties

## Table Picker (POS)

When selecting a table for an order:
1. Click "Table" order type
2. Floor plan appears as modal
3. Click available table to select
4. Enter guest count
5. Order starts with table assigned

## API Endpoints

### List Tables
```
GET /api/tables?locationId=xxx
```

### Create Table
```
POST /api/tables
{
  "locationId": "xxx",
  "sectionId": "yyy",
  "name": "T5",
  "capacity": 4,
  "shape": "round",
  "posX": 100,
  "posY": 200
}
```

### Update Position
```
PATCH /api/tables/[id]
{
  "posX": 150,
  "posY": 250
}
```

### Update Status
```
PATCH /api/tables/[id]/status
{
  "status": "occupied"
}
```

## Database Models

### Section
```prisma
model Section {
  id         String   @id
  locationId String
  name       String
  sortOrder  Int
  tables     Table[]
}
```

### Table
```prisma
model Table {
  id         String   @id
  locationId String
  sectionId  String
  name       String
  capacity   Int
  shape      String   // square, round, rectangle
  status     String   // available, occupied, reserved, blocked
  posX       Int?
  posY       Int?
}
```

## Key Files

| File | Purpose |
|------|---------|
| `src/app/(admin)/tables/page.tsx` | Floor plan editor |
| `src/components/tables/TablePickerModal.tsx` | POS table selection |
| `src/components/tables/FloorPlanCanvas.tsx` | Visual floor display |
| `src/app/api/tables/route.ts` | Tables CRUD API |
| `src/app/api/sections/route.ts` | Sections CRUD API |
