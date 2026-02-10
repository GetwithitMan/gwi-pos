# Skill 255: Chargeback & Void Tip Handling

**Status:** DONE
**Domain:** Tips & Tip Bank
**Date:** 2026-02-10
**Dependencies:** Skill 250 (Tip Ledger Foundation)
**Phase:** Tip Bank Phase 6

## Overview

Policy-based handling of tip chargebacks and payment voids. Two policies: BUSINESS_ABSORBS (log only, no ledger changes) and EMPLOYEE_CHARGEBACK (proportional DEBIT entries from affected employees). Includes negative balance protection.

## What Was Built

### Domain Logic (src/lib/domain/tips/tip-chargebacks.ts, ~280 lines)
- `handleTipChargeback()` — Main function: looks up TipTransaction + TipLedgerEntry records for a payment, applies policy:
  1. `BUSINESS_ABSORBS`: Log event only, no ledger changes
  2. `EMPLOYEE_CHARGEBACK`: Create proportional DEBIT entries from affected employees
  3. If `allowNegativeBalances = false`: Cap DEBIT at current balance, flag remainder for manager review
- `getLocationTipBankSettings()` — Read chargeback policy from Location.settings

### Configuration (Location.settings.tipBank)
- `chargebackPolicy`: 'BUSINESS_ABSORBS' | 'EMPLOYEE_CHARGEBACK'
- `allowNegativeBalances`: boolean (default: false)

## Files Created
- `src/lib/domain/tips/tip-chargebacks.ts`

## Files Modified
- `src/lib/domain/tips/index.ts` — Barrel exports

## Verification
1. BUSINESS_ABSORBS policy → void creates no ledger entries
2. EMPLOYEE_CHARGEBACK policy → void creates proportional DEBIT entries
3. allowNegativeBalances=false → DEBIT capped at current balance
4. Flagged remainder → manager review entry created
