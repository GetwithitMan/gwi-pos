# GWI POS — Tip Bank System

**Skills:** 250–283 | **Domain:** Tips & Tip Bank | **Status:** Complete | **Date:** 2026-02-10

---

## Table of Contents

1. [How It Works](#how-it-works)
2. [Architecture](#architecture)
3. [The Ledger Model](#the-ledger-model)
4. [Tip Flows](#tip-flows)
5. [Dynamic Tip Groups](#dynamic-tip-groups)
6. [Shared Table Ownership](#shared-table-ownership)
7. [Chargebacks & Voids](#chargebacks--voids)
8. [Manager Adjustments](#manager-adjustments)
9. [Payouts & Payroll](#payouts--payroll)
10. [Compliance & Cash Declarations](#compliance--cash-declarations)
11. [Reporting](#reporting)
12. [Printed Reports](#printed-reports)
13. [Front-End UI Components](#front-end-ui-components)
14. [New Location Setup Guide](#new-location-setup-guide)
15. [Settings Reference](#settings-reference)
16. [Permissions Reference](#permissions-reference)
17. [API Reference](#api-reference)
18. [Database Models](#database-models)
19. [File Map](#file-map)
20. [Skills Map](#skills-map)

---

## How It Works

The Tip Bank system gives every employee a **personal tip ledger** — like a bank account. Every dollar that moves through the tip system is recorded as an immutable ledger entry (credit or debit). This means:

- **Every dollar is traceable** — you can trace any balance back to its source entries
- **Every balance is explainable** — the balance equals the sum of all entries
- **Every movement is auditable** — managers see who, what, when, and why

### The Core Concept

```
Employee earns tip on Order #1234
    ↓
TipTransaction created (links order → payment → tip amount)
    ↓
TipLedgerEntry CREDIT posted (sourceType: DIRECT_TIP, +$15.00)
    ↓
TipLedger.currentBalanceCents atomically incremented (+1500)
    ↓
Employee's tip bank balance now shows $15.00
```

Everything flows through `postToTipLedger()`. Whether it's a direct tip, group pool distribution, role tip-out, manual transfer, cash payout, chargeback, or manager adjustment — it all becomes a ledger entry.

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                       TIP BANK SYSTEM (Skills 250-283)                      │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  ┌─────────────────────────────────────────────────────────────────────┐    │
│  │                    DOMAIN LOGIC LAYER                                │    │
│  │                 src/lib/domain/tips/                                 │    │
│  │                                                                     │    │
│  │  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐              │    │
│  │  │  tip-ledger   │  │  tip-groups   │  │ tip-allocation│             │    │
│  │  │  Core CRUD    │  │  Group CRUD   │  │ Order → Tips │             │    │
│  │  │  postToLedger │  │  Segments     │  │ Group splits │             │    │
│  │  │  recalculate  │  │  Membership   │  │ Ownership adj│             │    │
│  │  └──────────────┘  └──────────────┘  └──────────────┘              │    │
│  │                                                                     │    │
│  │  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐              │    │
│  │  │ tip-payouts   │  │table-ownership│ │tip-chargebacks│             │    │
│  │  │ Cash out      │  │ Co-owned tabs │ │ Policy-based  │             │    │
│  │  │ Batch payroll │  │ Split %       │ │ Absorb/Clawbk│             │    │
│  │  │ CC fee calc   │  │ Rebalance    │  │ Neg balance  │             │    │
│  │  └──────────────┘  └──────────────┘  └──────────────┘              │    │
│  │                                                                     │    │
│  │  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐              │    │
│  │  │tip-recalc     │  │tip-compliance │  │tip-payroll   │             │    │
│  │  │ Adjustments   │  │ IRS 8% rule   │  │ Aggregation  │             │    │
│  │  │ Group replay  │  │ Tip-out caps  │  │ CSV export   │             │    │
│  │  │ Delta entries │  │ Pool eligibil │  │ Per-employee  │             │    │
│  │  └──────────────┘  └──────────────┘  └──────────────┘              │    │
│  └─────────────────────────────────────────────────────────────────────┘    │
│                                                                             │
│  ┌─────────────────────────────────────────────────────────────────────┐    │
│  │                      API LAYER                                      │    │
│  │              src/app/api/tips/                                       │    │
│  │                                                                     │    │
│  │  /ledger           /groups           /transfers                     │    │
│  │  /ledger/[empId]   /groups/[id]      /payouts                      │    │
│  │  /adjustments      /groups/[id]/     /payouts/batch                │    │
│  │  /cash-declarations  members         /reports/tip-groups           │    │
│  │                                      /reports/payroll-export       │    │
│  └─────────────────────────────────────────────────────────────────────┘    │
│                                                                             │
│  ┌─────────────────────────────────────────────────────────────────────┐    │
│  │                      UI LAYER                                       │    │
│  │                                                                     │    │
│  │  /crew/tip-bank     Employee self-service dashboard + transfers     │    │
│  │  /crew/tip-group    Tip group management (start/join/leave)         │    │
│  │  /crew/tips         Redirect → /crew/tip-bank                       │    │
│  │  /settings/tips     Admin tip configuration (6 sections)            │    │
│  │  /settings/tip-outs Tip-out rules admin                             │    │
│  │  /tips/payouts      Manager payout page                             │    │
│  │                                                                     │    │
│  │  Components:                                                        │    │
│  │  SharedOwnershipModal    Co-server table/tab ownership              │    │
│  │  ManualTipTransferModal  Employee-to-employee tip transfer          │    │
│  └─────────────────────────────────────────────────────────────────────┘    │
│                                                                             │
│  ┌─────────────────────────────────────────────────────────────────────┐    │
│  │                   INTEGRATION POINTS                                │    │
│  │                                                                     │    │
│  │  Payment Route ──→ allocateTipsForPayment() (fire-and-forget)      │    │
│  │  Payment Route ──→ DIRECT_TIP credit + ccFeeAmountCents tracking   │    │
│  │  Payment Route ──→ Qualified tip kind (tip/auto_gratuity)          │    │
│  │  Void Payment ──→ handleTipChargeback() (fire-and-forget)          │    │
│  │  Shared Tables ──→ allocateWithOwnership() (owner % splits)        │    │
│  │  Shift Closeout ──→ ROLE_TIPOUT paired debit/credit                │    │
│  │  Shift Closeout ──→ Printed receipt (ESC/POS thermal)              │    │
│  │  Daily Report ──→ Printed summary with CC tip fee costs            │    │
│  │  Time Clock ──→ Informational tip balance (claim at closeout)      │    │
│  │  Socket Dispatch ──→ Real-time group updates                        │    │
│  │  Crew Hub ──→ Tip Bank + Tip Group cards                           │    │
│  │  AdminNav ──→ Tip Groups admin page                                │    │
│  │  Feature Flag ──→ tipBankSettings.enabled per-location             │    │
│  │  Integrity ──→ GET /api/tips/integrity drift check                 │    │
│  └─────────────────────────────────────────────────────────────────────┘    │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## The Ledger Model

### How Balances Work

Every employee has exactly one `TipLedger` record (created lazily on first tip interaction).

```
TipLedger
├── id: cuid
├── employeeId: unique (one per employee)
├── currentBalanceCents: Int (cached running balance)
└── entries: TipLedgerEntry[] (immutable history)
```

The `currentBalanceCents` is a **cached** value updated atomically alongside each new entry. It should always equal the sum of all entry amounts. If drift is detected, `recalculateBalance()` fixes it.

### Entry Types

Every entry is either a **CREDIT** (money in) or **DEBIT** (money out):

| Source Type | Entry Type | When |
|-------------|------------|------|
| `DIRECT_TIP` | CREDIT | Customer tips on a payment |
| `TIP_GROUP` | CREDIT | Group pool distribution to member |
| `ROLE_TIPOUT` | CREDIT/DEBIT | Automatic tip-out (receiver gets CREDIT, giver gets DEBIT) |
| `MANUAL_TRANSFER` | CREDIT/DEBIT | One employee transfers tips to another |
| `PAYOUT_CASH` | DEBIT | Cash payout at end of shift |
| `PAYOUT_PAYROLL` | DEBIT | Payroll batch payout |
| `CHARGEBACK` | DEBIT | Chargeback clawback (if policy = EMPLOYEE_CHARGEBACK) |
| `ADJUSTMENT` | CREDIT/DEBIT | Manager adjustment (linked to TipAdjustment record) |

### Atomic Operations

`postToTipLedger()` uses a Prisma `$transaction` to atomically:
1. Create the `TipLedgerEntry` record
2. Increment/decrement the `TipLedger.currentBalanceCents`

This ensures the balance never drifts from entries during normal operation.

> **Important:** Because `postToTipLedger()` uses `db.$transaction` internally, callers must NOT wrap it in another transaction. This is a SQLite constraint.

### Cents-Based Accounting

All monetary values are stored as **integer cents** (not Decimal dollars). This eliminates floating-point rounding errors.

- `dollarsToCents(15.50)` → `1550`
- `centsToDollars(1550)` → `15.50`

Conversion happens at the boundary: API receives dollars, converts to cents internally, returns dollars to UI.

---

## Tip Flows

### 1. Direct Tips (Skill 250)

When a customer pays with a tip:

```
Payment Route (/api/orders/[id]/pay)
    ↓ (fire-and-forget, async)
Creates TipTransaction (orderId, paymentId, amountCents)
    ↓
postToTipLedger(CREDIT, DIRECT_TIP, employeeId)
    ↓
Employee's tip bank balance increases
```

### 2. Role Tip-Outs (Skill 251)

At shift closeout, automatic tip-outs calculated by role:

```
Shift Close (/api/shifts/[id])
    ↓
calculateTipDistribution() with basisType per rule
    ↓ (for each tip-out rule)
postToTipLedger(DEBIT, ROLE_TIPOUT, giverId)   ← Server loses tips
postToTipLedger(CREDIT, ROLE_TIPOUT, receiverId) ← Busser gains tips
```

Rules support 5 basis types:
- `tips_earned` — % of tips
- `food_sales` — % of food sales
- `bar_sales` — % of bar sales
- `total_sales` — % of total sales
- `net_sales` — % of net sales (after discounts)

Each rule can have a `maxPercentage` cap and `effectiveDate`/`expiresAt` date bounds.

### 3. Group Pool Distribution (Skill 252)

When tips are allocated in a group context:

```
allocateTipsForOrder(orderId)
    ↓
Is employee in active TipGroup?
    ↓ YES
Find segment by payment timestamp
    ↓
splitJson = { "emp1": 0.5, "emp2": 0.5 }
    ↓
postToTipLedger(CREDIT, TIP_GROUP, emp1, 50% of tip)
postToTipLedger(CREDIT, TIP_GROUP, emp2, 50% of tip)
```

### 4. Manual Transfers (Skill 254)

One employee transfers tips to another:

```
POST /api/tips/transfers
    ↓
Validate balance >= amount
    ↓
postToTipLedger(DEBIT, MANUAL_TRANSFER, fromEmployee)
postToTipLedger(CREDIT, MANUAL_TRANSFER, toEmployee)
```

### 5. Cash Payouts (Skill 254)

Employee cashes out tips:

```
POST /api/tips/payouts
    ↓
postToTipLedger(DEBIT, PAYOUT_CASH, employeeId)
    ↓
Balance decreases by payout amount
```

---

## Dynamic Tip Groups

Tip Groups (Skill 252) solve the bartender pooling problem. Multiple bartenders share a bar, form a group, and pool tips with automatic time-segmented splits.

### How Groups Work

1. **Start Group** — First bartender creates a group
2. **Add Members** — Other bartenders join (owner approves)
3. **Segments Created** — Each membership change creates a new time segment with recalculated splits
4. **Tips Allocated** — Incoming tips use the segment active at the time of payment
5. **Close Group** — Last member leaving closes the group

### Time Segments

When membership changes, the current segment closes and a new one opens:

```
Segment 1: 4:00 PM – 6:00 PM | Alice (50%), Bob (50%)
    ↓ Charlie joins at 6:00 PM
Segment 2: 6:00 PM – 10:00 PM | Alice (33%), Bob (33%), Charlie (33%)
    ↓ Bob leaves at 10:00 PM
Segment 3: 10:00 PM – 2:00 AM | Alice (50%), Charlie (50%)
```

Each segment stores a `splitJson` with exact percentages. Tips are allocated using the segment that was active when the payment was made.

### Split Modes

- `equal` — Even split among all members (default)
- `custom` — Custom percentages set by owner
- `role_weighted` — Based on `Role.tipWeight` (e.g., Lead Bartender=1.5, Bartender=1.0, Barback=0.5). Uses `buildWeightedSplitJson()` to distribute proportionally. (Skill 282)
- `hours_weighted` — Proportional to hours worked (calculated at checkout, future)

### Socket Events

- `tip-group:created` — New group started
- `tip-group:member-joined` — Member added
- `tip-group:member-left` — Member left
- `tip-group:closed` — Group ended

---

## Shared Table Ownership

Table Ownership (Skill 253) handles scenarios where multiple servers co-own a table:

```
Table #5 owned by:
├── Alice: 60% (added most items)
├── Bob: 40% (helped during rush)
```

When tips come in for that table's order, the tip is split by ownership percentage before any group pooling.

### How It Works

1. Server A starts an order on Table #5
2. Server B is assigned as co-owner with a split (e.g., 50/50 or custom)
3. When the order is paid, tip allocation checks ownership first
4. Each owner's share goes through the normal allocation pipeline (direct or group)

### Rebalancing

Adding or removing an owner auto-rebalances. If it was 50/50 and a third server joins, it becomes 33/33/33 (or custom).

---

## Chargebacks & Voids

Skill 255 handles what happens when a payment with a tip is voided or charged back.

### Two Policies

| Policy | What Happens | When to Use |
|--------|--------------|-------------|
| `BUSINESS_ABSORBS` | Nothing. The business eats the loss. | Most restaurants — simpler, employee-friendly |
| `EMPLOYEE_CHARGEBACK` | Proportional DEBIT entries clawed from affected employees | High-risk environments |

### Negative Balance Protection

If `allowNegativeBalances = false` (default), chargebacks are capped at the employee's current balance. Any remainder is flagged for manager review rather than creating a negative balance.

---

## Manager Adjustments

Skill 256 provides a full audit trail for retroactive tip changes.

### What Managers Can Adjust

- Group membership times (e.g., fix a clock-in error)
- Ownership splits (e.g., correct a mistake)
- Direct tip amounts
- Any tip-related data

### How It Works

1. Manager opens adjustment tool
2. Selects what to adjust (group, order, or employee)
3. Makes changes
4. System creates a `TipAdjustment` record with `contextJson` (before/after state)
5. Recalculation engine replays affected allocations
6. **Delta entries** posted (not full replacement) — preserves audit trail
7. Each delta entry links back to the adjustment via `adjustmentId`

### Recalculation Engine

- `recalculateGroupAllocations(groupId)` — Replays group tip distribution
- `recalculateOrderAllocations(orderId)` — Replays order tip allocation
- `performTipAdjustment(managerId, type, changes, reason)` — Orchestrates the full flow

---

## Payouts & Payroll

### Cash Payouts (Skill 254)

Employees can cash out their tip bank balance:

- **Self-service** (if `allowEODCashOut = true`)
- **Manager-approved** (if `requireManagerApprovalForCashOut = true`)
- **Full balance** or **partial amount**

### Payroll Batch (Skill 258)

Managers run a batch payout that:
1. Finds all employees with positive balances
2. Creates DEBIT entries for each
3. Resets all balances to $0
4. Generates CSV export for payroll system

### CC Fee Deduction

If `deductCCFeeFromTips = true`, the system calculates a CC processing fee:

```
Tip: $10.00
CC Fee (3.5%): -$0.35
Net to employee: $9.65
```

This is a pure calculation — the deduction happens at payout time, not when the tip is earned.

### CC Fee Structured Tracking (Skill 260)

CC processing fees on tips are now tracked structurally via `TipTransaction.ccFeeAmountCents`. This enables business cost reporting:

```
Payment with $10.00 tip (card)
    ↓
TipTransaction created:
  amountCents: 1000
  ccFeeAmountCents: 35   ← Fee tracked structurally
    ↓
Ledger receives net: $9.65 (unchanged)
    ↓
Daily Report aggregates: businessCosts.ccTipFees
```

The daily business report (`/api/reports/daily`) now includes a `businessCosts` section:
```json
{
  "businessCosts": {
    "ccTipFees": 47.25,           // Total CC fees absorbed by business
    "ccTipFeeTransactions": 38    // Number of card tip transactions with fees
  }
}
```

Cash tips always have `ccFeeAmountCents = 0`.

---

## Compliance & Cash Declarations

### Cash Tip Declarations (Skill 259)

At shift closeout, employees declare their cash tips:

1. Employee enters cash tip amount
2. System creates `CashTipDeclaration` record
3. If amount < 8% of shift sales → IRS warning shown
4. Manager can override with reason

### Compliance Checks (Skill 259)

Pure-function guardrails that return warnings (not blocking):

| Check | What It Does |
|-------|-------------|
| `checkTipOutCap` | Warns if tip-out % exceeds configurable threshold |
| `checkPoolEligibility` | Warns if managers are in pools when `allowManagerInPools = false` |
| `checkDeclarationMinimum` | IRS 8% rule: warns if declared < 8% of sales |
| `runComplianceChecks` | Runs all checks, returns array of warnings |

---

## Reporting

### Tip Group Report (`GET /api/reports/tip-groups`)

Shows group activity with segment breakdowns:
- Time segments with member splits
- Per-member earnings across segments
- Filter by date range, group ID

### Payroll Export (`GET /api/reports/payroll-export`)

Aggregates all tip data per employee for a pay period:
- CC tips earned
- Cash tips declared
- Tip-outs given/received
- Pool distributions
- Net amounts

Supports CSV and JSON output formats.

### Employee Tip Bank Dashboard (`/crew/tip-bank`)

Self-service page showing:
- Current balance (large, prominent)
- "Transfer Tips" button → opens ManualTipTransferModal
- Ledger entries in bank-statement format
- Date range and source type filters
- Pagination (50 entries per page)

---

## Printed Reports

### Shift Closeout Receipt (Skill 261)

Thermal receipt printed at shift close via ESC/POS protocol (80mm paper, 48 chars).

**Trigger:** "Print Closeout Receipt" button on ShiftCloseoutModal complete step.

**API:** `POST /api/print/shift-closeout` with `{ shiftId, locationId }`

**Receipt sections:**
```
        [LOCATION NAME]
        SHIFT CLOSEOUT
════════════════════════════════════════════════
Employee / Clock In / Clock Out / Duration
────────────────────────────────────────────────
             SALES
Total Sales / Cash / Card / Orders
────────────────────────────────────────────────
             DRAWER
Starting Cash / + Cash Received / - Change Given
Expected / Counted / Variance
────────────────────────────────────────────────
              TIPS
Gross Tips / → Role Tip-Outs / Net Tips
────────────────────────────────────────────────
           TIP PAYOUT
Tip Bank Balance / Payout Method / Payout Amount
════════════════════════════════════════════════
SAFE DROP / EMPLOYEE TAKE HOME
════════════════════════════════════════════════
         02/10/2026 10:18 PM
```

**Files:**
- `src/lib/escpos/shift-closeout-receipt.ts` — Pure function building ESC/POS buffer
- `src/app/api/print/shift-closeout/route.ts` — Fetches shift data, builds receipt, sends to printer

### Daily Business Summary Receipt (Skill 262)

Thermal receipt for end-of-day business summary.

**Trigger:** "Print Thermal" button on daily report admin page (`/reports/daily`).

**API:** `POST /api/print/daily-report` with `{ locationId, date }`

**Receipt sections:**
- Revenue (gross, discounts, net, tax, tips, total)
- Payments (cash, credit, gift card, house account)
- Sales by Category (top 10 with %)
- Voids & Comps
- Labor Summary (hours, cost, % of sales)
- Business Costs (CC tip fees from Skill 260)
- Cash Accountability
- Stats (checks, avg check, covers)

**Files:**
- `src/lib/escpos/daily-report-receipt.ts` — Pure function building ESC/POS buffer
- `src/app/api/print/daily-report/route.ts` — Calls daily report API internally, maps to print format

---

## Front-End UI Components

### Tip Group Management (Skill 265)

Full-page UI at `/crew/tip-group` for starting, joining, and leaving tip groups.

**Features:**
- **Active Group Panel** — Members with split %, owner star indicator, leave/close actions
- **Start Group Modal** — Select clocked-in coworkers, choose split mode (equal/custom)
- **Join Group** — List active groups with "Request to Join" button
- **Owner Actions** — Approve pending requests, close group
- **Crew Hub Card** — "Tip Group" card on `/crew` linking to this page

**File:** `src/app/(pos)/crew/tip-group/page.tsx`

### Shared Table Ownership (Skill 266)

Reusable modal for managing co-server ownership on any order/table/tab.

**Features:**
- Current owners display with initials avatars and split %
- Add co-server → auto-calculates even splits
- Remove co-server → rebalances remaining owners
- Toggle between Even Split and Custom Split modes
- Custom split validation (must sum to 100%)

**File:** `src/components/tips/SharedOwnershipModal.tsx`

**Props:** `orderId`, `locationId`, `employeeId`, `isOpen`, `onClose`, `onUpdated`

**Integration:** Ready to wire into FloorPlanHome and BartenderView (future skill).

### Manual Tip Transfer (Skill 267)

Modal for transferring tips between employees.

**Features:**
- Current balance display
- Employee dropdown (self excluded)
- Amount validation against available balance
- Optional memo field
- Creates paired DEBIT/CREDIT ledger entries via `/api/tips/transfers`
- Success toast with amount and recipient name

**File:** `src/components/tips/ManualTipTransferModal.tsx`

**Entry point:** "Transfer Tips" button on `/crew/tip-bank` page.

### Tip Claims at Clock-Out Only (Skill 263)

Tips are only claimable during shift closeout, not at clock-in.

**Changes:**
- `TimeClockModal` tip notification is now informational only: "You have tips in your Tip Bank! Claim at shift closeout or via manager payout."
- No payout/collect action at clock-in
- `ShiftCloseoutModal` remains the sole employee-facing payout point
- Manager `/tips/payouts` page unchanged

### Crew Hub Consolidation (Skill 264)

- `/crew/tips` now redirects to `/crew/tip-bank`
- Crew Hub card renamed from "Tip Adjustments" to "Tip Bank"
- New "Tip Group" card added to Crew Hub (links to `/crew/tip-group`)

---

## New Location Setup Guide

### Step 1: Enable the Tip Bank

Navigate to **Settings > Tips** (`/settings/tips`) and configure:

1. **Tip Guide Section**
   - Set tip suggestion basis: `pre_discount` (recommended), `gross_subtotal`, `net_total`
   - Set percentages: e.g., `[15, 18, 20, 25]`
   - Enable "Show Basis Explanation" so customers see "(on $X pre-discount)"
   - Set rounding: `quarter` (rounds to nearest $0.25)

2. **Tip Bank Section**
   - Enable Tip Bank: `ON`
   - Allocation Mode: `CHECK_BASED` (simpler) or `ITEM_BASED` (for shared tables)
   - Pool Cash Tips: `ON` (includes cash tips in group pools)
   - Allow Negative Balances: `OFF` (recommended)
   - Allow Managers in Pools: `OFF` (recommended for compliance)

3. **Chargeback Policy**
   - Choose: `BUSINESS_ABSORBS` (recommended) or `EMPLOYEE_CHARGEBACK`

4. **Tip Shares Section**
   - Payout Method: `payroll` (automatic) or `manual`
   - Auto Tip-Out: `ON` (applies rules at shift close)
   - Require Acknowledgment: `ON` (employees confirm tip-outs)

5. **CC Fee Deduction** (optional)
   - Enable if you pass CC processing fees to employees
   - Set percentage (e.g., 3.5%)

6. **EOD Tip Payout**
   - Allow EOD Cash Out: `ON/OFF`
   - Require Manager Approval: `ON` (recommended)
   - Default Payout Method: `cash` or `payroll`

### Step 2: Configure Tip-Out Rules

Navigate to **Settings > Tip-Outs** (`/settings/tip-outs`):

1. Create rules for each role relationship:
   - Example: Server → Busser: 3% of tips earned
   - Example: Server → Kitchen: 1% of food sales
   - Example: Bartender → Barback: 5% of bar sales

2. For each rule, set:
   - **Basis Type**: What the percentage is based on
   - **Percentage**: The tip-out rate
   - **Max Percentage** (optional): Compliance cap
   - **Effective Date** / **Expiration** (optional): For seasonal rules

### Step 3: Assign Permissions

In **Employees > Roles**, assign tip permissions to appropriate roles:

| Permission | Who Gets It | What It Does |
|------------|-------------|--------------|
| `tips.manage_groups` | Bartenders, Managers | Start/stop tip groups, add members |
| `tips.override_splits` | Managers only | Change ownership splits |
| `tips.manage_settings` | Managers, Owners | Change tip configuration |
| `tips.perform_adjustments` | Managers only | Retroactive tip edits |
| `tips.view_ledger` | Managers only | View any employee's tip bank |
| `tips.process_payout` | Managers, Owners | Cash payouts and payroll batches |

Employees can ALWAYS view their own tip bank at `/crew/tip-bank` — no special permission needed.

### Step 4: Train Staff

**For Servers/Bartenders:**
- Show them `/crew/tip-bank` — their personal tip bank dashboard
- Explain: tips accumulate here, paid out via cash or payroll
- Show how tip-outs are automatically calculated at shift close
- If using groups: demonstrate how to start/join a tip group

**For Managers:**
- Show `/tips/payouts` — where to process cash payouts
- Show `/settings/tips` — tip configuration
- Show `/settings/tip-outs` — tip-out rule management
- Explain the adjustment tool for fixing errors
- Explain the payroll export workflow

### Step 5: Verify with a Test

1. Clock in an employee
2. Create an order, add items, pay with a tip
3. Check `/crew/tip-bank` — verify DIRECT_TIP credit appeared
4. Close the shift — verify ROLE_TIPOUT entries appeared
5. Run payroll export — verify CSV contains correct amounts

---

## Settings Reference

### TipBankSettings (Location.settings.tipBank)

```typescript
interface TipBankSettings {
  enabled: boolean                    // Master toggle
  allocationMode: 'ITEM_BASED' | 'CHECK_BASED'
  chargebackPolicy: 'BUSINESS_ABSORBS' | 'EMPLOYEE_CHARGEBACK'
  allowNegativeBalances: boolean      // Default: false
  allowManagerInPools: boolean        // Default: false
  poolCashTips: boolean               // Default: true
  deductCCFeeFromTips: boolean        // Default: false
  ccFeePercent: number                // Default: 3.5
  allowEODCashOut: boolean            // Default: true
  requireManagerApprovalForCashOut: boolean  // Default: true
  defaultPayoutMethod: 'cash' | 'payroll'   // Default: 'payroll'
  tipAttributionTiming: 'check_opened' | 'check_closed' | 'check_both'
  tipGuide: {
    basis: 'pre_discount' | 'gross_subtotal' | 'net_total'
    percentages: number[]             // e.g., [15, 18, 20, 25]
    showBasisExplanation: boolean
    roundTo: 'none' | 'quarter' | 'dollar'
  }
}
```

### Allocation Modes Explained

| Mode | How Tips Are Split | Best For |
|------|-------------------|----------|
| `CHECK_BASED` | Entire tip goes to the check's assigned employee (or group pool) | Bars, simple setups |
| `ITEM_BASED` | Tips split proportionally by item price among employees who rang items | Multi-server restaurants |

### Attribution Timing (for Groups)

| Timing | When Check Credits Group | Best For |
|--------|--------------------------|----------|
| `check_opened` | When check is opened | Bars (who started serving) |
| `check_closed` | When check is paid | Restaurants (who closed it) |
| `check_both` | Both open and close segments | Handoff scenarios |

---

## Permissions Reference

| Permission Key | Constant | Description |
|----------------|----------|-------------|
| `tips.manage_groups` | `TIPS_MANAGE_GROUPS` | Start/stop tip groups, approve join requests |
| `tips.override_splits` | `TIPS_OVERRIDE_SPLITS` | Change table ownership splits |
| `tips.manage_settings` | `TIPS_MANAGE_SETTINGS` | Modify tip bank configuration |
| `tips.perform_adjustments` | `TIPS_PERFORM_ADJUSTMENTS` | Retroactive edits with recalculation |
| `tips.view_ledger` | `TIPS_VIEW_LEDGER` | View any employee's tip ledger |
| `tips.process_payout` | `TIPS_PROCESS_PAYOUT` | Cash payouts and payroll batch |

**Self-access:** Employees can always view their OWN ledger and transfer history without any special permission.

---

## API Reference

### Ledger

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| GET | `/api/tips/ledger` | Self | Own balance + recent entries |
| GET | `/api/tips/ledger/[employeeId]` | Self or `tips.view_ledger` | Full ledger statement with filters |

**Query params** (GET /ledger/[employeeId]):
- `locationId` (required)
- `requestingEmployeeId` (for auth check)
- `dateFrom`, `dateTo` (ISO date strings)
- `sourceType` (filter by DIRECT_TIP, TIP_GROUP, etc.)
- `limit` (1-500, default 50)
- `offset` (default 0)

### Transfers

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| POST | `/api/tips/transfers` | Self or `tips.manage_groups` | Transfer tips between employees |
| GET | `/api/tips/transfers` | Self or `tips.view_ledger` | Transfer history |

**POST body:**
```json
{
  "locationId": "...",
  "fromEmployeeId": "...",
  "toEmployeeId": "...",
  "amount": 15.00,
  "memo": "Split from last night"
}
```

### Payouts

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| POST | `/api/tips/payouts` | `tips.process_payout` | Cash out employee tips |
| GET | `/api/tips/payouts` | `tips.view_ledger` | Payout history |
| POST | `/api/tips/payouts/batch` | `tips.process_payout` | Payroll batch payout |

### Groups

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| GET | `/api/tips/groups` | Any auth | List active groups |
| POST | `/api/tips/groups` | `tips.manage_groups` | Start new group |
| GET | `/api/tips/groups/[id]` | Any auth | Group details + segments |
| PUT | `/api/tips/groups/[id]` | `tips.manage_groups` | Update group (transfer, split mode) |
| DELETE | `/api/tips/groups/[id]` | `tips.manage_groups` | Close group |
| POST | `/api/tips/groups/[id]/members` | `tips.manage_groups` | Add member / request join |
| PUT | `/api/tips/groups/[id]/members` | `tips.manage_groups` | Approve join request |
| DELETE | `/api/tips/groups/[id]/members` | `tips.manage_groups` | Remove member |

### Adjustments

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| GET | `/api/tips/adjustments` | `tips.perform_adjustments` | Adjustment audit trail |
| POST | `/api/tips/adjustments` | `tips.perform_adjustments` | Create adjustment |

### Cash Declarations

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| GET | `/api/tips/cash-declarations` | Self or `tips.view_ledger` | Declaration history |
| POST | `/api/tips/cash-declarations` | Self | Declare cash tips |

### Reports

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| GET | `/api/reports/tip-groups` | `tips.view_ledger` | Group report with segments |
| GET | `/api/reports/payroll-export` | `tips.process_payout` | CSV/JSON payroll export |

### Order Ownership

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| GET | `/api/orders/[id]/ownership` | Any auth | Current owners + splits |
| POST | `/api/orders/[id]/ownership` | Any auth | Add co-owner |
| PUT | `/api/orders/[id]/ownership` | `tips.override_splits` | Update splits |
| DELETE | `/api/orders/[id]/ownership` | Any auth | Remove owner |

### Settings

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| GET | `/api/settings/tips` | `tips.manage_settings` | Read tip settings |
| PUT | `/api/settings/tips` | `tips.manage_settings` | Update tip settings |

---

## Database Models

### New Models (11 total)

| Model | Purpose | Key Fields |
|-------|---------|------------|
| `TipLedger` | Per-employee bank account | `employeeId` (unique), `currentBalanceCents` |
| `TipLedgerEntry` | Immutable CREDIT/DEBIT entries | `type`, `amountCents`, `sourceType`, `sourceId`, `idempotencyKey` |
| `TipTransaction` | Links tips to orders/payments | `orderId`, `paymentId`, `tipGroupId`, `amountCents`, `ccFeeAmountCents`, `kind`, `idempotencyKey` |
| `TipGroup` | Active tip pooling group | `ownerId`, `splitMode`, `status` |
| `TipGroupMembership` | Member join/leave tracking | `groupId`, `employeeId`, `joinedAt`, `leftAt`, `status` |
| `TipGroupSegment` | Time-stamped split snapshots | `groupId`, `startedAt`, `endedAt`, `splitJson` |
| `OrderOwnership` | Multi-server table ownership | `orderId`, `createdById` |
| `OrderOwnershipEntry` | Per-employee share percentage | `orderOwnershipId`, `employeeId`, `sharePercent` |
| `TipAdjustment` | Manager adjustment audit record | `createdById`, `adjustmentType`, `contextJson` |
| `CashTipDeclaration` | Shift cash tip declarations | `employeeId`, `shiftId`, `amountCents`, `source` |
| `TipDebt` | Chargeback remainder tracking | `employeeId`, `originalAmountCents`, `remainingCents`, `status` (open/partial/recovered/written_off) |

### Modified Models

| Model | Changes |
|-------|---------|
| `TipOutRule` | +`basisType`, `salesCategoryIds`, `maxPercentage`, `effectiveDate`, `expiresAt` |
| `TipTransaction` | +`ccFeeAmountCents` (Skill 260), +`kind` (Skill 277), +`idempotencyKey` (Skill 274) |
| `TipLedgerEntry` | +`idempotencyKey` (Skill 274) |
| `Role` | +`tipWeight` (Skill 282 — default 1.0, used for role_weighted tip group splits) |

---

## File Map

### Domain Logic (src/lib/domain/tips/)

| File | Lines | Purpose |
|------|-------|---------|
| `tip-ledger.ts` | ~310 | Core ledger CRUD, postToTipLedger, recalculate |
| `tip-groups.ts` | ~665 | Group lifecycle, segments, membership |
| `tip-allocation.ts` | ~520 | Order → tip allocation pipeline |
| `tip-payouts.ts` | ~340 | Cash out, batch payroll, payable balances |
| `table-ownership.ts` | ~600 | Co-owned orders, split management |
| `tip-chargebacks.ts` | ~280 | Policy-based chargeback handling |
| `tip-recalculation.ts` | ~600 | Adjustments, group/order replay, deltas |
| `tip-compliance.ts` | ~270 | IRS 8% rule, tip-out caps, pool eligibility |
| `tip-payroll-export.ts` | ~300 | Payroll aggregation, CSV generation |
| `index.ts` | ~155 | Barrel export |

### API Routes (src/app/api/tips/)

| Route | Methods |
|-------|---------|
| `tips/ledger/route.ts` | GET |
| `tips/ledger/[employeeId]/route.ts` | GET |
| `tips/transfers/route.ts` | GET, POST |
| `tips/payouts/route.ts` | GET, POST |
| `tips/payouts/batch/route.ts` | POST |
| `tips/groups/route.ts` | GET, POST |
| `tips/groups/[id]/route.ts` | GET, PUT, DELETE |
| `tips/groups/[id]/members/route.ts` | POST, PUT, DELETE |
| `tips/adjustments/route.ts` | GET, POST |
| `tips/cash-declarations/route.ts` | GET, POST |

### Other API Routes

| Route | Methods | Description |
|-------|---------|-------------|
| `reports/tip-groups/route.ts` | GET | Group report with segments |
| `reports/payroll-export/route.ts` | GET | CSV/JSON payroll export |
| `tips/integrity/route.ts` | GET | Integrity check + auto-fix (Skill 272) |
| `orders/[id]/void-payment/route.ts` | POST | Calls `handleTipChargeback()` (Skill 281) |
| `orders/[id]/pay/route.ts` | POST | Calls `allocateTipsForPayment()` (Skill 269) |

### Print Routes (Skills 261, 262)

| Route | Methods | Description |
|-------|---------|-------------|
| `print/shift-closeout/route.ts` | POST | Shift closeout thermal receipt |
| `print/daily-report/route.ts` | POST | Daily business summary thermal receipt |

### ESC/POS Receipt Builders (Skills 261, 262)

| File | Purpose |
|------|---------|
| `src/lib/escpos/shift-closeout-receipt.ts` | Shift closeout receipt buffer builder |
| `src/lib/escpos/daily-report-receipt.ts` | Daily report receipt buffer builder |

### UI Pages

| Page | Purpose |
|------|---------|
| `/crew/tip-bank` | Employee self-service dashboard + tip transfers |
| `/crew/tip-group` | Tip group management (start/join/leave) |
| `/crew/tips` | Redirect → `/crew/tip-bank` |
| `/tip-groups` | Admin tip groups overview (Skill 283) |
| `/settings/tips` | Admin tip configuration |
| `/settings/tip-outs` | Tip-out rule management |
| `/tips/payouts` | Manager payout page |

### UI Components (Skills 266, 267)

| Component | File | Purpose |
|-----------|------|---------|
| `SharedOwnershipModal` | `src/components/tips/SharedOwnershipModal.tsx` | Co-server table/tab ownership |
| `ManualTipTransferModal` | `src/components/tips/ManualTipTransferModal.tsx` | Employee-to-employee tip transfer |

---

## Skills Map

| Skill | Name | Phase | What It Built |
|-------|------|-------|---------------|
| **250** | Tip Ledger Foundation | 1 | TipLedger, TipLedgerEntry, TipTransaction, core functions, settings, permissions, API, payment+shift integration |
| **251** | Enhanced Tip-Out Rules | 2 | basisType on TipOutRule, sales-based calculations, /settings/tips admin, CC fee, EOD payout settings |
| **252** | Dynamic Tip Groups | 3 | TipGroup, TipGroupMembership, TipGroupSegment, group lifecycle, segment management, tip allocation pipeline, socket events |
| **253** | Shared Table Ownership | 4 | OrderOwnership, OrderOwnershipEntry, co-owned orders, split management, allocation adjustment |
| **254** | Manual Transfers & Payouts | 5 | Tip transfers API, cash payouts, batch payroll, payout management page |
| **255** | Chargeback & Void Handling | 6 | Policy-based chargebacks, BUSINESS_ABSORBS vs EMPLOYEE_CHARGEBACK, negative balance protection |
| **256** | Manager Adjustments | 7 | TipAdjustment model, recalculation engine, delta entries, audit trail, adjustment API |
| **257** | Employee Tip Bank Dashboard | 8 | /crew/tip-bank self-service page, bank-statement view, filters, pagination |
| **258** | Tip Reporting & Payroll Export | 9 | Payroll export domain logic, CSV generation, tip groups report, payroll export API |
| **259** | Cash Tip Declaration & Compliance | 10 | CashTipDeclaration model, cash declaration API, IRS 8% rule, compliance checks |
| **260** | CC Tip Fee Structured Tracking | 11 | `ccFeeAmountCents` on TipTransaction, `businessCosts` in daily report |
| **261** | Shift Closeout Printout | 12 | ESC/POS receipt builder, print API, "Print Closeout Receipt" button |
| **262** | Daily Business Summary Printout | 13 | ESC/POS receipt builder, print API, "Print Thermal" button, Business Costs card |
| **263** | Tip Claims at Clock-Out Only | 14 | TimeClockModal informational-only, removed collect action |
| **264** | Merge /crew/tips → Tip Bank | 15 | Redirect old page, rename Crew Hub card |
| **265** | Tip Group UI | 16 | /crew/tip-group page, start/join/leave flows, Crew Hub card |
| **266** | Shared Table Ownership UI | 17 | SharedOwnershipModal component, even/custom splits |
| **267** | Manual Tip Transfer Modal | 18 | ManualTipTransferModal component, "Transfer Tips" on tip bank page |
| **268** | Business Day Boundaries | 19 | All tip reports use `getBusinessDayRange()` instead of calendar midnight |
| **269** | Wire Tip Allocation to Payment | 20 | `allocateTipsForPayment()` called fire-and-forget from pay route |
| **270** | Cash Declaration Double-Counting Fix | 21 | Duplicate guard on cash declarations per shift |
| **271** | txClient Nested Transaction Guard | 22 | `TxClient` parameter pattern for SQLite nested transaction safety |
| **272** | Tip Integrity Check API | 23 | `GET /api/tips/integrity` with balance drift detection + auto-fix |
| **273** | Legacy Report Migration | 24 | All 5 tip reports migrated from TipBank/TipShare to TipLedgerEntry |
| **274** | Idempotency Guard | 25 | `idempotencyKey` on TipLedgerEntry + TipTransaction, dedup in `postToTipLedger()` |
| **275** | Deterministic Group Splits | 26 | Sort memberIds alphabetically before distributing remainder pennies |
| **276** | Wire Ownership into Allocation | 27 | `allocateWithOwnership()` — splits tip by owner %, then routes to group/individual |
| **277** | Qualified Tips vs Service Charges | 28 | `kind` field (tip/service_charge/auto_gratuity), IRS separation in payroll export |
| **278** | TipDebt Model | 29 | Persistent chargeback remainder tracking, auto-reclaim on future CREDITs |
| **279** | API Permission Hardening | 30 | Self-access checks on ledger + group join routes |
| **280** | Feature Flag + Legacy Guard | 31 | `tipBankSettings.enabled` — disable tip allocation per-location |
| **281** | Wire Void Tip Reversal | 32 | `handleTipChargeback()` called from void-payment route |
| **282** | Weighted Tip Splits | 33 | `Role.tipWeight`, `buildWeightedSplitJson()`, role_weighted splitMode |
| **283** | Tip Groups Admin Page | 34 | `/tip-groups` admin page with status/date filters, AdminNav link |

### Skill Dependencies

```
250 (Ledger Foundation)
 ├── 251 (Tip-Out Rules)
 ├── 252 (Tip Groups) ──→ 256 (Adjustments) ──→ 265 (Tip Group UI) ──→ 283 (Admin Page)
 │    └──→ 275 (Deterministic Splits) ──→ 282 (Weighted Splits)
 ├── 253 (Table Ownership) ──→ 266 (Shared Ownership UI) ──→ 276 (Wire into Allocation)
 ├── 254 (Transfers & Payouts) ──→ 267 (Tip Transfer Modal)
 ├── 255 (Chargebacks) ──→ 278 (TipDebt) ──→ 281 (Wire Void Reversal)
 ├── 257 (Dashboard) ──→ 264 (Merge /crew/tips)
 ├── 258 (Reports) ──→ 262 (Daily Report Print) ──→ 273 (Ledger Migration)
 ├── 259 (Compliance) ──→ 263 (Clock-Out Only) ──→ 270 (Cash Decl Fix)
 ├── 260 (CC Fee Tracking) ──→ 262 (Daily Report Print)
 ├── 261 (Shift Closeout Print)
 ├── 268 (Business Day Boundaries)
 ├── 269 (Wire Allocation to Payment) ──→ 274 (Idempotency Guard)
 ├── 271 (txClient Guard)
 ├── 272 (Integrity Check API)
 ├── 277 (Qualified Tips / IRS)
 ├── 279 (API Permission Hardening)
 └── 280 (Feature Flag Guard)
```

---

## Troubleshooting

### Balance doesn't match entries

Run the integrity check:
```
GET /api/tips/ledger/[employeeId]?locationId=...
```

If the balance seems wrong, the `recalculateBalance()` function sums all entries and fixes the cached value:

```typescript
import { recalculateBalance } from '@/lib/domain/tips'
const result = await recalculateBalance(employeeId)
// { calculatedCents: 15000, cachedCents: 14500, fixed: true }
```

### Tip not appearing after payment

Check:
1. Does the payment have a `tipAmount > 0`?
2. Is the payment route's fire-and-forget integration working?
3. Check server logs for "Failed to create tip ledger entry"

### Group tips not splitting correctly

Check:
1. Is there an active group for the employee? (`findActiveGroupForEmployee`)
2. Is there a segment for the payment timestamp? (`findSegmentForTimestamp`)
3. Does the segment's `splitJson` have the correct percentages?

### Shift closeout tip-outs wrong

Check:
1. Are the tip-out rules correct? (`/settings/tip-outs`)
2. Is the `basisType` set correctly?
3. Is the `maxPercentage` cap interfering?
4. Are `effectiveDate`/`expiresAt` filtering rules out?

### Shift closeout receipt won't print

Check:
1. Is there a receipt printer configured for this location? (`printerRole: 'receipt'`, `isActive: true`)
2. Is the printer reachable on the network? (check IP/port)
3. Check server logs for "Failed to print shift closeout receipt"

### Daily report receipt won't print

Check:
1. Same printer checks as shift closeout above
2. Does the daily report API return valid data for that date? (`GET /api/reports/daily?locationId=X&date=YYYY-MM-DD`)

### Tip transfer fails

Check:
1. Does the sender have sufficient balance? (transfer amount <= `currentBalanceDollars`)
2. Are both employees in the same location?
3. Check server logs for the `/api/tips/transfers` response

### Known Limitations

- Socket events for tip groups are defined but not all client listeners are implemented
- `hours_weighted` split mode is defined but not yet implemented (future skill)
- No migration script for backfilling existing TipBank/TipShare data into TipLedgerEntry

### Resolved Limitations (Skills 268-283)

- ~~Tip allocation pipeline not wired to payment route~~ → **DONE** (Skill 269)
- ~~SharedOwnershipModal not wired into FloorPlanHome~~ → **DONE** (Skill 266)
- ~~Void/refund tip reversal not connected~~ → **DONE** (Skill 281)
- ~~No idempotency protection on tip allocation~~ → **DONE** (Skill 274)
- ~~Reports use calendar midnight instead of business day~~ → **DONE** (Skill 268)
- ~~Reports read from legacy TipBank/TipShare models~~ → **DONE** (Skill 273)
- ~~No admin page for viewing tip groups~~ → **DONE** (Skill 283)
- ~~Only equal splits implemented for tip groups~~ → **DONE** (Skill 282, role_weighted)
