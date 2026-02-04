# Skill 207: Table Resize & Rotation

## Overview
Interactive table manipulation in Floor Plan Editor with resize handles and rotation controls.

## Status: COMPLETE (Feb 4, 2026)

## Features

### Table Resize (✅ Complete)
- 8 resize handles: 4 corners + 4 edges
- Corner handles: resize both dimensions
- Edge handles: resize single dimension
- Grid snapping during resize
- Collision detection (fixtures + other tables)
- Shape-specific minimum sizes
- Aspect ratio lock for round/square tables

### Minimum Sizes by Shape
| Shape | Min Width | Min Height |
|-------|-----------|------------|
| bar | 80px | 30px |
| booth | 60px | 80px |
| round | 50px | 50px |
| square | 50px | 50px |
| oval | 60px | 40px |
| rectangle | 60px | 40px |

### Table Rotation (✅ Complete)
- Rotation handle: 40px stem above table
- Drag handle to rotate freely
- Shift+drag: snap to 15° increments
- Handle counter-rotates to stay upright
- Rotation persists to database
- Seats rotate with table visually

## Known Issues
- [x] ~~Seats don't reflow when table is resized~~ - FIXED (Worker 11)
- [x] ~~Bar tables may have resize constraint issues~~ - FIXED (Worker 12)

## Key Files
```
src/domains/floor-plan/admin/TableRenderer.tsx - Handles UI
src/domains/floor-plan/admin/EditorCanvas.tsx - Resize/rotation logic
```

## Visual Design
```
Resize handles (white squares, blue border):
  [NW]----[N]----[NE]
    |              |
   [W]   TABLE    [E]
    |              |
  [SW]----[S]----[SE]

Rotation handle (above table):
        ●  ← 12px circle
        │
        │  ← 30px stem (blue)
   ┌────┴────┐
   │  TABLE  │
   └─────────┘
```

## Dependencies
- Skill 16: Table Layout

## Related Skills
- Skill 206: Seat Management System
