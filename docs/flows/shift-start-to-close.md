# Flow: Shift Start to Close

> **When to read this:** Before changing any feature listed in §8 Dependencies. If your change touches this journey, read this doc first.

---

## 1. Purpose

**Trigger:** An employee clocks in to start a shift.

**Why it matters:** Reporting integrity and money integrity. The shift record is the container for all labor, cash, and tip data for a working period. Closing a shift without resolving pending tips or open orders produces permanent reporting errors — tip allocations become orphaned and cash variance is miscalculated. The close-out sequence has hard gates that must never be bypassed.

**Scope:** `gwi-pos` (API, ShiftCloseoutModal, TimeClockModal, crew pages), `gwi-android-register` (PinLoginScreen, clock-in flow), `gwi-backoffice` (payroll aggregation, labor reports).

---

## 2. Preconditions

| Precondition | Detail |
|-------------|--------|
| Feature flags / settings | `cashHandlingMode` on Role (drawer / purse / none); tip group templates configured per role |
| Hardware required | Physical cash drawer (if `cashHandlingMode = drawer`) |
| Permissions required | `TIME_CLOCK` / `staff.time_clock_self` (Standard) to clock in/out; `SHIFT_FORCE_CLOSE` (Manager) to force-close with open orders; `manager.force_clock_out` (Critical) to force another employee's clock-out |
| Online / offline state | Clock-in and clock-out work offline on Android; shift close-out requires NUC reachable (pending tip check queries DB) |
| Prior state | Employee must not already be clocked in (prevents duplicate entries); employee must have an active `Employee` record with a role assigned |

---

## 3. Sequence (Happy Path)

### Phase A — Clock In

```
1. [CLIENT]       Employee enters PIN on /crew page (POS) or PinLoginScreen (Android)
2. [API]          PIN verified via internal auth; employee record + role permissions loaded
3. [CLIENT]       If employee has multiple roles (EmployeeRole junction): role picker shown
4. [CLIENT]       If tip group templates available for selected role:
                  GET /api/tips/group-templates/eligible → group picker shown
5. [API]          POST /api/time-clock with { employeeId, workingRoleId, selectedTipGroupTemplateId }
6. [DB]           TimeClockEntry created: { clockIn: NOW(), workingRoleId, drawerCountIn }
                  If tip group template selected: assignEmployeeToTemplateGroup() runs
                  TipGroup created/joined; TipGroupMembership created (status = 'active')
                  TipGroupSegment created with initial splitJson
7. [DB]           Shift record created or found: { status: 'open', startedAt, startingCash,
                  employeeId, workingRoleId, drawerId, timeClockEntryId }
8. [EVENTS]       employee:clock-changed socket event emitted: { employeeId }
9. [SIDE EFFECTS] Dashboard staff count updated via socket listener;
                  Buddy-punch detection: IP + userAgent fingerprint checked against recent clock events (1h window);
                  If mismatch: location alert dispatched (non-blocking)
10. [CLIENT]      Employee lands on POS order screen with permissions context from workingRoleId loaded
```

### Phase B — During Shift (Orders, Payments, Tips)

```
11. [ONGOING]     Employee creates orders → items added → sent to kitchen
                  All OrderEvents emit with employeeId linking back to shift
12. [ONGOING]     Payments processed → Payment.employeeId = shift employee
                  allocateTipsForPayment() called fire-and-forget after each card payment
                  TipLedgerEntry (CREDIT, DIRECT_TIP) posted to employee's TipLedger
                  If employee is in tip group: split across TipGroupSegment members
13. [ONGOING]     Cash sales tracked on Shift.cashSales; card sales on Shift.cardSales
                  Shift.expectedCash maintained (startingCash + cashSales - payouts)
14. [OPTIONAL]    Break: POST /api/breaks → Break record created; PUT /api/breaks → Break ended
                  Break minutes accumulated in TimeClockEntry.breakMinutes (deducted from hours)
```

### Phase C — Shift Close Initiation

```
15. [CLIENT]      Employee or Manager opens ShiftCloseoutModal on POS web
16. [API]         GET /api/tips/pending-tips → returns card payments with $0 tip (paper receipt flow)
17. [GATE-1]      If pending tips exist → BLOCK CLOSE
                  Employee must enter tips via MyTipsScreen or TipEntrySheet before proceeding
18. [API]         GET /api/orders/open → count open orders assigned to this employee
19. [GATE-2]      If open orders > 0:
                  Standard employee → BLOCK CLOSE (must close orders first)
                  Manager with SHIFT_FORCE_CLOSE → allowed to proceed (manager override, audit-logged)
```

### Phase D — Cash Reconciliation

```
20. [CLIENT]      Employee counts physical cash; enters denominations or total in ShiftCloseoutModal
21. [DB]          TimeClockEntry.drawerCountOut updated with denomination JSON + total
22. [CALC]        variance = expectedCash - actualCash
                  Shift.actualCash, Shift.variance written
```

### Phase E — Tip Distribution & Close

```
23. [API]         PUT /api/shifts/[id] with close-out payload
24. [DB]          Tip distribution: TipOutRule evaluated → tipOutTotal calculated
                  net tips = grossTips - tipOutTotal
                  Shift: grossTips, tipOutTotal, netTips, tipsDeclared written
25. [DB]          Shift.status = 'closed', Shift.endedAt = NOW()
26. [DB]          TimeClockEntry: clockOut = NOW()
                  regularHours = (totalMinutes - breakMinutes) up to 8h
                  overtimeHours = minutes beyond 8h threshold
27. [EVENTS]      employee:clock-changed emitted: { employeeId }
                  NOTE: shift:closed event is referenced in test suites but not yet wired to
                  socket dispatch — treat as a Known Gap (see docs/features/_INDEX.md)
28. [SIDE EFFECTS] Payroll snapshot written to Shift record for labor reports;
                   Tip groups owned by this employee: if last member, group auto-closed;
                   Cash tip declaration prompt if employee has cash sales (IRS 8% compliance check)
```

---

## 4. Events Emitted

| Event Name | Payload (key fields) | Emitter | Consumers | Ordering Constraint |
|------------|---------------------|---------|-----------|---------------------|
| `employee:clock-changed` | `{ employeeId }` | `POST /api/time-clock` | Dashboard (staff count), Android | Clock-in step |
| `employee:clock-changed` | `{ employeeId }` | `PUT /api/time-clock` | Dashboard, Android | Clock-out step |
| `tip-group:updated` | `{ action: 'created', groupId, employeeId }` | Tip group assignment | Crew page | After clock-in tip group |
| `tip-group:updated` | `{ action: 'closed', groupId }` | Shift close side effect | Crew page | After shift close |

**Known Gap:** `shift:opened` and `shift:closed` events appear in test suites but the socket dispatch call was not found in the codebase. These may be added in a future wiring pass. Do not rely on them for client-side state.

---

## 5. State Changes

| Record | Fields Changed | When |
|--------|---------------|------|
| `TimeClockEntry` | Created: `clockIn`, `workingRoleId`, `selectedTipGroupId`, `drawerCountIn` | Clock-in |
| `TipGroup` | Created (if template selected) | Clock-in |
| `TipGroupMembership` | Created: `status = 'active'`, `joinedAt` | Clock-in |
| `TipGroupSegment` | Created: `splitJson`, `startedAt` | Clock-in |
| `Shift` | Created: `status = 'open'`, `startedAt`, `startingCash`, `drawerId` | Clock-in |
| `TipLedgerEntry` | Created (IMMUTABLE) per tip payment throughout shift | Each tipped payment |
| `TipLedger` | `currentBalanceCents` updated | Each tip entry |
| `Break` | Created: `status = 'active'`; updated: `status = 'completed'`, `endedAt`, `duration` | Breaks |
| `TimeClockEntry` | `clockOut`, `regularHours`, `overtimeHours`, `breakMinutes`, `drawerCountOut` | Clock-out |
| `Shift` | `status = 'closed'`, `endedAt`, `actualCash`, `variance`, `grossTips`, `tipOutTotal`, `netTips`, `tipsDeclared` | Shift close |
| `TipGroupMembership` | `status = 'left'`, `leftAt` | If employee leaves group at close |
| `TipGroupSegment` | `endedAt` set | If group closed at shift end |

**Snapshot rebuild points:** None for shift records directly. OrderSnapshot rebuilds happen per-order throughout the shift as orders are mutated.

---

## 6. Edge Cases

| Scenario | Behavior |
|----------|---------|
| **Pending tips block close** | GET /api/tips/pending-tips returns > 0 results; ShiftCloseoutModal blocks with "Resolve pending tips" prompt; employee uses MyTipsScreen (Android) or TipEntryRow (web) to enter tip amounts; shift close re-evaluated |
| **Open orders block close** | GET /api/orders/open returns > 0 for this employee; standard employee must close all orders; manager with SHIFT_FORCE_CLOSE permission can override (audit-logged, counted in shift close open order count) |
| **Employee forgets to clock out** | Manager uses `manager.force_clock_out` permission to clock out on employee's behalf via PUT /api/time-clock with `{ force: true, employeeId }`; audit-logged |
| **Clock-out blocked (last tip group member)** | PUT /api/time-clock returns 409 `errorCode: last_group_member`; client shows modal directing to /crew/tip-group; employee must transfer ownership or close group; manager can override with force flag |
| **Clock-out blocked (active payment)** | Clock-out returns 409 if PaymentManager reports an active payment in flight; employee must wait for payment to complete or error before clocking out |
| **Multiple roles in one shift** | At clock-in, if employee has EmployeeRole records, role picker shown; `Shift.workingRoleId` records which role was selected; permissions for the session come from workingRoleId only (not union of all roles) |
| **Tip edit after shift close (24h boundary)** | Employee can edit their own tip on a payment up to 24h after the payment was captured via POST /api/tips/adjustments; after 24h, manager approval required (`tips.manage_bank`); TipLedger updated via delta entry (IMMUTABLE — no existing entry modified) |
| **Cash tip declaration** | At close, if employee had cash sales, CashTipDeclaration prompt shown; IRS 8% rule: system warns if declared amount < 8% of total sales; CashTipDeclaration record created |
| **Buddy-punch detection** | On clock-in, IP and user-agent fingerprint compared against recent events (1h window); mismatch triggers location alert (non-blocking — clock-in still succeeds) |
| **Break auto-end on clock-out** | If a Break record has status = 'active' when clock-out fires, it is auto-ended by the API |
| **Offline clock-in** | Android can clock in offline; TimeClockEntry created locally and synced when NUC reachable; no tip group assignment happens offline (group templates require network) |

---

## 7. Invariants (Never Break These)

- **[SHIFT-1]** NEVER close a shift with pending $0-tip card payments. These are payments where the customer signed a paper receipt and the tip has not been entered. Closing with pending tips orphans those tips permanently.
- **[SHIFT-2]** NEVER close a shift with open orders without manager override. The open order count check must run before close is allowed, and the override must be audited.
- **[SHIFT-3]** Tip allocations are IMMUTABLE after shift close. Never update or delete TipLedgerEntry records. Corrections post new DEBIT / CREDIT delta entries.
- **[SHIFT-4]** Business-day boundary governs which tips belong to which shift. Tips collected before the business-day cutoff (not calendar midnight) belong to the prior shift. All tip reports must use business day boundaries.
- **[SHIFT-5]** Clock-out during an active payment MUST be blocked. Allowing clock-out mid-payment can orphan in-flight Datacap transactions.
- **[SHIFT-6]** If an employee is the last member of an active TipGroup, clock-out MUST be blocked (409). The group must be transferred or closed first. This prevents orphaned tip pools.
- **[SHIFT-7]** `Shift.endedAt` and `TimeClockEntry.clockOut` must use DB-generated `NOW()`, never client timestamps.

If you break SHIFT-1: re-run pending tip check, enter missing tips, then re-close the shift. If you break SHIFT-3: post a compensating delta entry — never modify or delete the existing entry.

---

## 8. Dependencies & Cross-Refs

> If you touch this flow, also check these docs:

| Doc | Why |
|-----|-----|
| `docs/features/shifts.md` | Shift data model, close-out flow, business rules |
| `docs/features/tips.md` | Pending tip gate, allocateTipsForPayment(), ledger immutability, clock-out guard |
| `docs/features/time-clock.md` | Clock-in/out sequence, buddy-punch detection, overtime calculation |
| `docs/features/employees.md` | Multi-role support, PIN auth, EmployeeRole junction table |
| `docs/features/payments.md` | How payments link to shift via employeeId; tip crediting after payment |
| `docs/features/roles-permissions.md` | SHIFT_FORCE_CLOSE, manager.force_clock_out, staff.time_clock_self gates |

### Features Involved
- **Time Clock** — creates TimeClockEntry; clock-in starts shift; clock-out drives hours calculation
- **Shifts** — primary shift lifecycle record; close-out gate logic; payroll snapshot
- **Tips** — pending tip block at close; TipLedger crediting throughout shift; clock-out guard
- **Employees** — multi-role selection at clock-in; permission context for the session
- **Roles & Permissions** — workingRoleId determines all permissions for the shift
- **Payments** — all payments during shift link to employeeId; tip allocation fires per payment
- **Reports** — Shift.totalSales, cashSales, cardSales, grossTips, netTips feed labor reports

---

*Last updated: 2026-03-03*
