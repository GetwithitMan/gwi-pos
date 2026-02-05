# Worker 45: Cleanup Legacy Floor Plan Code

You are a DEVELOPER cleaning up legacy floor plan code after migration is complete.

## Context

After Workers 40-44 complete the migration, there will be dead code that needs cleanup. This worker removes unused files and consolidates the codebase.

## Prerequisites

⚠️ **This worker should ONLY run after Workers 40-44 are complete and verified working.**

## Files to Analyze

Before deleting, verify these files are no longer imported:

```
═══════════════════════════════════════════════════════════════════
⚠️  VERIFY IMPORTS BEFORE ANY DELETION
═══════════════════════════════════════════════════════════════════
```

Run this command to check imports:
```bash
grep -r "test-floorplan" src/ --include="*.ts" --include="*.tsx" | grep -v "test-floorplan/"
```

## Files to Delete (After Verification)

### Test Page Files

These are test pages that should be removed after migration:

1. `src/app/test-floorplan/page.tsx` - Test FOH view
2. `src/app/test-floorplan/editor/page.tsx` - Test editor
3. `src/app/test-floorplan/editor/page-simple-working.tsx` - Old backup
4. `src/app/test-floorplan/api/page.tsx` - Test API page
5. `src/app/test-floorplan/sampleData.ts` - Sample data for tests

### Backup Files

After confirming production works:

1. `src/app/(admin)/floor-plan/page.old.tsx` - Old page backup (if created)

## Files to KEEP

Do NOT delete these - they are part of the new system:

### Domain Components (KEEP)
- `src/domains/floor-plan/admin/*` - All admin editor components
- `src/domains/floor-plan/groups/*` - Virtual combining logic
- `src/domains/floor-plan/hooks/*` - Shared hooks
- `src/domains/floor-plan/services/*` - Service layer
- `src/domains/floor-plan/canvas/*` - Canvas utilities
- `src/domains/floor-plan/seats/*` - Seat logic
- `src/domains/floor-plan/tables/*` - Table logic

### Shared Components (KEEP)
- `src/components/floor-plan/FloorPlanHome.tsx` - FOH view
- `src/components/floor-plan/RoomTabs.tsx` - Section tabs
- `src/components/floor-plan/AddRoomModal.tsx` - Room creation
- `src/components/floor-plan/PropertiesSidebar.tsx` - Property editing
- `src/components/floor-plan/FloorPlanTable.tsx` - Table rendering
- `src/components/floor-plan/FloorPlanEntertainment.tsx` - Entertainment
- `src/components/floor-plan/AddEntertainmentPalette.tsx` - Entertainment palette

### Theme System (KEEP)
- `src/lib/theme.ts` - Theme definitions
- `src/contexts/ThemeContext.tsx` - Theme provider
- `src/hooks/useTheme.ts` - Theme hook

## Cleanup Steps

### Step 1: Verify Production Works

Before any cleanup:
1. Open `/floor-plan` - Editor should work
2. Open `/orders` - FOH view should work
3. Create a table - Should persist
4. Combine tables - Should work
5. Theme toggle - Should work

### Step 2: Search for Dead Imports

```bash
# Check for test-floorplan imports
grep -r "from.*test-floorplan" src/ --include="*.ts" --include="*.tsx"

# Check for sampleData imports
grep -r "sampleData" src/ --include="*.ts" --include="*.tsx"

# Check for old page component imports
grep -r "page.old" src/ --include="*.ts" --include="*.tsx"
```

### Step 3: Delete Test Directory

If no imports found:

```bash
rm -rf src/app/test-floorplan/
```

### Step 4: Delete API Test Route (if exists)

```bash
rm -f src/app/api/test-floorplan/route.ts
```

### Step 5: Delete Backup File

After 1 week of production stability:

```bash
rm -f src/app/(admin)/floor-plan/page.old.tsx
```

### Step 6: Update Route in Next.js Config (if needed)

If there are any route redirects for `/test-floorplan`, remove them.

## Post-Cleanup Verification

1. `npm run build` - No errors
2. `npm run lint` - No unused import errors
3. All floor plan routes work
4. No 404s on floor plan pages

## Documentation Updates

Update these docs to reflect the new structure:

1. `CLAUDE.md` - Update floor plan section
2. `docs/changelogs/FLOOR-PLAN-CHANGELOG.md` - Add migration entry
3. Remove any references to `/test-floorplan`

## Acceptance Criteria

- [ ] Test directory deleted
- [ ] No orphaned imports
- [ ] Build passes
- [ ] Lint passes
- [ ] Production pages still work
- [ ] Documentation updated

## Limitations

- Do NOT delete domain components
- Do NOT delete shared components
- Do NOT delete theme system
- ONLY delete verified unused files
- Keep backups for 1 week minimum
