# Skill 259: Cash Tip Declaration & Compliance

**Status:** DONE
**Domain:** Tips & Tip Bank
**Date:** 2026-02-10
**Dependencies:** Skill 250 (Tip Ledger Foundation)
**Phase:** Tip Bank Phase 10

## Overview

Cash tip declaration step at shift closeout with IRS 8% rule compliance warnings. Compliance guardrails are pure functions that return warnings (never blocking). Manager can override declarations with reason tracking.

## What Was Built

### Schema (prisma/schema.prisma)
- `CashTipDeclaration` — Per-shift cash tip declaration:
  - `employeeId`, `shiftId`, `amountCents`
  - `source`: 'employee' (self-declared) or 'manager_override'
  - `overrideReason`, `overrideBy` — For manager overrides
  - `declaredAt` — When declared

### Domain Logic (src/lib/domain/tips/tip-compliance.ts, ~270 lines)
- `checkTipOutCap()` — Warns if tip-out percentage exceeds configurable threshold
- `checkPoolEligibility()` — Warns if managers are in pools when allowManagerInPools=false
- `checkDeclarationMinimum()` — IRS 8% rule: warns if declared cash tips < 8% of shift sales
- `runComplianceChecks()` — Runs all checks, returns array of ComplianceWarning objects
- `formatCentsForDisplay()` — Helper for compliance warning messages

### Types
- `ComplianceWarningLevel` — 'info' | 'warning' | 'critical'
- `ComplianceWarning` — { level, code, message, details }
- `ComplianceCheckResult` — { passed, warnings[] }
- `ShiftComplianceData` — Shift data needed for compliance checks
- `TipOutCheckData` — Data for tip-out cap check
- `PoolEligibilityData` — Data for pool eligibility check

### API Routes
- `POST /api/tips/cash-declarations` — Create cash tip declaration
  - Body: { locationId, employeeId, shiftId, amountCents, source?, overrideReason?, overrideBy? }
  - Self-access or tips.manage_settings for manager override
- `GET /api/tips/cash-declarations` — Declaration history
  - Query: locationId, employeeId?, shiftId?, dateFrom?, dateTo?, limit, offset

### Key Design Decisions
- **Compliance checks are advisory** — They return warnings but never prevent operations
- **Manager override with reason** — Transparent audit trail for overridden declarations
- **IRS 8% rule** — Standard threshold, but configurable per location
- **Pure functions** — All compliance logic is pure, no database interaction

## Files Created
- `src/lib/domain/tips/tip-compliance.ts`
- `src/app/api/tips/cash-declarations/route.ts`

## Files Modified
- `prisma/schema.prisma` — CashTipDeclaration model
- `src/lib/domain/tips/index.ts` — Barrel exports

## Verification
1. Cash declaration POST creates record with correct employee/shift
2. IRS 8% warning triggers when declared < 8% of shift sales
3. Manager override with reason tracked correctly
4. Compliance checks return warnings array (not blocking)
5. Pool eligibility enforces allowManagerInPools setting
6. All compliance functions are pure (no DB calls)
