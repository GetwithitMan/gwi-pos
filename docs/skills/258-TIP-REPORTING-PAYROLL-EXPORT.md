# Skill 258: Enhanced Tip Reporting & Payroll Export

**Status:** DONE
**Domain:** Tips & Tip Bank
**Date:** 2026-02-10
**Dependencies:** All previous tip skills (250-257)
**Phase:** Tip Bank Phase 9

## Overview

Payroll export aggregates all tip data per employee for a pay period. Tip group report shows segment breakdowns with per-member earnings. Both support CSV and JSON output.

## What Was Built

### Domain Logic (src/lib/domain/tips/tip-payroll-export.ts, ~300 lines)
- `aggregatePayrollData()` — Queries TipLedgerEntry + CashTipDeclaration for a date range, groups by employee and sourceType:
  - CC tips earned (DIRECT_TIP credits)
  - Cash tips declared (from CashTipDeclaration)
  - Tip-outs given (ROLE_TIPOUT debits)
  - Tip-outs received (ROLE_TIPOUT credits)
  - Group pool distributions (TIP_GROUP credits)
  - Adjustments
  - Payouts
  - Net to payroll
- `formatPayrollCSV()` — Pure function generating CSV with headers, employee rows, and totals row
- `centsToDollarString()` — Converts cents to "45.00" format

### Types
- `PayrollEmployeeData` — Per-employee aggregated tip data
- `PayrollExportData` — Full export with employee array, period dates, totals

### API Routes
- `GET /api/reports/payroll-export` — CSV or JSON format
  - Required params: locationId, periodStart, periodEnd
  - Optional: format (csv|json, default json)
  - CSV returns Content-Type: text/csv with attachment disposition
  - Auth: tips.process_payout permission
- `GET /api/reports/tip-groups` — Group report with segments
  - Optional: locationId, dateFrom, dateTo, groupId, limit, offset
  - Returns segments with memberships and per-member earnings via groupBy
  - Auth: tips.view_ledger permission

## Files Created
- `src/lib/domain/tips/tip-payroll-export.ts`
- `src/app/api/reports/tip-groups/route.ts`
- `src/app/api/reports/payroll-export/route.ts`

## Files Modified
- `src/lib/domain/tips/index.ts` — Barrel exports

## Verification
1. Payroll export CSV has correct headers and per-employee totals
2. Payroll export JSON includes all sourceType breakdowns
3. Group report shows time segments with member splits
4. Group report per-member earnings match ledger entries
5. Date range filters work correctly on both reports
