# Skill 256: Manager Adjustments & Audit Trail

**Status:** DONE
**Domain:** Tips & Tip Bank
**Date:** 2026-02-10
**Dependencies:** Skill 250 (Tip Ledger Foundation), Skill 252 (Dynamic Tip Groups)
**Phase:** Tip Bank Phase 7

## Overview

Managers can make retroactive tip adjustments (fix group membership times, ownership splits, direct tip amounts). Every adjustment creates an auditable record with before/after state. A recalculation engine replays affected allocations and posts delta entries.

## What Was Built

### Schema (prisma/schema.prisma)
- `TipAdjustment` — Audit record:
  - `createdById` — Manager who made the adjustment
  - `reason` — Why the adjustment was made
  - `adjustmentType` — 'group_membership', 'ownership_split', 'clock_fix', 'manual_override', 'tip_amount'
  - `contextJson` — Before/after state snapshot
  - `autoRecalcRan` — Whether recalculation was triggered
  - `entries` → TipLedgerEntry[] — Delta entries from this adjustment

### Domain Logic (src/lib/domain/tips/tip-recalculation.ts, ~600 lines)
- `performTipAdjustment()` — Full flow: create TipAdjustment record → apply changes → run recalculation → post delta entries
- `recalculateGroupAllocations()` — Replay group tip distribution, compute old vs new, post deltas
- `recalculateOrderAllocations()` — Replay order allocation after ownership change
- `getAdjustmentHistory()` — Query adjustments with filters for audit trail

### API Routes
- `GET /api/tips/adjustments` — Adjustment audit trail (location, date range, type filters)
- `POST /api/tips/adjustments` — Create adjustment (requires tips.perform_adjustments permission)

### Key Design Decisions
- **Delta entries, not replacement** — Recalculation posts correction entries, preserving the original entries for audit
- **contextJson** captures full before/after state so any adjustment can be reviewed
- **adjustmentId** on TipLedgerEntry links correction entries back to their adjustment

## Files Created
- `src/lib/domain/tips/tip-recalculation.ts`
- `src/app/api/tips/adjustments/route.ts`

## Files Modified
- `prisma/schema.prisma` — TipAdjustment model
- `src/lib/domain/tips/index.ts` — Barrel exports

## Verification
1. Manager edits group membership joinedAt → recalculation runs → delta entries posted
2. contextJson contains before/after state
3. Only employees with tips.perform_adjustments permission can create adjustments
4. Delta entries link to adjustment via adjustmentId
5. Audit trail shows who, when, what, why for every adjustment
