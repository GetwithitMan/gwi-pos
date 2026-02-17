# Skill 354: Table Shape Standardization

**Date:** February 16, 2026
**Commit:** `ed3a917`
**Domain:** Floor Plan
**Status:** Complete

## Problem

The codebase had inconsistent table shape vocabulary across 18+ files. The database schema defines 5 canonical shapes (`rectangle`, `circle`, `square`, `booth`, `bar`), but domain types, editor code, seat generation, and API routes used non-canonical values like `round`, `oval`, `hexagon`, `bar_seat`, `high_top`, and `custom`.

This caused shape mismatches when creating tables in the editor vs rendering them on the POS floor plan.

## Solution

Unified all table shape references to the 5 DB-canonical values across the entire codebase.

### Files Modified (18 files, ~90 deletions)

| File | Change |
|------|--------|
| `src/domains/floor-plan/shared/types.ts` | `TableShape` type: removed `round`, `oval`, `hexagon`, `custom` → added `circle`, `booth`, `bar` |
| `src/domains/floor-plan/types/index.ts` | Removed `round`, `oval`, `bar_seat`, `high_top`, `custom` |
| `src/domains/floor-plan/index.ts` | `TABLE_SHAPES` array updated to 5 canonical values |
| `src/domains/floor-plan/services/seat-service.ts` | Removed `case 'round':` and `case 'bar_seat':` |
| `src/lib/seat-generation.ts` | `round` → `circle`, removed `oval` (circle handles ellipses via width/height) |
| `src/app/api/internal/provision/route.ts` | Seed data: `round` → `circle` |
| `src/app/api/tables/[id]/seats/reflow/route.ts` | `round || oval` → `circle`, oval detection via `width !== height` |
| `src/app/api/tables/[id]/seats/auto-generate/route.ts` | Type cast updated |
| `src/app/api/tables/[id]/seats/generate/route.ts` | Type cast updated |
| `src/app/api/tables/seats/generate-all/route.ts` | Type cast updated |
| `src/domains/floor-plan/admin/EditorCanvas.tsx` | Removed `case 'oval':` from minimum size switch |
| `src/domains/floor-plan/admin/types.ts` | Already correct (fixed in prior session) |
| `src/domains/floor-plan/seats/seatLayout.ts` | `hexagon` → `booth`, `custom` → `bar` |
| `src/domains/floor-plan/tables/Table.tsx` | Removed hexagon SVG path case |
| `src/domains/floor-plan/services/table-service.ts` | Removed `high_top` from mapShape() |
| `src/domains/floor-plan/seats/README.md` | Documentation updated |

### Key Decisions

- **`round` → `circle`**: Direct mapping, DB column stores `circle`
- **`oval` eliminated**: `circle` with different width/height handles ellipses — ellipse detection uses `width !== height` instead of shape check
- **`hexagon` → `booth`**: Hexagon was unused in practice, booth uses same circular seat distribution
- **`bar_seat` / `high_top` / `custom` eliminated**: Not in DB schema, were dead code paths

## Verification

- `npx tsc --noEmit` — clean
- `grep -rn "round\|oval\|hexagon\|bar_seat\|high_top\|custom" src/domains/floor-plan/` — zero matches (excluding comments)
