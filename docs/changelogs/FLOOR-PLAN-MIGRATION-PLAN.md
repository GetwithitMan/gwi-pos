# Floor Plan Migration Plan

## Overview

Replace the old floor plan system with the new domain-based implementation:
- **Backend Editor**: `/floor-plan` → New `FloorPlanEditor` from `src/domains/floor-plan/admin/`
- **FOH View**: `/orders` floor plan panel → New `FloorPlanHome` from `src/components/floor-plan/`

## Current State Analysis

### Old System (Production - `/floor-plan`)
| Component | Location | Features |
|-----------|----------|----------|
| Page | `src/app/(admin)/floor-plan/page.tsx` | 2035 lines, monolithic |
| Store | `src/components/floor-plan/index.ts` (useFloorPlanStore) | Zustand store |
| Tables | `src/components/floor-plan/FloorPlanTable.tsx` | Basic table rendering |
| Entertainment | `src/components/floor-plan/FloorPlanEntertainment.tsx` | Entertainment elements |
| Sidebar | `src/components/floor-plan/PropertiesSidebar.tsx` | Property editing |
| Styling | Inline CSS, dark slate theme | `#0f172a` → `#1e293b` gradient |

### New System (Test - `/test-floorplan`)
| Component | Location | Features |
|-----------|----------|----------|
| Editor Page | `src/app/test-floorplan/editor/page.tsx` | Clean wrapper |
| Editor | `src/domains/floor-plan/admin/FloorPlanEditor.tsx` | Modular, database mode |
| Canvas | `src/domains/floor-plan/admin/EditorCanvas.tsx` | Tools, grid, snapping |
| FOH Page | `src/app/test-floorplan/page.tsx` | Virtual combining test |
| FOH View | `src/components/floor-plan/FloorPlanHome.tsx` | Order integration |
| Styling | Light theme with grid | White background |

## Theme Requirements

### Dark Theme (Current Production Style)
```css
/* Background gradient */
background: linear-gradient(180deg, #0f172a 0%, #1e293b 100%);

/* Canvas */
background: rgba(15, 23, 42, 0.6);
border: 1px solid rgba(255, 255, 255, 0.1);

/* Grid pattern */
backgroundImage: radial-gradient(circle, rgba(99, 102, 241, 0.15) 1px, transparent 1px);

/* Tables */
fill: #1e293b (rectangles), #22c55e (circles)
border: 2px solid rgba(255, 255, 255, 0.2)

/* Text */
color: #94a3b8 (muted), #fff (primary)
```

### Light Theme (New Style)
```css
/* Background */
background: #f8fafc (slate-50);

/* Canvas */
background: white;
border: 1px solid #e2e8f0;

/* Grid pattern */
backgroundImage: radial-gradient(circle, #e2e8f0 1px, transparent 1px);

/* Tables */
fill: #d1fae5 (green-100), stroke: #10b981 (green-500)

/* Text */
color: #475569 (slate-600), #1e293b (slate-800)
```

---

## Migration Workers

### Worker 40: Theme System Infrastructure
**Files to Create/Modify:**
- `src/lib/theme.ts` - Theme definitions and CSS variables
- `src/contexts/ThemeContext.tsx` - React context for theme
- `src/hooks/useTheme.ts` - Hook for theme access
- `src/app/globals.css` - CSS variables

**Scope:**
- Define `dark` and `light` theme objects
- Create CSS variables for all colors
- Theme toggle stored in localStorage
- NO component changes - just infrastructure

---

### Worker 41: Editor Page Migration
**Files to Modify:**
- `src/app/(admin)/floor-plan/page.tsx` - REPLACE contents

**Scope:**
- Import `FloorPlanEditor` from `@/domains/floor-plan/admin`
- Keep `AdminPageHeader` and `AdminSubNav`
- Pass `locationId` from auth store
- Add `onExit` handler to navigate back
- Apply theme wrapper

**Key Differences to Handle:**
- Old: Monolithic page with all logic
- New: Clean import of domain component
- Old: Direct Zustand store usage
- New: Props-based, internal state management

---

### Worker 42: EditorCanvas Theme Support
**Files to Modify:**
- `src/domains/floor-plan/admin/EditorCanvas.tsx`
- `src/domains/floor-plan/admin/FloorPlanEditor.tsx`
- `src/domains/floor-plan/admin/TableRenderer.tsx`
- `src/domains/floor-plan/admin/SeatRenderer.tsx`

**Scope:**
- Add `theme` prop to all components
- Use CSS variables or theme object for colors
- Support both dark/light grid patterns
- Table/seat colors adapt to theme

---

### Worker 43: FOH View Migration (Orders Page)
**Files to Modify:**
- `src/app/(pos)/orders/page.tsx` - Replace floor plan section

**Scope:**
- Identify the floor plan rendering section
- Replace with `FloorPlanHome` component
- Wire up callbacks: `onTableSelect`, `onOpenPayment`, etc.
- Ensure order integration works

**Current FOH in /orders:**
- Uses `InteractiveFloorPlan` or similar
- Table click → opens order
- Shows table status (open, occupied, dirty)

**New FOH:**
- `FloorPlanHome` from `/components/floor-plan/`
- Virtual table combining
- Inline ordering support
- Section tabs

---

### Worker 44: FloorPlanHome Theme Support
**Files to Modify:**
- `src/components/floor-plan/FloorPlanHome.tsx`
- `src/app/test-floorplan/page.tsx`

**Scope:**
- Add `theme` prop
- Apply CSS variables for all colors
- Table rendering uses theme colors
- Seat colors adapt to theme
- Virtual group colors work in both themes

---

### Worker 45: Cleanup Legacy Code
**Files to ARCHIVE/DELETE:**
- `src/app/test-floorplan/` - Move useful parts, delete test page
- Legacy components no longer needed after migration

**Scope:**
- Identify dead code paths
- Archive any useful utilities
- Remove test pages
- Update imports throughout codebase

---

## File Mapping

### Keep (Shared Components)
| File | Notes |
|------|-------|
| `src/components/floor-plan/FloorPlanHome.tsx` | FOH view - enhance |
| `src/components/floor-plan/RoomTabs.tsx` | Section tabs |
| `src/components/floor-plan/AddRoomModal.tsx` | Room creation |
| `src/components/floor-plan/PropertiesSidebar.tsx` | Table properties |

### Replace
| Old | New |
|-----|-----|
| `src/app/(admin)/floor-plan/page.tsx` (monolithic) | Import `FloorPlanEditor` |
| FOH in `/orders` | `FloorPlanHome` |

### New Domain Components (Already Built)
| File | Purpose |
|------|---------|
| `src/domains/floor-plan/admin/FloorPlanEditor.tsx` | Main editor |
| `src/domains/floor-plan/admin/EditorCanvas.tsx` | Canvas with tools |
| `src/domains/floor-plan/admin/TableRenderer.tsx` | Table shapes |
| `src/domains/floor-plan/admin/SeatRenderer.tsx` | Seat circles |
| `src/domains/floor-plan/admin/FixtureToolbar.tsx` | Tool selection |
| `src/domains/floor-plan/groups/perimeterSeats.ts` | Virtual seat positioning |

---

## API Compatibility

Both systems use the same APIs:
- `GET/POST /api/tables`
- `PUT/DELETE /api/tables/[id]`
- `GET/POST /api/sections`
- `GET/POST /api/floor-plan-elements`

No API changes required.

---

## Testing Checklist

### Editor (`/floor-plan`)
- [ ] Create new table
- [ ] Drag table to reposition
- [ ] Resize table
- [ ] Rotate table
- [ ] Add/remove seats
- [ ] Change table shape
- [ ] Add room/section
- [ ] Switch rooms
- [ ] Add entertainment element
- [ ] Save positions
- [ ] Reset to default

### FOH View (`/orders`)
- [ ] View all tables
- [ ] Table status colors (available, occupied, dirty)
- [ ] Click table to start order
- [ ] Virtual table combining
- [ ] Perimeter seat numbering
- [ ] Split combined tables
- [ ] Section filtering
- [ ] Real-time updates

### Theme
- [ ] Dark mode matches production style
- [ ] Light mode is clean and readable
- [ ] Toggle persists across sessions
- [ ] All components respect theme

---

## Rollback Plan

If issues arise:
1. Keep old `page.tsx` as `page.old.tsx`
2. Feature flag: `USE_NEW_FLOOR_PLAN=true/false`
3. Conditional import based on flag

---

## Timeline Estimate

| Worker | Effort | Dependencies |
|--------|--------|--------------|
| 40: Theme Infrastructure | 2-3 hours | None |
| 41: Editor Page Migration | 2-3 hours | Worker 40 |
| 42: EditorCanvas Theme | 2-3 hours | Worker 40 |
| 43: FOH Migration | 3-4 hours | Worker 40, 44 |
| 44: FloorPlanHome Theme | 2-3 hours | Worker 40 |
| 45: Cleanup | 1-2 hours | All others |

**Total: ~15-18 hours of focused work**
