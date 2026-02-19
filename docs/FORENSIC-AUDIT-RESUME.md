# Forensic Audit — Resume Point

**Last saved:** February 19, 2026
**Trigger phrase:** "finish forensic audit"
**Full audit report:** `docs/FORENSIC-AUDIT-2026-02-18.md`

---

## Completed Waves

| Wave | Description | Tasks | Status |
|------|-------------|-------|--------|
| 1 | Initial Scan Fixes (soft deletes, sockets, console.log, UX) | 10 | ✅ |
| 2 | Deep Audit (deletedAt middleware, hard deletes, sockets, indexes) | 6 | ✅ |
| 3 | Performance & Security (locationId, cache, N+1, memo, security) | 7 | ✅ |
| 4 | Backlog Cleanup (dead sockets, TODOs, N+1, UX, dead code) | 7 | ✅ |
| 5 | Schema Cleanup & Hook Extraction | 3 | ✅ |
| Hotfix | Post-Wave 5 Live Testing (8 runtime bugs) | 8 | ✅ |
| 6A | Hook Extractions (usePaymentFlow, useModifierModal, useItemOperations, useComboBuilder) | 4 | ✅ |
| 6B | Void Flow Simplification (5-6 taps → 3) | 2 | ✅ |
| 6C | Quick Tab + Payment Skip + Clickable Seats | 3 | ✅ |
| 6D | Same Again + Split Evenly | 2 | ✅ |
| 6E | Multi-Card Tab Support (7 sub-fixes) | 7 | ✅ |
| 6E-HF | Deleted Items Reappearing (Prisma nested include bug) | 1 | ✅ |
| 6F | Ingredient Modifications Fix (5 query paths) | 5 | ✅ |
| 6G | Hook Wiring + New Extractions (56→30 useState) | 7 | ✅ |
| 6H | API Response Format Normalization (460+ violations) | 5 | ✅ |
| 6H-HF | Client-Side Response Unwrapping (150+ fixes in 120 files) | 3 | ✅ |
| 7 | Missing Socket Dispatches (48 routes, 530 lines added) | 4 | ✅ |
| 8 | Large File Splits (4 files → 15 new modules, ~4,200 lines extracted) | 4 | ✅ |
| 8B | Remaining File Splits (6 files → 22 new modules, inventory fully decomposed) | 4 | ✅ |

**Total completed:** 92 tasks, 1700+ individual fixes across 580+ files

---

## Remaining Backlog (What "finish forensic audit" should pick up)

### Priority 1 — Bug Fixes & Data Integrity
- None currently known

### Priority 2 — Code Quality
1. ~~**Response format normalization**~~ — ✅ DONE (Wave 6H: 460+ responses normalized across 260 files)
2. **orders/page.tsx** — Now at 30 useState calls (down from 56 in Wave 6G). Remaining states are mostly independent UI toggles — further extraction has diminishing returns.

### Priority 3 — Large File Splits
✅ **Wave 8 split 4 of 10 files** (the 4 largest):
| Before | After | File | Status |
|-------:|------:|------|--------|
| 3,753 | ~3,100 | `app/(pos)/orders/page.tsx` | ✅ Split (modal layer + hook extracted) |
| 2,754 | ~1,480 | `components/menu/ItemEditor.tsx` | ✅ Split (4 hooks + types extracted) |
| 2,602 | ~1,800 | `domains/floor-plan/admin/EditorCanvas.tsx` | ✅ Split (4 pure modules extracted) |
| 2,173 | ~730 | `components/hardware/ReceiptVisualEditor.tsx` | ✅ Split (hook + 3 components extracted) |

**Wave 8B split remaining 6 files:**
| Before | After | File | Status |
|-------:|------:|------|--------|
| 2,711 | ~2,560 | `components/floor-plan/FloorPlanHome.tsx` | ✅ Split (MenuItem + modals hook) |
| 2,087 | barrel | `lib/inventory-calculations.ts` | ✅ Split (8 modules under lib/inventory/) |
| 1,951 | ~1,820 | `components/bartender/BartenderView.tsx` | ✅ Split (FavoriteItem + settings) |
| 1,620 | ~1,000 | `app/(admin)/liquor-builder/page.tsx` | ✅ Split (3 modals + types) |
| 1,602 | ~400 | `app/(admin)/pizza/page.tsx` | ✅ Split (6 tabs + 5 modals + types) |
| 1,558 | ~1,373 | `domains/floor-plan/admin/FloorPlanEditor.tsx` | ✅ Split (db-conversion) |

All 10 original large files have been split. Some handler extractions were skipped where cross-dependencies made extraction impractical without major refactoring.

### Priority 4 — Socket & UX
- ~~~129 missing socket dispatches~~ — ✅ DONE (Wave 7: 48 routes fixed, 530 lines added across orders, menu, employees, shifts, ingredients, liquor, tables)
- Remaining UX friction points from audit (transfer tab shortcut, last order recall, menu search keyboard shortcut, etc.)

---

## Key Architecture Notes for Resume

### Dual Pricing
- Items stored at CASH price in DB
- Card price = cash × (1 + cashDiscountPercent/100)
- Default display = card price (higher)

### Prisma $extends Limitation
- Auto-injects `deletedAt: null` on TOP-LEVEL reads only
- Nested `include` relations MUST have explicit `where: { deletedAt: null }`
- This was the root cause of the "deleted items reappearing" bug

### Critical File Paths
- Orders page: `src/app/(pos)/orders/page.tsx`
- Bartender view: `src/components/bartender/BartenderView.tsx`
- Order API: `src/app/api/orders/[id]/route.ts`
- Items API: `src/app/api/orders/[id]/items/route.ts`
- Payment modal: `src/components/payment/PaymentModal.tsx`
- Response mapper: `src/lib/api/order-response-mapper.ts`
- Socket dispatch: `src/lib/socket-dispatch.ts`

### Custom Hooks (extracted during audit)
- `src/hooks/usePaymentFlow.ts` — 7 payment states
- `src/hooks/useModifierModal.ts` — 5 modifier states
- `src/hooks/useItemOperations.ts` — 5 item operation states
- `src/hooks/useComboBuilder.ts` — 4 combo states
- `src/hooks/useSplitTickets.ts` — 13 split states
- `src/hooks/useShiftManagement.ts` — 5 shift states
- `src/hooks/useTimedRentals.ts` — 7 timed rental states
- `src/app/(pos)/orders/useOrderPageModals.ts` — modal visibility state (Wave 8)
- `src/components/menu/useIngredientOperations.ts` — ingredient CRUD (Wave 8)
- `src/components/menu/useModifierGroupManager.ts` — modifier group CRUD (Wave 8)
- `src/components/menu/useModifierEditor.ts` — modifier operations (Wave 8)
- `src/components/menu/useIngredientCreation.ts` — inline ingredient creation (Wave 8)
- `src/components/hardware/usePrintTemplateEditor.ts` — receipt settings + undo/redo (Wave 8)

---

## How to Resume

When the user says **"finish forensic audit"**, read this file and `docs/FORENSIC-AUDIT-2026-02-18.md`, then:

1. Check the **Remaining Backlog** section above for next priorities
2. Start with the highest priority incomplete items
3. Follow the wave pattern: research → fix → commit → update audit doc
4. Save to git after every phase
5. Update this resume file with new completion status
