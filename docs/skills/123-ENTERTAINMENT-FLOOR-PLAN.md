# Skill 123: Entertainment Floor Plan Integration

## Overview

Integrates entertainment menu items (pool tables, dart boards, karaoke rooms, bowling lanes) directly into the floor plan builder. Each entertainment item from the menu can be placed once on the floor plan with a custom visual representation, enabling visual management of timed rental equipment.

## The Problem

Entertainment venues need to:
- Visually represent entertainment equipment on a floor plan
- Track which equipment is available, in use, or on maintenance
- Link equipment to menu items for pricing and session management
- Manage waitlists for popular equipment
- Rotate visuals to match physical layout while keeping labels readable

## Solution: FloorPlanElement Model

Entertainment items are placed on the floor plan as `FloorPlanElement` records, linked to their corresponding `MenuItem` for pricing and session management.

### Key Principles

1. **One Placement Per Menu Item** - Each entertainment menu item can only be placed once on the floor plan. Multiple pool tables require multiple menu items.

2. **Visual Separation** - The SVG visual rotates independently from the label, keeping names readable at any angle.

3. **Status Sync** - Element status syncs with the linked menu item's entertainment status (available, in_use, reserved, maintenance).

4. **Room Assignment** - Elements can be assigned to sections/rooms, but unassigned elements always display regardless of room filter.

## Database Schema

### FloorPlanElement Model

```prisma
model FloorPlanElement {
  id         String   @id @default(cuid())
  locationId String
  location   Location @relation(fields: [locationId], references: [id])
  sectionId  String?
  section    Section? @relation(fields: [sectionId], references: [id])

  name         String   // "Pool Table 1", "Dartboard A"
  abbreviation String?  // Short display name: "PT1", "DB-A"

  // Element classification
  elementType  String   @default("entertainment") // "entertainment", "decoration", "barrier"
  visualType   String   // "pool_table", "dartboard", "arcade", "foosball", etc.

  // Link to menu item (for entertainment items with pricing/sessions)
  linkedMenuItemId String?
  linkedMenuItem   MenuItem? @relation(fields: [linkedMenuItemId], references: [id])

  // Position & dimensions
  posX     Int @default(100)
  posY     Int @default(100)
  width    Int @default(120)
  height   Int @default(80)
  rotation Int @default(0)

  // Visual customization
  fillColor   String?
  strokeColor String?
  opacity     Float   @default(1.0)

  // Status (for entertainment)
  status           String    @default("available") // "available", "in_use", "reserved", "maintenance"
  currentOrderId   String?
  sessionStartedAt DateTime?
  sessionExpiresAt DateTime?

  // Display options
  sortOrder Int     @default(0)
  isVisible Boolean @default(true)
  isLocked  Boolean @default(false)

  // Timestamps
  createdAt DateTime  @default(now())
  updatedAt DateTime  @updatedAt
  deletedAt DateTime?
  syncedAt  DateTime?

  // Relations
  waitlistEntries EntertainmentWaitlist[]

  @@index([locationId])
  @@index([sectionId])
  @@index([linkedMenuItemId])
  @@index([status])
}
```

## Visual Types

12 entertainment visual types with inline SVG components:

| Type | Default Size | Description |
|------|--------------|-------------|
| `pool_table` | 140×80 | Green felt table with pockets |
| `dartboard` | 80×80 | Classic dartboard with sections |
| `arcade` | 70×90 | Arcade cabinet silhouette |
| `foosball` | 120×70 | Foosball table from above |
| `shuffleboard` | 180×50 | Long shuffleboard table |
| `ping_pong` | 120×70 | Table tennis with net |
| `bowling_lane` | 200×50 | Lane with pins |
| `karaoke_stage` | 120×100 | Stage with microphone |
| `dj_booth` | 100×80 | DJ setup with turntables |
| `photo_booth` | 80×100 | Photo booth enclosure |
| `vr_station` | 100×100 | VR headset station |
| `game_table` | 100×100 | Generic game table (default) |

### Status-Based Styling

Each visual changes appearance based on status:
- **Available** (green glow) - Ready for customers
- **In Use** (amber glow) - Active session with time remaining badge
- **Reserved** (indigo glow) - Reserved for upcoming customer
- **Maintenance** (red glow) - Out of service

## API Endpoints

### GET /api/floor-plan-elements

List all elements for a location.

**Query Parameters:**
- `locationId` (required) - Location filter
- `sectionId` (optional) - Section/room filter

**Response:**
```json
{
  "elements": [
    {
      "id": "clx...",
      "name": "Pool Table 1",
      "abbreviation": "PT1",
      "elementType": "entertainment",
      "visualType": "pool_table",
      "linkedMenuItemId": "menu-123",
      "linkedMenuItem": {
        "id": "menu-123",
        "name": "Pool Table",
        "price": 15,
        "blockTimeMinutes": 60
      },
      "sectionId": "section-1",
      "section": { "id": "section-1", "name": "Game Room", "color": "#6366f1" },
      "posX": 200,
      "posY": 150,
      "width": 140,
      "height": 80,
      "rotation": 45,
      "status": "available",
      "waitlistCount": 2,
      "waitlistEntries": [...]
    }
  ]
}
```

### POST /api/floor-plan-elements

Create a new element.

**Request Body:**
```json
{
  "locationId": "loc-1",
  "sectionId": "section-1",
  "name": "Pool Table 1",
  "visualType": "pool_table",
  "linkedMenuItemId": "menu-123",
  "width": 140,
  "height": 80,
  "posX": 200,
  "posY": 150
}
```

### PUT /api/floor-plan-elements/[id]

Update element properties including position, size, rotation, and status.

### DELETE /api/floor-plan-elements/[id]

Soft delete an element (sets `deletedAt`), making the linked menu item available for placement again.

## Components

### AddEntertainmentPalette

Bottom sheet palette for adding entertainment elements to the floor plan.

**Features:**
- Lists only menu items from `categoryType: 'entertainment'`
- Filters out already-placed items
- Auto-detects visual type from item name
- Two-step selection: choose item, then choose visual style

**Props:**
```typescript
interface AddEntertainmentPaletteProps {
  isOpen: boolean
  onClose: () => void
  locationId: string
  selectedSectionId: string | null
  placedMenuItemIds: string[]  // IDs of already-placed items
  onAddElement: (element: {
    name: string
    visualType: EntertainmentVisualType
    linkedMenuItemId: string
    width: number
    height: number
  }) => void
}
```

### FloorPlanEntertainment

Renders an entertainment element on the floor plan canvas.

**Features:**
- Status-based glow effects
- Independent rotation (visual rotates, label stays horizontal)
- Resize handles (admin mode)
- Extended rotation handle (40px stem, 24px handle) for easier grabbing
- Time remaining badge for in-use status
- Waitlist count badge
- Delete button with confirmation

**Props:**
```typescript
interface FloorPlanEntertainmentProps {
  element: FloorPlanElement
  isSelected: boolean
  mode: 'admin' | 'service'
  onSelect: () => void
  onPositionChange?: (posX: number, posY: number) => void
  onSizeChange?: (width: number, height: number) => void
  onRotationChange?: (rotation: number) => void
  onDelete?: () => void
}
```

### EntertainmentVisual

SVG component that renders the appropriate visual based on `visualType`.

```typescript
interface EntertainmentVisualProps {
  visualType: EntertainmentVisualType
  width: number
  height: number
  status: ElementStatus
  fillColor?: string
  strokeColor?: string
}
```

## Floor Plan Store Integration

### State Additions

```typescript
interface FloorPlanState {
  elements: FloorPlanElement[]
  selectedElementId: string | null

  // Actions
  setElements: (elements: FloorPlanElement[]) => void
  addElement: (element: FloorPlanElement) => void
  updateElement: (elementId: string, updates: Partial<FloorPlanElement>) => void
  updateElementPosition: (elementId: string, posX: number, posY: number) => void
  updateElementSize: (elementId: string, width: number, height: number) => void
  deleteElement: (elementId: string) => void
  selectElement: (elementId: string | null) => void
}
```

## Rotation Behavior

### Visual-Only Rotation

The rotation is applied only to the SVG visual container, not the entire element:

```tsx
{/* SVG Visual - rotates independently */}
<div style={{ transform: `rotate(${element.rotation}deg)` }}>
  <EntertainmentVisual ... />
</div>

{/* Label - stays fixed at bottom */}
<div>
  <span>{element.name}</span>
</div>
```

### Rotation Handle

- **Position**: 62px above element center
- **Stem**: 40px tall, 2px wide indigo line
- **Handle**: 24px diameter circle with rotation icon
- **Snapping**: 15-degree increments for easy alignment

## Filtering Logic

Elements without a room assignment (`sectionId: null`) always display regardless of the selected room filter:

```typescript
const filteredElements = selectedSectionId
  ? elements.filter((el) => el.sectionId === selectedSectionId || el.sectionId === null)
  : elements
```

This ensures newly placed elements are visible before being assigned to a room.

## Files

### Created
- `src/components/floor-plan/entertainment-visuals.tsx` - SVG visual components
- `src/components/floor-plan/AddEntertainmentPalette.tsx` - Add entertainment modal
- `src/components/floor-plan/FloorPlanEntertainment.tsx` - Element renderer
- `src/app/api/floor-plan-elements/route.ts` - List/create API
- `src/app/api/floor-plan-elements/[id]/route.ts` - Get/update/delete API

### Modified
- `prisma/schema.prisma` - FloorPlanElement model
- `src/components/floor-plan/use-floor-plan.ts` - Element state management
- `src/app/(admin)/floor-plan/page.tsx` - Floor plan integration

## Usage Flow

1. **Setup**: Create entertainment menu items in Menu Builder with `categoryType: 'entertainment'`

2. **Place**: Open floor plan → Click "Add Entertainment" → Select item → Choose visual → Add to floor plan

3. **Position**: Drag element to desired location, resize with corner handles, rotate with top handle

4. **Manage**: Element status automatically syncs when sessions start/end via the ordering system

5. **Delete**: Click element → Delete button → Confirm → Item becomes available for re-placement

## Related Skills

- **Skill 81**: Timed Rentals - Core timed rental system with session management
- **Skill 106**: Interactive Floor Plan (SVG) - Base floor plan infrastructure
- **Skill 16**: Table Layout - Table placement (elements follow same patterns)
