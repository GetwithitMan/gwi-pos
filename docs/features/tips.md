# Feature: Tips

> **Before editing this feature:** Read `_CROSS-REF-MATRIX.md` → find Tips → read every listed dependency doc.

## Summary
Tips manages the full lifecycle of employee gratuities: crediting tips from card/cash payments, pooling tips in dynamic tip groups, splitting by role weight or hours, handling chargebacks, cash declarations, payroll export, and compliance checks. The core architecture is an **immutable ledger** — every tip movement creates a `TipLedgerEntry` (CREDIT or DEBIT) that is **never updated or deleted**. Corrections are made by posting delta entries. All amounts are stored as integer cents to eliminate floating-point errors.

## Status
`Active`

## Repos Involved
| Repo | Role | Coverage |
|------|------|----------|
| `gwi-pos` | API, domain logic, ledger, admin UI, POS crew UI | Full |
| `gwi-android-register` | My Tips screen, tip entry | Partial |
| `gwi-cfd` | Customer tip selection on CFD | Partial |
| `gwi-backoffice` | Tip reporting, payroll aggregation | Partial |

---

## UI Entry Points

| Interface | Path / Screen | Who Accesses |
|-----------|--------------|--------------|
| POS Web | `/crew/tip-bank` | All tipped employees |
| POS Web | `/crew/tip-group` | Employees in tip groups |
| POS Web | Payment flow → tip entry step | Servers during checkout |
| Admin | `/settings/tips` | Managers (tip configuration) |
| Admin | `/tips/payouts` | Managers (batch payouts) |
| Android | `MyTipsScreen` / `MyTipsViewModel` | All tipped employees |
| CFD | `CFDTipScreen` | Customers |

---

## Code Locations

### gwi-pos
| File / Directory | Purpose |
|-----------------|---------|
| `src/lib/domain/tips/tip-ledger.ts` | `postToTipLedger()`, `getOrCreateLedger()`, balance queries |
| `src/lib/domain/tips/tip-groups.ts` | Group lifecycle — start, join, leave, close, transfer |
| `src/lib/domain/tips/tip-allocation.ts` | `allocateTipsForPayment()` — facade called by pay route |
| `src/lib/domain/tips/tip-payouts.ts` | `cashOutTips()`, `batchPayrollPayout()`, payable balances |
| `src/lib/domain/tips/table-ownership.ts` | Shared table co-owner splits |
| `src/lib/domain/tips/tip-chargebacks.ts` | `handleTipChargeback()` — void reversal policies |
| `src/lib/domain/tips/tip-recalculation.ts` | Retroactive adjustments and replays |
| `src/lib/domain/tips/tip-compliance.ts` | IRS 8% rule, tip-out caps, pool eligibility |
| `src/lib/domain/tips/tip-payroll-export.ts` | CSV payroll aggregation |
| `src/lib/domain/tips/tip-group-templates.ts` | Admin-defined team pool templates |
| `src/lib/domain/tips/index.ts` | Barrel export of all public functions |
| `src/app/api/tips/ledger/route.ts` | GET — own ledger balance + entries |
| `src/app/api/tips/ledger/[employeeId]/route.ts` | GET — specific employee ledger |
| `src/app/api/tips/groups/route.ts` | GET/POST — list/create tip groups |
| `src/app/api/tips/groups/[id]/route.ts` | GET/PUT/DELETE — group detail/update/close |
| `src/app/api/tips/groups/[id]/members/route.ts` | POST — add member or request to join |
| `src/app/api/tips/payouts/route.ts` | GET/POST — payout history / cash out single |
| `src/app/api/tips/payouts/batch/route.ts` | GET/POST — payable balances / batch payout |
| `src/app/api/tips/transfers/route.ts` | GET/POST — manual tip transfers |
| `src/app/api/tips/pending-tips/route.ts` | GET — $0-tip card payments (for paper receipt entry) |
| `src/app/api/tips/recorded-tips/route.ts` | GET — payments with tips recorded |
| `src/app/api/tips/adjustments/route.ts` | GET/POST — adjustment audit trail |
| `src/app/api/tips/cash-declarations/route.ts` | GET/POST — cash tip declarations |
| `src/app/api/tips/group-templates/route.ts` | GET/POST — admin templates |
| `src/app/api/tips/group-templates/[id]/route.ts` | GET/PUT — template detail/update |
| `src/app/api/tips/group-templates/eligible/route.ts` | GET — templates eligible for employee's role |
| `src/app/api/tips/my-shift-summary/route.ts` | GET — shift tip participation summary |
| `src/app/api/tips/integrity/route.ts` | GET — ledger integrity check + reconcile |
| `src/components/tips/TipEntryRow.tsx` | Individual tip entry display |
| `src/components/tips/ManualTipTransferModal.tsx` | Transfer UI |
| `src/components/tips/TipAdjustmentOverlay.tsx` | Manager adjustment overlay |
| `src/components/tips/ActiveGroupManager.tsx` | Group lifecycle UI |
| `src/components/tips/GroupHistoryTimeline.tsx` | Segment history timeline |
| `src/components/orders/AdjustTipModal.tsx` | Adjust tip on order |
| `src/components/payment/steps/TipEntryStep.tsx` | Payment flow tip entry |
| `src/components/payment/TipPromptSelector.tsx` | Tip percentage quick-select |

### gwi-android-register
| File | Purpose |
|------|---------|
| `ui/tips/MyTipsScreen.kt` | Employee tip history (two tabs: Pending / My Tips) |
| `ui/tips/MyTipsViewModel.kt` | Tip data fetching and state |
| `ui/tips/TipEntrySheet.kt` | Edit tip with percentage quick-select |

### gwi-cfd
| File | Purpose |
|------|---------|
| `CFDTipScreen.kt` | Customer-facing tip selection |

---

## API Endpoints

| Method | Route | Auth | Description |
|--------|-------|------|-------------|
| `GET` | `/api/tips/ledger` | Self or `tips.view_ledger` | Own ledger balance + entries |
| `GET` | `/api/tips/ledger/[employeeId]` | Self or `tips.view_ledger` | Specific employee ledger |
| `GET` | `/api/tips/groups` | Employee PIN | List active tip groups |
| `POST` | `/api/tips/groups` | Employee PIN | Start new tip group |
| `GET` | `/api/tips/groups/[id]` | Member or `tips.manage_bank` | Group details |
| `PUT` | `/api/tips/groups/[id]` | Owner or `tips.manage_bank` | Update group (ownership, split mode) |
| `DELETE` | `/api/tips/groups/[id]` | Owner or `tips.manage_bank` | Close group |
| `POST` | `/api/tips/groups/[id]/members` | Owner or self-request | Add/request to join |
| `POST` | `/api/tips/payouts` | Self or `tips.process_payout` | Cash out single employee |
| `GET` | `/api/tips/payouts` | Self or `tips.process_payout` | Payout history |
| `POST` | `/api/tips/payouts/batch` | `tips.process_payout` | Batch payroll payout |
| `GET` | `/api/tips/payouts/batch` | `tips.process_payout` | Payable balances |
| `POST` | `/api/tips/transfers` | Self or `tips.manage_bank` | Manual tip transfer |
| `GET` | `/api/tips/pending-tips` | Self or `tips.view_ledger` | $0-tip card payments |
| `GET` | `/api/tips/recorded-tips` | Self or `tips.view_ledger` | Payments with tips |
| `POST` | `/api/tips/adjustments` | `tips.manage_bank` | Create tip adjustment |
| `GET` | `/api/tips/adjustments` | `tips.manage_bank` or `tips.view_ledger` | Adjustment audit trail |
| `POST` | `/api/tips/cash-declarations` | Self or manager override | Declare cash tips for shift |
| `GET` | `/api/tips/group-templates` | `tips.manage_rules` | List templates |
| `POST` | `/api/tips/group-templates` | `tips.manage_rules` | Create template |
| `GET` | `/api/tips/group-templates/eligible` | Employee PIN | Templates for employee's role |
| `GET` | `/api/tips/my-shift-summary` | Employee PIN | Shift tip participation |
| `GET` | `/api/tips/integrity` | `tips.manage_bank` | Ledger integrity check |

---

## Socket Events

### Emitted (POS → Clients)
| Event | Payload | Trigger |
|-------|---------|---------|
| `tip-group:updated` | `{ action, groupId, employeeId?, employeeName?, tipAmountCents? }` | Group created, member join/leave, close, tip received |

Actions: `created`, `member-joined`, `member-left`, `closed`, `ownership-transferred`, `tip-received`

### Received (Clients → POS)
| Event | Source | Purpose |
|-------|--------|---------|
| `cfd:tip-selected` | CFD | Customer selected tip on customer display |

---

## Data Model

### TipLedger (one per employee per location)
```
id                  String    @id
locationId          String
employeeId          String
currentBalanceCents Int                // cached sum — always equal to sum(entries)
@@unique([locationId, employeeId])
```

### TipLedgerEntry (IMMUTABLE — never update or delete)
```
id              String    @id
locationId      String
ledgerId        String                // FK to TipLedger
employeeId      String
type            TipLedgerEntryType    // CREDIT | DEBIT
amountCents     Int
sourceType      String                // DIRECT_TIP|TIP_GROUP|ROLE_TIPOUT|MANUAL_TRANSFER|
                                      // PAYOUT_CASH|PAYOUT_PAYROLL|CHARGEBACK|ADJUSTMENT
sourceId        String?               // FK to source record
memo            String?
shiftId         String?
orderId         String?
idempotencyKey  String?
```

### TipGroup (dynamic tip pooling)
```
id          String    @id
locationId  String
ownerId     String                    // employee who owns the group
templateId  String?                   // FK to TipGroupTemplate
status      TipGroupStatus            // active | closed
splitMode   TipGroupSplitMode         // equal|custom|role_weighted|hours_weighted
startedAt   DateTime
endedAt     DateTime?
```

### TipGroupMembership
```
id          String    @id
groupId     String
employeeId  String
joinedAt    DateTime
leftAt      DateTime?
status      TipGroupMembershipStatus  // active|left|pending_approval
```

### TipGroupSegment (immutable split snapshot)
```
id          String    @id
groupId     String
startedAt   DateTime
endedAt     DateTime?
memberCount Int
splitJson   Json                      // { "emp1": 0.5, "emp2": 0.5 }
```

### TipTransaction (links tips to orders/payments)
```
id                  String    @id
orderId             String
paymentId           String?
tipGroupId          String?
segmentId           String?
amountCents         Int
sourceType          String            // CARD|CASH|ADJUSTMENT
kind                String            // tip|service_charge|auto_gratuity
primaryEmployeeId   String?
ccFeeAmountCents    Int?
```

### TipDebt (chargeback tracking)
```
id                  String        @id
locationId          String
employeeId          String
originalAmountCents Decimal       @db.Decimal(10, 2)  // amount owed at chargeback time
remainingCents      Decimal       @db.Decimal(10, 2)  // what's still outstanding
sourcePaymentId     String                             // payment that triggered chargeback
sourceType          String        @default("CHARGEBACK")
memo                String?
status              TipDebtStatus @default(open)       // open|partial|recovered|written_off
createdAt           DateTime
updatedAt           DateTime
recoveredAt         DateTime?
writtenOffAt        DateTime?
writtenOffBy        String?
deletedAt           DateTime?
syncedAt            DateTime?
```

### TipAdjustment (manager correction audit trail)
```
id             String    @id
locationId     String
createdById    String                // manager who created the adjustment
reason         String
adjustmentType String                // see types below
contextJson    Json?                 // structured before/after state snapshot
autoRecalcRan  Boolean   @default(false)
createdAt      DateTime
updatedAt      DateTime
deletedAt      DateTime?
syncedAt       DateTime?
```

Adjustment types:
- `tip_amount` — Employee self-service or manager correction of the raw tip amount on a payment. Updates `Payment.tipAmount` and `Payment.totalAmount`.
- `group_membership` — Corrective reallocation after a group membership or split percentage change. `autoRecalcRan = true` when triggered by `recalculateGroupAllocations()`.
- `ownership_split` — Corrective reallocation after an order co-ownership change. `autoRecalcRan = true` when triggered by `recalculateOrderAllocations()`.
- `clock_fix` — Manual correction for clock-in/clock-out errors that affected hours-weighted splits.
- `manual_override` — Arbitrary manager-specified delta with no automated recalculation.

### CashTipDeclaration (IRS reporting record)
```
id             String    @id
locationId     String
employeeId     String
shiftId        String?               // optional FK to Shift
amountCents    Decimal   @db.Decimal(10, 2)
declaredAt     DateTime  @default(now())
source         String    @default("employee")   // 'employee' | 'manager_override'
overrideReason String?
overrideBy     String?               // employeeId of manager who overrode
createdAt      DateTime
updatedAt      DateTime
deletedAt      DateTime?
syncedAt       DateTime?
```

---

## Business Logic

### Tip Crediting Flow
1. Payment completed → `allocateTipsForPayment()` called (fire-and-forget)
2. CC fee deducted if configured
3. Check if employee is in active tip group
4. **Individual mode:** Full tip credited to employee via `postToTipLedger(CREDIT, DIRECT_TIP)`
5. **Group mode:** Find active segment at `collectedAt` → split by `splitJson` → post entries for each member

### Dynamic Tip Groups
1. Employee starts group at clock-in (or manually) → initial segment created
2. Members join/leave → new segment created with updated split percentages
3. Tips allocated to segment active at time of collection
4. Group closes at shift end → final segment endedAt set
5. Split modes: `equal` (even split), `custom` (manual %), `role_weighted` (by role tipWeight), `hours_weighted` (by hours worked)

### Shared Table Ownership (Skill 253)
1. Multiple servers assigned to a table → `OrderOwnership` tracks co-owners
2. Each owner has `sharePercent` (default: even split)
3. On payment, tips split by ownership percentage before group allocation
4. `addOrderOwner()` / `removeOrderOwner()` auto-rebalance

### Chargeback Handling
1. Payment voided → `handleTipChargeback()` called
2. Policy determines outcome:
   - `BUSINESS_ABSORBS`: Business eats the loss, no employee impact
   - `EMPLOYEE_CHARGEBACK`: Debit employee ledger immediately
   - `MANAGER_APPROVAL`: Create `TipDebt` for manager review
3. `TipDebt` tracks remaining balance, can be recovered from future tips

### Clock-Out Guard
- Employee cannot clock out if they are the **last member** of an active tip group
- API returns 409 with explanation
- Must transfer ownership or close group first

### Shift Close Tip Check
- Before closing shift, system checks for pending $0-tip card payments
- These are payments where tip hasn't been entered yet (paper receipt flow)
- Blocks shift close until resolved (tip entered or marked as no-tip)

### Cash Tip Declarations
- At shift close, employee declares cash tips received
- `CashTipDeclaration` records amount, shift, and source (employee or manager_override)
- Compliance: warns if declared amount < 8% of total sales (IRS rule)

### CashTipDeclaration Lifecycle
1. Employee (or manager on their behalf) calls `POST /api/tips/cash-declarations` during or after a shift
2. Route creates a `CashTipDeclaration` record with `source = 'employee'` (self) or `'manager_override'` (manager acting on behalf of employee)
3. `shiftId` is optional — declarations can be submitted without a shift FK if the employee has not yet clocked out
4. Compliance check: if `totalSalesCents` is provided in the request body, the route calls `checkDeclarationMinimum()` — warns if the declared amount is below 8% of sales (IRS 8% rule)
5. Over-declaration guard: if `shiftId` is provided, the route aggregates `DIRECT_TIP / CREDIT` ledger entries for that shift and warns if the declared amount exceeds the recorded cash tips (prevents accidental double-counting — cash tips are already in the ledger as credits; this declaration is **for IRS reporting only** and does NOT add to the employee's tip bank balance)
6. **No shift-close seal:** There is NO endpoint to finalize or lock a `CashTipDeclaration` at shift close. Multiple declarations can be submitted for the same shift. The system does not enforce a single-declaration-per-shift invariant, and shift close does not automatically create a declaration if none exists. Manager review of payroll exports is the only reconciliation path.

### TipAdjustment Lifecycle
1. `TipAdjustment` records are created by the domain layer — never via a direct DB write from a client
2. **Write paths (all via `POST /api/tips/adjustments`):**
   - `adjustmentType: 'tip_amount'` — Self-service (employee owns order) or manager-gated. Calls `performTipAdjustment()` → creates `TipAdjustment` + posts CREDIT/DEBIT ledger delta + updates `Payment.tipAmount` / `Payment.totalAmount`. Subject to 24h immutability boundary and 200% fat-finger guard.
   - `adjustmentType: 'group_membership'` or `'ownership_split'` via `recalculate: { type: 'group' | 'order' }` — Manager triggers automated recalculation. Calls `recalculateGroupAllocations()` or `recalculateOrderAllocations()`. These set `autoRecalcRan = true` on the created record.
   - `adjustmentType: 'manual_override'`, `'clock_fix'` — Manager-only, requires `TIPS_PERFORM_ADJUSTMENTS`. Arbitrary deltas via `employeeDeltas[]`.
3. `autoRecalcRan = true` means the adjustment was created by an automated recalculation engine (not a manually specified delta). This signals to reviewers that the before/after state in `contextJson` was computed, not entered by hand.
4. `contextJson` always contains a structured `{ before: {...}, after: {...} }` snapshot for human-readable audit review.
5. All delta entries posted by an adjustment have `sourceType = 'ADJUSTMENT'` and `adjustmentId` FK pointing back to the `TipAdjustment` record.

### TipDebt Lifecycle
1. **Created by:** `handleTipChargeback()` in `src/lib/domain/tips/tip-chargebacks.ts` — only when the chargeback policy is `EMPLOYEE_CHARGEBACK` AND the employee does not have sufficient balance to cover the full debit (i.e., `allowNegativeBalances = false` in `TipBankSettings` and the capped debit is less than the original credit amount)
2. **Initial state:** `status = 'open'`, `remainingCents = originalAmountCents`
3. **Auto-reclaim (FIFO):** Every time `postToTipLedger()` posts a CREDIT to an employee's ledger, `autoReclaimTipDebts()` runs automatically. It fetches all `open` or `partial` debts for that employee ordered by `createdAt asc` (oldest first) and deducts from each debt using the new credit balance. For each debt touched:
   - A DEBIT ledger entry is created with `sourceType = 'CHARGEBACK'` and `sourceId = debt.id` and memo `Auto-reclaim TipDebt {id} (fully recovered | partial)`
   - `TipDebt.remainingCents` is decremented
   - Status advances: `open` → `partial` (if partially reclaimed) or `recovered` (if fully reclaimed, `recoveredAt` set)
4. **Status values:**
   - `open` — full amount still outstanding
   - `partial` — some amount recovered, remainder still owed
   - `recovered` — fully reclaimed; `recoveredAt` timestamp set
   - `written_off` — manually written off by a manager; `writtenOffAt` and `writtenOffBy` set. **NO API ENDPOINT EXISTS to write off a debt — this requires direct DB intervention.**
5. **Risk:** If an employee is terminated before their debt is fully recovered, the remaining balance accumulates indefinitely. There is no automated write-off or collections process.

### Payroll Export
- `batchPayrollPayout()` processes all employees with positive balances
- Creates DEBIT entries for each employee
- `aggregatePayrollData()` generates per-employee summary for CSV export

---

## Cross-Feature Dependencies

> See `_CROSS-REF-MATRIX.md` for full matrix.

### This feature MODIFIES these features:
| Feature | How / Why |
|---------|-----------|
| Reports | Tip share reports, payroll export, earnings per employee |
| Shifts | Pending tips block shift close |
| Employees | Tip earnings tracked per employee |

### These features MODIFY this feature:
| Feature | How / Why |
|---------|-----------|
| Payments | `allocateTipsForPayment()` called after every payment with a tip |
| Orders | Order ownership determines who earns tips |
| Employees | Employee role determines tip weight and group eligibility |
| Shifts | Payout at shift close, clock-out guard |
| Settings | `TipBankSettings` in location settings (chargeback policy, caps, etc.) |
| Roles | `isTipped` and `tipWeight` fields on Role model |

### BEFORE CHANGING THIS FEATURE, VERIFY:
- [ ] **Payments** — does this change affect how tips are credited from payments?
- [ ] **Shifts** — does this change affect the clock-out guard or shift close check?
- [ ] **Reports** — does this change affect tip share report calculations?
- [ ] **Ledger immutability** — are you creating new entries (not updating existing ones)?
- [ ] **Cents-based** — are all amounts stored as integer cents?
- [ ] **Business day** — do date ranges use business day boundaries?

---

## Permissions Required

| Action | Permission Key | Level |
|--------|---------------|-------|
| View own tips | `tips.view_own` | Standard |
| View all tips | `tips.view_all` | High |
| View ledger | `tips.view_ledger` | High |
| Manage tip rules | `tips.manage_rules` | High |
| Manage tip bank | `tips.manage_bank` | High |
| Manage settings | `tips.manage_settings` | High |
| Process payout | `tips.process_payout` | Critical |
| Self-service tip entry | *(no permission required)* | — |
| Self-service tip transfer | *(no permission required)* | — |
| Self-request to join group | *(no permission required)* | — |

---

## Known Constraints & Limits
- **Immutable ledger:** NEVER update or delete `TipLedgerEntry` records — post delta entries instead
- **Cents-based accounting:** All amounts are integer cents (never Decimal dollars)
- **`currentBalanceCents` is cached:** Should always equal sum of entries; `recalculateBalance()` fixes drift
- **Segment-based allocation:** Tips allocated to segment active at `collectedAt` timestamp
- **Fire-and-forget:** `postToTipLedger()` called fire-and-forget from payment routes
- **NEVER call `postToTipLedger()` inside another transaction** (constraint from domain logic)
- **Business day boundaries** for ALL tip reports (not calendar midnight)
- **`TipPool` and `TipPoolEntry` models are DEPRECATED** — these legacy models are superseded by the `TipLedger` / `TipTransaction` system. Do NOT build any new features on `TipPool`. All tip pooling logic must use `TipLedger` + `TipTransaction` + `TipGroup`.

### Critical Known Gaps
These are confirmed gaps in the current implementation as of 2026-03-03. Do not assume they are handled silently.

| Gap | Description | Risk Level |
|-----|-------------|------------|
| **TipDebt write-off: no API** | `TipDebt.writtenOffAt` / `writtenOffBy` fields exist in the schema but no endpoint sets them. Writing off a debt requires direct DB access (`db.tipDebt.update`). | High — debts from terminated employees accumulate with no resolution path |
| **CashTipDeclaration: no shift-close seal** | There is no `POST /api/tips/cash-declarations/seal` or equivalent endpoint. Multiple declarations can be submitted per shift with no finalization step. Shift close does NOT automatically create a declaration if none exists. | Medium — payroll reconciliation relies entirely on manager review |
| **TipAdjustment `clock_fix` and `manual_override` types: no automated recalc** | These types require the caller to supply explicit `employeeDeltas[]`. There is no engine that calculates the correct delta from clock-in/out data. The manager must compute the before/after manually. | Medium — error-prone for complex group scenarios |
| **Proportional tip refund race condition** | `allocateTipsForPayment()` is called fire-and-forget after payment. If a void fires while allocation is still in-flight, `handleTipChargeback()` may see the original pre-allocation state and create a `TipDebt` for an amount that was never credited. The allocation then credits the employee's ledger, which auto-reclaims the debt — net result is correct but the debt record is spurious. Under high load this creates noise in manager review queues. | Low — self-correcting via auto-reclaim, but generates false debt records |

---

## Android-Specific Notes
- `MyTipsScreen` has two tabs: "Pending Tips" (paper receipt entry) and "My Tips" (recorded tips)
- `TipEntrySheet` supports percentage quick-select (15%, 18%, 20%, 25%)
- Date filtering with summary cards showing Total/Cash/Card breakdowns
- Access via "My Tips" button in POS header

### Employee Tip Dashboard (Android)

`MyTipsScreen` is accessible from the hamburger menu → "My Tips". It has two tabs:

| Tab | Description |
|-----|-------------|
| **Pending Tips** | Card payments assigned to the employee that have `tipAmount = 0`. These are checks where a tip was written on a paper receipt but not yet entered. Employee uses `TipEntrySheet` to record the tip. |
| **My Tips** | Card payments assigned to the employee that already have a recorded tip (`tipAmount > 0`). Tips are editable within 24 hours of shift close. |

Percentage chips in `TipEntrySheet` show both the percentage and the calculated dollar amount (e.g., "20% • $9.60"). Quick-select options: 15%, 18%, 20%, 25%.

**API endpoints:**

- `GET /api/tips/pending-tips` — returns completed card payments (non-cash, non-gift, non-house) with `tipAmount = 0` for the requesting employee, ordered by `processedAt` desc. Supports `shiftId` query param to scope results to a specific shift. Includes `shiftClosedAt` so Android can enforce the 24h edit boundary.
- `GET /api/tips/recorded-tips` — returns completed card payments with `tipAmount > 0` for the requesting employee. Also includes `shiftClosedAt` for the 24h boundary check.

Both endpoints default to the requesting employee and require `TIPS_VIEW_LEDGER` permission to query another employee.

### Self-Service Tip Adjustment

Employees can adjust tips on their own orders without needing the `TIPS_PERFORM_ADJUSTMENTS` permission. This is a deliberate design decision: servers are responsible for recording tips from paper receipts.

**How it works:**
- `POST /api/tips/adjustments` with `adjustmentType: "tip_amount"`, `orderId`, `paymentId`, and `tipAmountDollars`
- Route checks `order.employeeId === requestingEmployeeId` — if true, the `TIPS_PERFORM_ADJUSTMENTS` permission gate is bypassed
- If the requesting employee does NOT own the order, `TIPS_PERFORM_ADJUSTMENTS` is still required
- Updates `Payment.tipAmount` and `Payment.totalAmount` in the database
- Hard-rejects tips that exceed 200% of the payment base (fat-finger guard)
- Still subject to the 24h immutability boundary: if the payment's shift closed more than 24 hours ago, adjustment returns 403

**Self-service is blocked if:**
- The shift has been closed for more than 24 hours
- The tip amount exceeds 200% of the base payment amount

---

## Related Docs
- **Domain doc:** `docs/domains/TIPS-DOMAIN.md`
- **Tip bank system:** `docs/features/TIP-BANK-SYSTEM.md`
- **Cross-ref matrix:** `docs/features/_CROSS-REF-MATRIX.md`
- **Skills:** Skills 250–288 (see `docs/skills/SKILLS-INDEX.md`)
- **Android:** Skill 468 (My Tips Screen)

---

*Last updated: 2026-03-03*
