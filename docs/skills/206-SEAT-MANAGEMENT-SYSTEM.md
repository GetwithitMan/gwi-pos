# Skill 206: Seat Management System

## Overview
Comprehensive seat management for floor plan tables, including generation, positioning, virtual groups, and ordering integration.

## Status: COMPLETE (Feb 4, 2026)

## Components

### 1. Seat API (✅ Complete)
- `/api/seats` - List, create seats
- `/api/seats/[id]` - Get, update, delete seats
- `/api/tables/[id]/seats` - Table-specific operations
- `/api/tables/[id]/seats/generate` - Generate default layout
- `/api/tables/[id]/seats/auto-generate` - Pattern-based generation
- `/api/tables/[id]/seats/reflow` - Reposition after table resize

### 2. Seat Position Generation (✅ Complete)
- `/src/lib/seat-generation.ts` - Pure functions for position calculation
- Supports: rectangle, round, oval, booth shapes
- Patterns: all_around, front_only, two_sides, three_sides, inside
- Clockwise ordering from top-left

### 3. Seat Renderer (✅ Complete)
- `/src/domains/floor-plan/admin/SeatRenderer.tsx`
- Visual states: empty, has items, selected, highlighted
- Click/double-click handlers
- Rotation with table (counter-rotate labels)

### 4. Manual Seat Positioning (✅ Complete)
- Drag seats within boundary zone
- Boundary: 5px min, 40px max from table edge
- Seat-to-seat collision prevention
- ESC to cancel drag
- Auto-save on release

### 5. Virtual Group Seats (✅ Complete)
- `/src/lib/virtual-group-seats.ts`
- Sequential numbering across combined tables
- Label format: "T1-3" (TableName-SeatNumber)
- Restore original labels on uncombine

### 6. Schema Enhancements (✅ Complete)
```prisma
model Seat {
  virtualGroupId        String?
  virtualSeatNumber     Int?
  virtualGroupCreatedAt DateTime?
  status                String    @default("available")
  currentOrderItemId    String?
  lastOccupiedAt        DateTime?
  lastOccupiedBy        String?

  @@index([virtualGroupId])
}
```

## Completed Work

### Seat Reflow on Table Resize (✅ Complete)
- API endpoint: `/api/tables/[id]/seats/reflow`
- Scales seat positions proportionally when table is resized
- Ensures seats stay outside table body (20px minimum clearance)
- Integrated into EditorCanvas resize-complete flow
- Socket dispatch for real-time updates

### FOH Integration
- Seats displayed on FOH floor plan
- Click seat to assign order items
- Highlight active seat during ordering

## Dependencies
- Skill 16: Table Layout
- Skill 117: Virtual Table Combine

## Related Skills
- Skill 11: Seat Tracking (order items)
- Skill 121: Atomic Seat Management

## Key Files
```
src/lib/seat-generation.ts
src/lib/virtual-group-seats.ts
src/domains/floor-plan/admin/SeatRenderer.tsx
src/domains/floor-plan/admin/TableRenderer.tsx (modified)
src/domains/floor-plan/admin/EditorCanvas.tsx (modified)
src/app/api/seats/
src/app/api/tables/[id]/seats/
```

## Known Issues (All Resolved)
- [x] ~~Seat dragging not working~~ - FIXED: Props now passed to EditorCanvas
- [x] ~~Regenerate seats 500 error~~ - FIXED: Function signature and label field
- [x] ~~Seats stacking on resize~~ - FIXED: Reflow algorithm logic corrected

## Testing
1. Generate seats for different table shapes
2. Manually reposition seats
3. Combine tables and verify virtual numbering
4. Uncombine and verify label restoration
5. Resize table and verify seat reflow
