# Skills 260-267: Tip Bank Enhancements

**Status:** ALL DONE
**Domain:** Tips & Tip Bank
**Date:** 2026-02-10
**Dependencies:** Skill 250 (Tip Ledger Foundation), Skill 252 (Dynamic Tip Groups), Skill 253 (Shared Table Ownership), Skill 254 (Manual Transfers & Payouts)
**Phase:** Tip Bank Phase 11-18

## Table of Contents

1. [Skill 260: CC Tip Fee Structured Tracking](#skill-260-cc-tip-fee-structured-tracking)
2. [Skill 261: Shift Closeout Printout](#skill-261-shift-closeout-printout)
3. [Skill 262: Daily Business Summary Printout](#skill-262-daily-business-summary-printout)
4. [Skill 263: Tip Claims at Clock-Out Only](#skill-263-tip-claims-at-clock-out-only)
5. [Skill 264: Merge /crew/tips to Tip Bank View](#skill-264-merge-crewtips-to-tip-bank-view)
6. [Skill 265: Tip Group UI (Start/Join/Leave)](#skill-265-tip-group-ui-startjoinleave)
7. [Skill 266: Shared Table Ownership UI](#skill-266-shared-table-ownership-ui)
8. [Skill 267: Manual Tip Transfer Modal](#skill-267-manual-tip-transfer-modal)

---

## Skill 260: CC Tip Fee Structured Tracking

**Status:** DONE

### Overview

Tracks credit card processing fees deducted from tips as structured data rather than opaque deductions. The fee amount is stored on each TipTransaction and aggregated into the daily report's business costs section.

### What Was Built

- **Schema** -- Added `ccFeeAmountCents Int?` field to `TipTransaction` model
- **Pay Route** -- When CC fee deduction is enabled in settings, calculates fee cents and stores on the TipTransaction at payment time
- **Daily Report** -- Aggregates all `ccFeeAmountCents` across the day into a `businessCosts` section with total CC tip fees

### Key Files

| File | Change |
|------|--------|
| `prisma/schema.prisma` | Added `ccFeeAmountCents` to TipTransaction |
| `src/app/api/orders/[id]/pay/route.ts` | Store CC fee cents on tip transaction |
| `src/app/api/reports/daily/route.ts` | Aggregate CC tip fees into businessCosts |

---

## Skill 261: Shift Closeout Printout

**Status:** DONE

### Overview

ESC/POS thermal receipt for shift closeout summaries. Employees can print a physical copy of their shift report when closing out.

### What Was Built

- **Receipt Builder** -- ESC/POS document builder that formats shift data (hours, sales, tips, cash counts, tip-outs) into a printable receipt
- **Print API** -- POST endpoint that accepts shift data and sends to the configured receipt printer
- **UI Button** -- "Print Closeout Receipt" button on the ShiftCloseoutModal complete/summary step

### Key Files

| File | Change |
|------|--------|
| `src/lib/escpos/shift-closeout-receipt.ts` | New ESC/POS receipt builder |
| `src/app/api/print/shift-closeout/route.ts` | New print API route |
| `src/components/shifts/ShiftCloseoutModal.tsx` | Added print button on complete step |

---

## Skill 262: Daily Business Summary Printout

**Status:** DONE

### Overview

ESC/POS thermal receipt for the daily store report. Managers can print a physical summary of the day's business from the admin reports page.

### What Was Built

- **Receipt Builder** -- ESC/POS document builder that formats daily report data (sales, payments, labor, tips, voids) into a printable receipt
- **Print API** -- POST endpoint that accepts daily report data and sends to the configured receipt printer
- **UI Button** -- "Print" button on the admin daily report page

### Key Files

| File | Change |
|------|--------|
| `src/lib/escpos/daily-report-receipt.ts` | New ESC/POS receipt builder |
| `src/app/api/print/daily-report/route.ts` | New print API route |
| `src/app/(admin)/reports/daily/page.tsx` | Added print button |

---

## Skill 263: Tip Claims at Clock-Out Only

**Status:** DONE

### Overview

Prevents tip bank payouts at clock-out time. The TimeClockModal now shows an informational notification about the tip bank balance but does not offer a payout choice. Tip claims happen exclusively during shift closeout.

### What Was Built

- **TimeClockModal** -- Tip notification changed from actionable payout to informational: "You have $X in your Tip Bank. Claim at shift closeout."
- **ShiftCloseoutModal** -- Remains the only place where employees choose their payout method (cash or payroll)

### Key Files

| File | Change |
|------|--------|
| `src/components/time-clock/TimeClockModal.tsx` | Informational-only tip notification |
| `src/components/shifts/ShiftCloseoutModal.tsx` | Payout choice remains here only |

---

## Skill 264: Merge /crew/tips to Tip Bank View

**Status:** DONE

### Overview

Consolidates the old /crew/tips page into the tip bank view at /crew/tip-bank. Removes the legacy tip adjustments concept in favor of the unified tip ledger.

### What Was Built

- **Redirect** -- `/crew/tips` now redirects to `/crew/tip-bank`
- **Crew Hub** -- Card label renamed from "Tip Adjustments" to "Tip Bank"

### Key Files

| File | Change |
|------|--------|
| `src/app/(pos)/crew/tips/page.tsx` | Redirects to /crew/tip-bank |
| `src/app/(pos)/crew/page.tsx` | Renamed card label |

---

## Skill 265: Tip Group UI (Start/Join/Leave)

**Status:** DONE

### Overview

Full UI for managing dynamic tip groups from the Crew Hub. Employees can start a new tip group, join an existing one, or leave their current group. The Crew Hub shows a status card when an employee is in an active group.

### What Was Built

- **Tip Group Page** -- `/crew/tip-group` with full group management (start, join, leave, view members)
- **StartTipGroupModal** -- Modal for creating a new tip group with allocation settings
- **TipGroupPanel** -- Panel displaying active group info (members, shares, duration)
- **Crew Hub Integration** -- Shows tip group status card when employee is clocked in and in a group

### Key Files

| File | Change |
|------|--------|
| `src/app/(pos)/crew/tip-group/page.tsx` | New tip group management page |
| `src/components/tips/StartTipGroupModal.tsx` | New modal for creating groups |
| `src/app/(pos)/crew/page.tsx` | Tip group status card on Crew Hub |

---

## Skill 266: Shared Table Ownership UI

**Status:** DONE

### Overview

UI for shared table/tab ownership where multiple servers can co-own an order for tip splitting. Includes a modal for adding/removing co-servers, wired into both the floor plan (table header) and the order panel (bar tab).

### What Was Built

- **SharedOwnershipModal** -- Add/remove co-servers on an order. Auto-seeds current owner with "Owner" badge. Only shows clocked-in employees with `pos.access` permission. Transfer ownership flow requires the owner to transfer before leaving.
- **FloorPlanHome Integration** -- "Share" button on table header opens the modal
- **OrderPanel Integration** -- "Share" button on bar tab header opens the modal
- **Auth** -- Order owner can add co-owners without manager permission
- **API** -- Ownership management endpoint and shifts API returns clocked-in employees for picker

### Key Files

| File | Change |
|------|--------|
| `src/components/tips/SharedOwnershipModal.tsx` | New shared ownership modal |
| `src/components/floor-plan/FloorPlanHome.tsx` | Share button on table header |
| `src/components/orders/OrderPanel.tsx` | Share button on bar tab header |
| `src/app/(pos)/orders/page.tsx` | Modal state wiring |
| `src/app/api/orders/[id]/ownership/route.ts` | Ownership management API |
| `src/app/api/orders/[id]/route.ts` | Returns ownership data |
| `src/app/api/shifts/route.ts` | Returns clocked-in employees for picker |

---

## Skill 267: Manual Tip Transfer Modal

**Status:** DONE

### Overview

Modal component for manually transferring tips between employees. Creates paired DEBIT/CREDIT ledger entries for full audit traceability.

### What Was Built

- **ManualTipTransferModal** -- Select recipient from clocked-in employees, enter dollar amount, optional memo. On submit, creates atomic paired DEBIT (sender) and CREDIT (recipient) TipLedgerEntry records.

### Key Files

| File | Change |
|------|--------|
| `src/components/tips/ManualTipTransferModal.tsx` | New manual transfer modal |

### Ledger Flow

```
Sender clicks "Transfer" → Enters amount + recipient
    ↓
POST creates paired entries:
  DEBIT  → Sender's ledger   (sourceType=MANUAL_TRANSFER)
  CREDIT → Recipient's ledger (sourceType=MANUAL_TRANSFER)
    ↓
Both balances update atomically
```
