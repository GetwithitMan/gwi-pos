# Skill 254: Manual Transfers & Payouts

**Status:** DONE
**Domain:** Tips & Tip Bank
**Date:** 2026-02-10
**Dependencies:** Skill 250 (Tip Ledger Foundation)
**Phase:** Tip Bank Phase 5

## Overview

One-off tip transfers between employees (paired DEBIT + CREDIT), cash payouts (DEBIT with sourceType PAYOUT_CASH), and batch payroll payouts for all employees with positive balances.

## What Was Built

### Domain Logic (src/lib/domain/tips/tip-payouts.ts, ~340 lines)
- `cashOutTips()` — Cash out full or partial balance, validates sufficient funds
- `batchPayrollPayout()` — Process payroll for all employees with positive balances (or specific employee list)
- `getPayableBalances()` — All employees at location with positive tip balances, sorted highest first
- `getPayoutHistory()` — Paginated payout history with date range filters
- `calculateNetTipAfterCCFee()` — Pure function: net tip after CC processing fee deduction

### API Routes
- `POST /api/tips/transfers` — Transfer tips (paired DEBIT from + CREDIT to)
- `GET /api/tips/transfers` — Transfer history for employee
- `POST /api/tips/payouts` — Cash out employee tips
- `GET /api/tips/payouts` — Payout history
- `POST /api/tips/payouts/batch` — Payroll batch payout (all positive balances)

### UI Pages
- `/tips/payouts` — Manager payout page (list employees with balances, cash payout button, payroll batch)

### Auth Patterns
- Self-transfer: employee IS the fromEmployee (no special permission needed)
- Manager transfer: requires `tips.manage_groups` permission
- Cash payout: requires `tips.process_payout` permission
- Batch payout: requires `tips.process_payout` permission

## Files Created
- `src/lib/domain/tips/tip-payouts.ts`
- `src/app/api/tips/transfers/route.ts`
- `src/app/api/tips/payouts/route.ts`
- `src/app/api/tips/payouts/batch/route.ts`
- `src/app/(admin)/tips/payouts/page.tsx`

## Files Modified
- `src/lib/domain/tips/index.ts` — Barrel exports

## Verification
1. Transfer → verify exactly 2 entries (DEBIT from + CREDIT to) with same amountCents
2. Cash payout → verify balance reduced by exact amount
3. Payroll batch → verify DEBIT for every employee with positive balance
4. Insufficient balance → verify transfer rejected
5. Self-transfer blocked → verify "Cannot transfer to yourself" error
