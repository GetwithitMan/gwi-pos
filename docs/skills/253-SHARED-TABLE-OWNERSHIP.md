# Skill 253: Shared Table Ownership

**Status:** DONE
**Domain:** Tips & Tip Bank
**Date:** 2026-02-10
**Dependencies:** Skill 250 (Tip Ledger Foundation)
**Phase:** Tip Bank Phase 4

## Overview

Multiple servers can co-own an order/table, each with a share percentage. Tips are split by ownership percentage before any group pooling. Adding/removing owners auto-rebalances splits.

## What Was Built

### Schema (prisma/schema.prisma)
- `OrderOwnership` — Links orders to co-owners with isActive flag and createdById
- `OrderOwnershipEntry` — Per-employee sharePercent (e.g., 50.0, 33.33)

### Domain Logic (src/lib/domain/tips/table-ownership.ts, ~600 lines)
- `getActiveOwnership()` — Current owners + splits for an order
- `addOrderOwner()` — Add co-owner with even auto-calc or custom percentages
- `removeOrderOwner()` — Remove owner and rebalance remaining splits
- `updateOwnershipSplits()` — Set custom split percentages (must sum to 100%)
- `adjustAllocationsByOwnership()` — Modify tip allocation per ownership splits

### API Routes
- `GET /api/orders/[id]/ownership` — Current owners + splits
- `POST /api/orders/[id]/ownership` — Add co-owner with split
- `PUT /api/orders/[id]/ownership` — Update splits (requires tips.override_splits)
- `DELETE /api/orders/[id]/ownership` — Remove owner and rebalance

## Files Created
- `src/lib/domain/tips/table-ownership.ts`
- `src/app/api/orders/[id]/ownership/route.ts`

## Files Modified
- `prisma/schema.prisma` — OrderOwnership, OrderOwnershipEntry models
- `src/lib/domain/tips/index.ts` — Barrel exports

## Verification
1. Add co-owner → verify even split auto-calculated
2. Custom percentages → verify sum equals 100%
3. Remove owner → verify remaining owners rebalanced
4. Tip allocation → verify adjusted by ownership snapshot at payment time
