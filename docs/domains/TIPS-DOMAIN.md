# Tips & Tip Bank Domain

**Domain ID:** 24
**Status:** Complete
**Created:** February 10, 2026
**Skills:** 250–259

## Overview

The Tips & Tip Bank domain manages the complete tip lifecycle: earning, pooling, distributing, paying out, and reporting. The core architecture is a per-employee **TipLedger** (bank account) where every tip movement is recorded as an immutable ledger entry.

**Full system documentation:** See `/docs/TIP-BANK-SYSTEM.md`

## Domain Trigger

```
PM Mode: Tips
```

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                    TIPS & TIP BANK DOMAIN                        │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  ┌───────────────────────────────────────────────────────────┐   │
│  │                  DOMAIN LOGIC                              │   │
│  │              src/lib/domain/tips/                           │   │
│  │                                                            │   │
│  │  tip-ledger ──→ tip-groups ──→ tip-allocation              │   │
│  │  tip-payouts    table-ownership  tip-chargebacks            │   │
│  │  tip-recalculation  tip-compliance  tip-payroll-export      │   │
│  └───────────────────────────────────────────────────────────┘   │
│                            │                                     │
│  ┌───────────────────────────────────────────────────────────┐   │
│  │                    API ROUTES                              │   │
│  │              src/app/api/tips/                              │   │
│  │                                                            │   │
│  │  /ledger  /groups  /transfers  /payouts  /adjustments      │   │
│  │  /cash-declarations  /reports/tip-groups  /reports/payroll  │   │
│  └───────────────────────────────────────────────────────────┘   │
│                            │                                     │
│  ┌───────────────────────────────────────────────────────────┐   │
│  │                    UI PAGES                                │   │
│  │                                                            │   │
│  │  /crew/tip-bank  /settings/tips  /tips/payouts             │   │
│  │  /settings/tip-outs  /reports/tips                         │   │
│  └───────────────────────────────────────────────────────────┘   │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

## Layer Structure

| Layer | Scope | Files/API Routes |
|-------|-------|------------------|
| **Ledger Core** | TipLedger CRUD, postToTipLedger, recalculate | `src/lib/domain/tips/tip-ledger.ts`, `/api/tips/ledger/`, `/api/tips/ledger/[employeeId]` |
| **Tip Groups** | Group lifecycle, segments, membership | `src/lib/domain/tips/tip-groups.ts`, `/api/tips/groups/`, `/api/tips/groups/[id]/`, `/api/tips/groups/[id]/members/` |
| **Allocation** | Order → tip distribution pipeline | `src/lib/domain/tips/tip-allocation.ts` |
| **Payouts** | Cash out, batch payroll, payable balances | `src/lib/domain/tips/tip-payouts.ts`, `/api/tips/payouts/`, `/api/tips/payouts/batch/` |
| **Table Ownership** | Co-owned orders, split % management | `src/lib/domain/tips/table-ownership.ts`, `/api/orders/[id]/ownership/` |
| **Chargebacks** | Policy-based void/chargeback handling | `src/lib/domain/tips/tip-chargebacks.ts` |
| **Adjustments** | Manager adjustments, recalculation engine | `src/lib/domain/tips/tip-recalculation.ts`, `/api/tips/adjustments/` |
| **Compliance** | IRS 8% rule, tip-out caps, pool eligibility | `src/lib/domain/tips/tip-compliance.ts`, `/api/tips/cash-declarations/` |
| **Payroll Export** | Aggregation, CSV generation | `src/lib/domain/tips/tip-payroll-export.ts`, `/api/reports/payroll-export/` |
| **Reporting** | Group reports, tip reports | `/api/reports/tip-groups/` |
| **Settings** | Tip configuration admin | `/api/settings/tips/`, `/settings/tips` |
| **Dashboard** | Employee self-service tip bank | `/crew/tip-bank` |

## Integration Points

| System | Integration | Direction |
|--------|-------------|-----------|
| **Payments** | `postToTipLedger(CREDIT, DIRECT_TIP)` after payment | Payment → Tips |
| **Shifts** | Paired DEBIT/CREDIT for role tip-outs at closeout | Shift → Tips |
| **Socket.io** | `tip-group:created/member-joined/member-left/closed` events | Tips → All terminals |
| **Orders** | OrderOwnership for co-owned tables | Orders ↔ Tips |
| **Auth** | 6 tip-specific permissions in PERMISSIONS constant | Auth → Tips |
| **Settings** | TipBankSettings in Location.settings JSON | Settings → Tips |

## Database Models

| Model | Key | Purpose |
|-------|-----|---------|
| `TipLedger` | `employeeId @unique` | Per-employee bank account |
| `TipLedgerEntry` | `ledgerId + type + sourceType` | Immutable CREDIT/DEBIT records |
| `TipTransaction` | `orderId + paymentId` | Links tips to orders/payments |
| `TipGroup` | `ownerId + status` | Active pooling groups |
| `TipGroupMembership` | `groupId + employeeId` | Member join/leave tracking |
| `TipGroupSegment` | `groupId + startedAt` | Time-stamped split snapshots |
| `OrderOwnership` | `orderId` | Multi-server table co-ownership |
| `OrderOwnershipEntry` | `orderOwnershipId + employeeId` | Per-employee share % |
| `TipAdjustment` | `createdById + adjustmentType` | Manager adjustment audit |
| `CashTipDeclaration` | `employeeId + shiftId` | Shift cash declarations |

## Permissions

| Permission | Constant | Purpose |
|------------|----------|---------|
| `tips.manage_groups` | `TIPS_MANAGE_GROUPS` | Group lifecycle |
| `tips.override_splits` | `TIPS_OVERRIDE_SPLITS` | Change ownership splits |
| `tips.manage_settings` | `TIPS_MANAGE_SETTINGS` | Tip configuration |
| `tips.perform_adjustments` | `TIPS_PERFORM_ADJUSTMENTS` | Retroactive edits |
| `tips.view_ledger` | `TIPS_VIEW_LEDGER` | View any ledger |
| `tips.process_payout` | `TIPS_PROCESS_PAYOUT` | Cash/payroll payouts |

## Related Skills

| Skill | Name | Phase |
|-------|------|-------|
| 250 | Tip Ledger Foundation | 1 |
| 251 | Enhanced Tip-Out Rules & Tip Guide Basis | 2 |
| 252 | Dynamic Tip Groups | 3 |
| 253 | Shared Table Ownership | 4 |
| 254 | Manual Transfers & Payouts | 5 |
| 255 | Chargeback & Void Tip Handling | 6 |
| 256 | Manager Adjustments & Audit Trail | 7 |
| 257 | Employee Tip Bank Dashboard | 8 |
| 258 | Enhanced Tip Reporting & Payroll Export | 9 |
| 259 | Cash Tip Declaration & Compliance | 10 |

## Non-Responsibilities

This domain does NOT own:
- Payment processing (Payments domain)
- Shift closeout flow (Employees domain) — but integrates with it
- Employee CRUD (Employees domain)
- Order CRUD (Orders domain) — but owns OrderOwnership
- Receipt generation (Hardware domain)
- General reporting UI (Reports domain) — but provides tip-specific report APIs
