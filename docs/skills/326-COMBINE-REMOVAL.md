# Skill 326: Complete Combine/Virtual-Group Removal

## Status: DONE
## Domain: Floor Plan
## Date: February 11, 2026

## Summary

Removed ALL combine functionality (both physical and virtual) from the entire codebase. Tables are now standalone entities — no combining, no grouping, no perimeter seats.

## What Was Removed

### API Routes Deleted (410 Gone)
- `/api/tables/virtual-combine/` (all sub-routes: add, dissolve, remove, set-primary, transfer, active)
- `/api/tables/combine/` — gutted to 410 Gone stub
- `/api/tables/virtual-group/` — gutted to 410 Gone stub
- `/api/seats/bulk-operations/` — gutted to 410 Gone stub
- `/api/tables/seats/reflow/` — gutted to 410 Gone stub

### Components Deleted
- `VirtualCombineBar.tsx` — combine mode UI bar
- `VirtualGroupManagerModal.tsx` — group management modal
- `ExistingOrdersModal.tsx` — order transfer on combine
- `ManagerGroupDashboard.tsx` — admin group overview
- `GroupSummary.tsx` — payment group summary

### Domain Code Deleted
- `src/domains/floor-plan/groups/` — entire directory (perimeterSeats.ts, dragCombine.ts, snapEngine.ts, mergeLogic.ts, virtualGroup.ts, colorPalette.ts, tableGroupAPI.ts, types.ts, CrossRoomBadge.tsx, TableGroup.tsx, tests)
- `src/domains/floor-plan/services/group-service.ts`
- `src/domains/floor-plan/hooks/useTableGroups.ts`
- `src/domains/floor-plan/seats/test-seats.ts`
- `src/lib/virtual-group-colors.ts`
- `src/lib/virtual-group-seats.ts`

### Scripts Deleted
- `scripts/backfill-virtual-group-colors.ts`
- `scripts/test-perimeter*.ts` (4 files)

### Files Cleaned (combine refs removed)
- `FloorPlanHome.tsx` — removed ~1200 lines of combine logic
- `TableNode.tsx`, `TableShape.tsx`, `FloorPlanTable.tsx` — removed group styling/borders
- `InteractiveFloorPlan.tsx`, `UnifiedFloorPlan.tsx` — removed group props
- `use-floor-plan.ts`, `useFloorPlanDrag.ts` — removed combine handlers
- `table-geometry.ts` — reduced from 1014 to ~350 lines
- `table-utils.ts` — removed group helper functions
- `order-router.ts`, `print-factory.ts`, `print-template-factory.ts` — removed group references
- `ExpoScreen.tsx`, `PitBossDashboard.tsx` — removed group display
- `SplitCheckModal.tsx`, `Receipt.tsx` — removed group payment logic
- Various type files, bridges, stores cleaned

## DB Schema Note

`combinedWithId` / `combinedTableIds` columns still exist in the Prisma schema but are always null. Not worth a migration to remove.

## Net Impact
- **116 files changed**
- **-16,211 lines deleted**, +643 lines added
- Zero TypeScript errors after cleanup

## Key Files
- All files listed above
- `CLAUDE.md` memory section updated with combine removal notes
