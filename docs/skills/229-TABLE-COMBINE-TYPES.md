# Skill 229: Table Combine Types (Physical vs Virtual)

## Overview

There are **two distinct ways** to combine tables on the floor plan. They use different APIs, different database fields, and produce different seat numbering behavior in the order panel. Mixing them up breaks the seat display.

---

## The Two Types

### 1. Physical Combine (Drag-Drop)

**User action:** Drag one table onto another.

**What happens:**
- Tables physically snap together (magnetic positioning)
- All seats are **renumbered 1..N clockwise** around the combined perimeter
- Orders are merged into one
- The combined table shows as one unit (e.g., "T4+T5")

**Database fields set:**
- `Table.combinedWithId` on the child table (points to primary)
- `Table.combinedTableIds` on the primary table (array of child IDs)
- `Table.originalPosX/Y` saved for undo
- `Table.originalName` saved for undo
- `Table.capacity` updated to sum of both

**API:** `POST /api/tables/combine`

**Seat display in order panel:** Flat sequential list: `Seat 1, Seat 2, ... Seat 10`

**Code path (FloorPlanHome.tsx):**
- `handleTableCombine()` -> calls `/api/tables/combine`
- Seat rendering: the `else` branch at the `activeTable.virtualGroupId ?` ternary
- `getTotalSeats()` sums seats from primary + all children via `combinedTableIds`

---

### 2. Virtual Group (Long-Hold Select)

**User action:** Long-hold a table to enter virtual combine mode, then tap tables to add to group, then confirm.

**What happens:**
- Tables stay in their original positions (no physical movement)
- Each table **keeps its own seat numbering** (T4: S1-S5, T5: S1-S5)
- Tables are color-linked with a shared group color
- Orders can be shared across the group but seats remain per-table

**Database fields set:**
- `Table.virtualGroupId` (shared UUID for all tables in group)
- `Table.virtualGroupPrimary` (true on one table)
- `Table.virtualGroupColor` (shared color)
- `Table.virtualGroupOffsetX/Y` (optional visual offsets)

**API:** `POST /api/tables/virtual-combine`

**Seat display in order panel:** Grouped by table with labels: `T4: [1] [2] [3] [4] [5]  T5: [1] [2] [3] [4] [5]`

**Code path (FloorPlanHome.tsx):**
- `handleConfirmVirtualCombine()` -> calls `/api/tables/virtual-combine`
- Seat rendering: the `if (activeTable.virtualGroupId)` branch
- `getTotalSeats()` sums all tables in group via `getVirtualGroupTables()`

---

## How They Broke (History)

At some point, `handleTableCombine()` was changed from calling `/api/tables/combine` (physical) to `/api/tables/virtual-combine` (virtual). This caused drag-drop to create virtual groups instead of physical combines, so:

- Seats showed as "T4-S1, T4-S2, T5-S1..." instead of "1, 2, 3, 4, 5, 6, 7, 8, 9, 10"
- The `virtualGroupId` branch rendered instead of the flat seat list
- Users saw grouped-by-table seat numbering instead of incremental

**Fix:** Restore `handleTableCombine()` to call `/api/tables/combine`.

---

## Key Code Locations

| What | File | Function/Line |
|------|------|---------------|
| Drag-drop handler | `FloorPlanHome.tsx` | `handleTableCombine()` |
| Long-hold handler | `FloorPlanHome.tsx` | `handleConfirmVirtualCombine()` |
| Physical combine API | `src/app/api/tables/combine/route.ts` | `POST` handler |
| Virtual combine API | `src/app/api/tables/virtual-combine/route.ts` | `POST` handler |
| Seat count calc | `FloorPlanHome.tsx` | `getTotalSeats()` |
| Seat grouping | `FloorPlanHome.tsx` | `groupedOrderItems` useMemo |
| Seat panel format | `FloorPlanHome.tsx` | `seatGroupsForPanel` useMemo |
| Seat button render | `FloorPlanHome.tsx` | `activeTable.virtualGroupId ?` ternary |
| Table interface | `use-floor-plan.ts` | `FloorPlanTable` interface |

---

## Quick Diagnostic

If seats aren't showing as 1-10 after dragging tables together:

1. **Check which API is being called.** Open browser dev tools > Network tab. Drag two tables together. You should see `POST /api/tables/combine`. If you see `POST /api/tables/virtual-combine`, that's the bug — `handleTableCombine()` is calling the wrong endpoint.

2. **Check the database fields.** After combining, the primary table should have `combinedTableIds` populated and `virtualGroupId` should be NULL. If `virtualGroupId` is set, a virtual group was created instead of a physical combine.

3. **Check the rendering branch.** The ternary `activeTable.virtualGroupId ?` determines which seat layout renders. Physical combines should hit the `else` branch (flat list). If `virtualGroupId` is set, it hits the wrong branch.

---

## Rules

- `handleTableCombine` must ALWAYS call `/api/tables/combine` (physical)
- `handleConfirmVirtualCombine` must ALWAYS call `/api/tables/virtual-combine` (virtual)
- Never swap these. The APIs set different database fields and the UI renders differently based on which fields are set.
- Physical combine = `combinedWithId` + `combinedTableIds` = flat seats 1..N
- Virtual group = `virtualGroupId` + `virtualGroupPrimary` = per-table seats
