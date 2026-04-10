# Floor Plan Project Manager

> Last Updated: February 4, 2026
> Status: **Phase 1 Complete** - Database Persistence with Real-Time Sync

## Overview

The Floor Plan system provides a visual editor for designing restaurant/bar layouts. The FOH view for servers was removed in April 2026 — ordering is now Android/PAX only.

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                    FLOOR PLAN SYSTEM                             │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  ┌──────────────────┐         ┌──────────────────┐              │
│  │  Admin Editor    │ ──────► │   Database       │              │
│  │  /test-floorplan │  POST   │  FloorPlanElement│              │
│  │  /editor         │         │  Section         │              │
│  └──────────────────┘         └────────┬─────────┘              │
│                                        │                        │
│                                        │ 5-second polling       │
│                                        ▼                        │
│                               ┌──────────────────┐              │
│                               │   API Routes     │              │
│                               │  /api/floor-plan │              │
│                               │  -elements       │              │
│                               └──────────────────┘              │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

## Completed Layers

### Layer 1: Canvas Foundation ✅
- Grid rendering with configurable size (default 0.25ft)
- Coordinate system (feet-based with pixel conversion)
- Pan and zoom support
- Room dimensions from Section model

### Layer 2: Tables ✅
- Table model with capacity tracking
- Table shapes: circle, rectangle, square
- Table positioning and sizing
- API: `/api/tables`, `/api/tables/[id]`

### Layer 3: Seats ✅
- Seat model linked to tables
- Seat positioning around tables
- Seat numbering and status
- API: `/api/tables/[id]/seats`

### Layer 4: Groups (Virtual Combine) ✅
- VirtualTableGroup for combining tables
- Shared waitlist across grouped tables
- Visual connection lines between grouped tables

### Layer 5: Editor UI ✅
- Tool palette: Select, Wall, Rectangle, Circle, Delete
- Fixture types: bar_counter, stage, dj_booth, kitchen, storage, restroom, pillar, planter, host_stand, fireplace
- Properties panel for selected fixtures
- Room/Section tabs with add functionality
- Keyboard shortcuts (1-5 for tools, Delete, Escape)

### Layer 6: Database Persistence ✅
- FloorPlanElement model stores fixtures
- Section model provides room dimensions (widthFeet, heightFeet)
- Geometry field for complex shapes (walls with start/end points)
- Real-time sync via 5-second polling
- Socket dispatch for instant notifications (future enhancement)

## Database Models

### FloorPlanElement
```prisma
model FloorPlanElement {
  id                String    @id @default(cuid())
  locationId        String
  sectionId         String?
  name              String
  abbreviation      String?
  elementType       String    @default("fixture")  // fixture, entertainment
  visualType        String    // wall, rectangle, circle, bar_counter, etc.
  linkedMenuItemId  String?   // For entertainment items
  posX              Float     @default(0)
  posY              Float     @default(0)
  width             Float?
  height            Float?
  rotation          Float     @default(0)
  geometry          Json?     // For walls: {start: {x,y}, end: {x,y}}
  thickness         Float     @default(0.5)
  fillColor         String?
  strokeColor       String?
  opacity           Float     @default(1.0)
  status            String    @default("available")
  sortOrder         Int       @default(0)
  // ... sync fields
}
```

### Section (Room)
```prisma
model Section {
  id            String    @id @default(cuid())
  locationId    String
  name          String
  color         String?
  widthFeet     Float     @default(40)
  heightFeet    Float     @default(30)
  gridSizeFeet  Float     @default(0.25)
  // ... other fields
}
```

## API Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/locations` | GET | List all active locations |
| `/api/floor-plan-elements` | GET | List elements by locationId, sectionId |
| `/api/floor-plan-elements` | POST | Create new element |
| `/api/floor-plan-elements/[id]` | PUT | Update element position/properties |
| `/api/floor-plan-elements/[id]` | DELETE | Soft delete element |
| `/api/sections` | GET | List sections by locationId |
| `/api/sections` | POST | Create new section/room |

## Key Files

### Admin Editor
- `src/domains/floor-plan/admin/FloorPlanEditor.tsx` - Main editor component
- `src/domains/floor-plan/admin/EditorCanvas.tsx` - Canvas with drawing tools
- `src/domains/floor-plan/admin/FixtureProperties.tsx` - Properties panel
- `src/domains/floor-plan/admin/types.ts` - Editor types and fixture metadata

### Shared
- `src/domains/floor-plan/shared/types.ts` - Shared types (Fixture, Point, etc.)
- `src/domains/floor-plan/canvas/FloorCanvasAPI.ts` - In-memory canvas API

## Configuration

### Database Mode vs In-Memory Mode

The editor supports two modes:

```tsx
// Database mode (production)
<FloorPlanEditor
  locationId={locationId}
  useDatabase={true}
  onExit={handleExit}
/>

// In-memory mode (testing)
<FloorPlanEditor
  initialRoomId="room-main"
  useDatabase={false}
  onSave={handleSave}
  onExit={handleExit}
/>
```

## Future Enhancements

### Entertainment Integration (Planned)
- Link FloorPlanElement to MenuItem for entertainment items
- Visual indicators for pool tables, dart boards, etc.
- Session timers and status display on floor plan

## Troubleshooting

### Fixtures not saving
1. Check browser console for API errors
2. Verify `locationId` is being passed to API
3. Run `npx prisma generate` if schema changed
4. Restart dev server after Prisma changes

### Canvas not rendering
1. Check Section has `widthFeet` and `heightFeet` set
2. Verify `dbFloorPlan` prop is being passed in database mode
3. Check for JavaScript errors in console

## Testing Checklist

- [x] Create fixture in Editor
- [x] Fixture persists after page refresh
- [x] Multiple rooms/sections work independently
- [x] Wall fixtures with geometry save correctly
- [x] Rectangle and circle fixtures save correctly
- [x] Fixture position updates persist
- [x] Delete fixture removes from database
