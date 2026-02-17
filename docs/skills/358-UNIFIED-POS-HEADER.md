# Skill 358: Unified POS Header Component

**Date:** February 17, 2026
**Commit:** `a4c8894`
**Domain:** Orders / UI
**Status:** Complete

---

## Problem

The POS header bar (employee dropdown, view mode tabs, settings gear, search bar, Open Orders badge) was duplicated across FloorPlanHome (~700 lines) and BartenderView (~30 lines). Each copy had slightly different implementations:

1. **FloorPlanHome** owned the full header with employee picker, view tabs (Tables/Takeout/Delivery/Bar Mode), settings gear, search bar, and Open Orders badge — ~700 lines of JSX + logic
2. **BartenderView** had its own minimal header that lacked some features
3. View mode switching required complex coordination between the two headers
4. Adding a new header feature (e.g., a notification bell) meant updating both places

## Solution

### Extraction into UnifiedPOSHeader.tsx

Created `src/components/orders/UnifiedPOSHeader.tsx` as a single shared header component rendered once in `orders/page.tsx` above the view-specific content.

The component encapsulates:
- **Employee dropdown** — current user name + role badge, tap to switch
- **View mode tabs** — Tables, Takeout, Delivery, Bar Mode (configurable per location)
- **Settings gear** — opens order settings panel
- **Search bar** — order/table search with keyboard shortcut
- **Open Orders badge** — count of active orders, opens OpenOrdersPanel

### Ref Callbacks for Cross-View Communication

View-specific actions are exposed via ref callbacks so the header can trigger actions in whichever view is active:

```typescript
// orders/page.tsx passes refs to both header and active view
const quickOrderTypeRef = useRef<(type: string) => void>()
const tablesClickRef = useRef<() => void>()

// Header calls refs on user interaction
<UnifiedPOSHeader
  onQuickOrderType={(type) => quickOrderTypeRef.current?.(type)}
  onTablesClick={() => tablesClickRef.current?.()}
/>

// Active view registers its handlers
<FloorPlanHome
  quickOrderTypeRef={quickOrderTypeRef}
  tablesClickRef={tablesClickRef}
/>
```

### Line Count Reduction

| File | Before | After | Delta |
|------|--------|-------|-------|
| FloorPlanHome.tsx | ~2,100 lines | ~1,400 lines | -700 |
| BartenderView.tsx | ~450 lines | ~420 lines | -30 |
| UnifiedPOSHeader.tsx | N/A | ~700 lines | +700 (new) |
| **Net** | | | **-30 lines** (deduplication) |

The net line reduction is small because the code was extracted rather than deleted — but the duplication is eliminated and future header changes happen in one place.

## Key Files

| File | Changes |
|------|---------|
| `src/components/orders/UnifiedPOSHeader.tsx` | **NEW** — shared header component (~700 lines) |
| `src/app/(pos)/orders/page.tsx` | Renders UnifiedPOSHeader once, passes ref callbacks |
| `src/components/floor-plan/FloorPlanHome.tsx` | Header JSX + logic removed (~700 lines) |
| `src/components/bartender/BartenderView.tsx` | Header removed (~30 lines), uses parent header |

## Verification

1. `npx tsc --noEmit` — clean
2. Floor plan view shows header with all controls (employee, tabs, gear, search, badge)
3. Bar Mode view shows same header — no duplicate or missing controls
4. Switch between views — header persists without flicker or re-mount
5. Open Orders badge updates via socket in both views
6. Settings gear opens panel from both views
7. Employee dropdown works identically in both views
