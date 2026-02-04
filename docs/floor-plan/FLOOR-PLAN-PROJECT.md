# Floor Plan Project Manager

> Last Updated: February 4, 2026
> Status: **Phase 1 Complete** - Database Persistence with Real-Time Sync

## Overview

The Floor Plan system provides a visual editor for designing restaurant/bar layouts and a Front-of-House (FOH) view for servers to manage tables, seats, and orders.

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
│  ┌──────────────────┐         ┌──────────────────┐              │
│  │  FOH View        │ ◄────── │   API Routes     │              │
│  │  /test-floorplan │   GET   │  /api/floor-plan │              │
│  │                  │         │  -elements       │              │
│  └──────────────────┘         └──────────────────┘              │
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

### FOH View
- `src/components/floor-plan/FloorPlanHome.tsx` - Main FOH component
- `src/domains/floor-plan/tables/Table.tsx` - Table rendering
- `src/domains/floor-plan/tables/Seat.tsx` - Seat rendering

### Shared
- `src/domains/floor-plan/shared/types.ts` - Shared types (Fixture, Point, etc.)
- `src/domains/floor-plan/canvas/FloorCanvasAPI.ts` - In-memory canvas API

### Test Pages
- `src/app/test-floorplan/page.tsx` - FOH test page
- `src/app/test-floorplan/editor/page.tsx` - Editor test page

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

### Real-Time Sync

FOH view polls every 5 seconds for fixture updates:
```typescript
// In FloorPlanHome.tsx
useEffect(() => {
  const interval = setInterval(() => {
    fetchFixtures();
  }, 5000);
  return () => clearInterval(interval);
}, []);
```

## Future Enhancements

### Phase 2: WebSocket Real-Time (Planned)
- Replace polling with Socket.io for instant updates
- `dispatchFloorPlanUpdate()` already implemented in API routes
- Need to add socket listener in FOH view

### Phase 3: Entertainment Integration (Planned)
- Link FloorPlanElement to MenuItem for entertainment items
- Visual indicators for pool tables, dart boards, etc.
- Session timers and status display on floor plan

### Phase 4: Table Management (Planned)
- Drag tables on FOH view to reposition
- Combine/split tables visually
- Reservation visual indicators

## Troubleshooting

### Fixtures not saving
1. Check browser console for API errors
2. Verify `locationId` is being passed to API
3. Run `npx prisma generate` if schema changed
4. Restart dev server after Prisma changes

### Fixtures not syncing to FOH
1. Check "Sync Status" panel shows "Database Connected"
2. Verify both pages use same `locationId`
3. Check network tab for polling requests
4. Ensure Section IDs match between pages

### Canvas not rendering
1. Check Section has `widthFeet` and `heightFeet` set
2. Verify `dbFloorPlan` prop is being passed in database mode
3. Check for JavaScript errors in console

## Testing Checklist

- [x] Create fixture in Editor
- [x] Fixture persists after page refresh
- [x] Fixture appears in FOH view
- [x] Multiple rooms/sections work independently
- [x] Wall fixtures with geometry save correctly
- [x] Rectangle and circle fixtures save correctly
- [x] Fixture position updates persist
- [x] Delete fixture removes from database
- [x] Real-time polling updates FOH within 5 seconds
