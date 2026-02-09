# Floor Plan Domain

**Domain ID:** 1
**Status:** Active Development
**Created:** February 9, 2026

## Overview

The Floor Plan domain manages the interactive floor plan canvas, tables, seats, fixtures, sections, and entertainment elements. It handles:
- Floor plan rendering with SVG canvas (zoom, pan, status colors)
- Table management (CRUD, resize, rotation, collision detection)
- Seat management (generation, positioning, virtual group numbering)
- Virtual table combining (physical drag-drop + virtual long-hold)
- Entertainment item placement with visual types
- Floor plan editor for admin layout building
- FloorPlanHome as primary POS interface

## Domain Trigger

```
PM Mode: Floor Plan
```

## Layers

| Layer | Scope | Key Files |
|-------|-------|-----------|
| Canvas | Floor plan rendering | `src/components/floor-plan/FloorPlanHome.tsx` |
| Fixtures | Non-seating elements | `src/app/api/floor-plan-elements/` |
| Tables | Table records | `src/app/api/tables/`, `src/app/api/tables/[id]/` |
| Seats | Seat records | `src/app/api/seats/`, `src/app/api/tables/[id]/seats/` |
| Virtual Groups | Combined table numbering | `src/lib/virtual-group-seats.ts`, `src/app/api/tables/virtual-combine/` |
| Sections | Rooms/areas | `src/app/api/sections/` |
| Editor | Admin floor plan builder | `src/components/floor-plan/FloorPlanEditor.tsx` |
| Entertainment | Floor plan entertainment items | `src/components/floor-plan/entertainment-visuals.tsx` |

## Key Files

| File | Purpose |
|------|---------|
| `src/components/floor-plan/FloorPlanHome.tsx` | Primary POS interface with inline ordering |
| `src/components/floor-plan/FloorPlanEditor.tsx` | Admin layout editor |
| `src/lib/seat-generation.ts` | Seat position generation algorithms |
| `src/lib/virtual-group-seats.ts` | Virtual group seat numbering |
| `src/lib/floorplan/queries.ts` | Floor plan database queries |
| `src/lib/floorplan/serializers.ts` | Data serialization |
| `src/lib/events/table-events.ts` | Table event handling |
| `src/components/floor-plan/entertainment-visuals.tsx` | 12 SVG visual types |

## API Routes

| Route | Method | Purpose |
|-------|--------|---------|
| `/api/tables` | GET/POST | Table CRUD |
| `/api/tables/[id]` | GET/PUT/DELETE | Single table |
| `/api/tables/[id]/seats` | GET/POST | Seat management |
| `/api/tables/virtual-combine` | POST | Virtual table combine |
| `/api/seats` | GET/POST | Seat CRUD |
| `/api/sections` | GET/POST | Section management |
| `/api/floor-plan-elements` | GET/POST | Floor plan elements (entertainment, fixtures) |
| `/api/floor-plan-elements/[id]` | PUT/DELETE | Single element |

## Related Skills

| Skill | Name | Status |
|-------|------|--------|
| 16 | Table Layout | DONE |
| 17 | Table Status | DONE |
| 80 | Floor Plan Editor | DONE |
| 106 | Interactive Floor Plan (SVG) | DONE |
| 107 | Table Combine/Split | DONE |
| 113 | FloorPlanHome Integration | DONE |
| 117 | Virtual Table Combine | DONE |
| 123 | Entertainment Floor Plan | DONE |
| 206 | Seat Management System | DONE |
| 207 | Table Resize & Rotation | DONE |
| 229 | Table Combine Types | DONE |

## Integration Points

- **Orders Domain**: Inline ordering from FloorPlanHome, table assignment
- **Entertainment Domain**: Entertainment items placed on floor plan
- **Events Domain**: Reservation table assignment
- **Payments Domain**: Payment flow initiated from floor plan
