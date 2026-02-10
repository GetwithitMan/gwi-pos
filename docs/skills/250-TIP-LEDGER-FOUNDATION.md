# Skill 250: Tip Ledger Foundation

**Status:** DONE
**Domain:** Payments, Employees
**Date:** 2026-02-10
**Dependencies:** Skill 49 (Cash Drawer), Skill 50 (Shift Close)
**Phase:** Tip Bank Phase 1

## Overview

Every employee gets a TipLedger (like a bank account). ALL tip flows resolve to immutable ledger entries (credits and debits). This makes every dollar traceable and every balance explainable.

## What Was Built

### Schema (prisma/schema.prisma)
- `TipLedger` — Per-employee bank account with `currentBalanceCents` cached balance, `employeeId @unique`
- `TipLedgerEntry` — Immutable CREDIT/DEBIT entries with sourceType tracing
- `TipTransaction` — Links every tip to its order, payment, group, segment

### Domain Logic (src/lib/domain/tips/)
- `tip-ledger.ts` — Core functions:
  - `getOrCreateLedger()` — Lazy-create ledger on first tip interaction
  - `postToTipLedger()` — Create entry + update cached balance atomically
  - `getLedgerBalance()` — Read cached balance (fast)
  - `getLedgerEntries()` — Query entries with filters (date, sourceType, pagination)
  - `recalculateBalance()` — Sum all entries for integrity check, auto-fix drift
  - `dollarsToCents()` / `centsToDollars()` — Boundary conversion helpers
- `index.ts` — Barrel export for all tips domain functions/types

### API Routes
- `GET /api/tips/ledger` — Own balance + recent entries (self-access)
- `GET /api/tips/ledger/[employeeId]` — Full ledger statement with filters (admin or self-access)

### Integration Points
- `src/app/api/orders/[id]/pay/route.ts` — Fire-and-forget: creates TipTransaction + posts CREDIT (sourceType=DIRECT_TIP) after payment
- `src/app/api/shifts/[id]/route.ts` — Fire-and-forget: paired DEBIT/CREDIT entries for role tip-outs (sourceType=ROLE_TIPOUT) and custom shares (sourceType=MANUAL_TRANSFER)

### Settings (src/lib/settings.ts)
- `TipBankSettings` interface added to LocationSettings:
  - `enabled`, `allocationMode` (ITEM_BASED/CHECK_BASED), `chargebackPolicy`, `allowNegativeBalances`
  - `allowManagerInPools`, `poolCashTips`
  - `tipGuide` (basis, percentages, roundTo, showBasisExplanation)
  - `deductCCFeeFromTips`, `ccFeePercent` — CC processing fee deduction from tips
  - `allowEODCashOut`, `requireManagerApprovalForCashOut`, `defaultPayoutMethod` — EOD tip payout options

### Permissions (src/lib/auth-utils.ts)
6 new permissions added:
- `tips.manage_groups` — Start/stop tip groups, add members
- `tips.override_splits` — Change ownership splits (manager)
- `tips.manage_settings` — Change tip allocation settings
- `tips.perform_adjustments` — Retroactive edits with recalculation
- `tips.view_ledger` — View any employee's ledger (not just own)
- `tips.process_payout` — Cash payouts and payroll batches

### Types
- `LedgerEntryType` — 'CREDIT' | 'DEBIT'
- `LedgerSourceType` — DIRECT_TIP, TIP_GROUP, ROLE_TIPOUT, MANUAL_TRANSFER, PAYOUT_CASH, PAYOUT_PAYROLL, CHARGEBACK, ADJUSTMENT
- `PostToLedgerParams`, `LedgerEntryResult`, `LedgerEntriesFilter`, `LedgerEntry`, `LedgerBalance`

## Files Created
- `src/lib/domain/tips/tip-ledger.ts`
- `src/lib/domain/tips/index.ts`
- `src/app/api/tips/ledger/route.ts`
- `src/app/api/tips/ledger/[employeeId]/route.ts`

## Files Modified
- `prisma/schema.prisma` — TipLedger, TipLedgerEntry, TipTransaction models
- `src/lib/settings.ts` — TipBankSettings interface + defaults
- `src/lib/auth-utils.ts` — 6 new permissions
- `src/app/api/orders/[id]/pay/route.ts` — Ledger integration
- `src/app/api/shifts/[id]/route.ts` — Ledger integration

## Verification
1. Payment with tip → verify TipLedgerEntry CREDIT created with sourceType=DIRECT_TIP
2. Shift closeout with tip-outs → verify paired DEBIT/CREDIT entries for each role tip-out
3. GET /api/tips/ledger → verify own balance returned (self-access, no admin needed)
4. recalculateBalance() → verify cached balance matches sum of entries
