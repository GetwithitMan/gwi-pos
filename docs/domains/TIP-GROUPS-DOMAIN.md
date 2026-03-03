# Tip Groups Domain — Dynamic Tip Pooling

## Overview

Tip groups allow employees (typically bartenders or servers) to pool tips during a shift. When a customer tips on a payment, the system determines whether the primary employee is in an active tip group. If yes, the tip is split across all group members according to the current **segment**'s split percentages. If no, the employee receives the full tip individually.

**Key principle:** Attribution is determined at **payment time** using timestamps and the active segment — not by stamping individual order items. There is no `OrderItem.groupPeriodId` field. The system uses `findSegmentForTimestamp()` to locate the correct segment and split percentages.

**Source files:**

| File | Purpose |
|------|---------|
| `src/lib/domain/tips/tip-groups.ts` | Group lifecycle: start, join, leave, close, segment management |
| `src/lib/domain/tips/tip-allocation.ts` | Payment-time allocation: split tips across group members or credit individually |
| `src/lib/domain/tips/tip-group-templates.ts` | Admin-defined templates and clock-in group assignment |
| `src/app/api/tips/groups/route.ts` | REST API: list groups, start group |
| `src/app/api/tips/groups/[id]/route.ts` | REST API: get/update/close a group |
| `src/app/api/tips/groups/[id]/members/route.ts` | REST API: add/request/approve/remove members |
| `src/app/api/tips/my-shift-summary/route.ts` | Shift summary: segment breakdown + earnings |
| `src/app/(pos)/crew/tip-group/page.tsx` | Crew-facing tip group management UI |
| `src/app/api/time-clock/route.ts` | Clock-in (template selection) and clock-out (last-member guard) |

---

## Core Concept: Tip Group Segments

A **TipGroupSegment** is the atomic unit of tip allocation. Every time group membership changes (a member joins or leaves), the system:

1. **Closes** the current segment (sets `endedAt = now`)
2. **Creates** a new segment with the updated member list and recalculated `splitJson`

A segment records:

```
TipGroupSegment {
  id          String       // cuid
  locationId  String
  groupId     String       // parent TipGroup
  startedAt   DateTime     // when this segment began
  endedAt     DateTime?    // null = currently active segment
  memberCount Int          // number of active members in this segment
  splitJson   Json         // { "employeeId": 0.3333, ... } — fractions summing to 1.0
}
```

**Split calculation:** For `equal` split mode, each member gets `1 / memberCount`. The last member (alphabetically by ID) absorbs any rounding remainder so shares always sum to exactly 1.0. For `role_weighted` mode, each member's share is proportional to their role's `tipWeight` field.

**Example:** 3 members with equal split:
```json
{ "emp_abc": 0.3333, "emp_def": 0.3333, "emp_xyz": 0.3334 }
```

---

## Attribution Timing

The `tipAttributionTiming` setting (in `TipBankSettings`) controls **which segment** receives credit for a tip:

| Value | Behavior | Best For |
|-------|----------|----------|
| `check_opened` | Segment active when the **order was created** | Restaurants with assigned servers |
| `check_closed` | Segment active when **payment is processed** | Bars (default) — tabs may settle hours later |
| `check_both` | Proportional split between open-time and close-time segments | Hybrid venues |

**Current implementation:** `allocateTipsForOrder()` in `tip-allocation.ts` uses `collectedAt: new Date()` (payment time) to find the active segment via `findSegmentForTimestamp()`. The `check_opened` and `check_both` modes are defined in the settings interface but the core allocation currently uses the payment timestamp as the lookup key.

---

## Proportional Time-Segmented Allocation

When `tipAttributionTiming` is set to `'per_item'`, tip allocation switches from a
single-timestamp lookup to a **proportional per-item model**.

### How It Works

1. When a payment is processed, all non-voided items on the order are fetched
2. For each item, `findSegmentForTimestamp(groupId, item.createdAt)` determines which
   segment was active when that item was added
3. Items are grouped by segment; each segment's total revenue is summed
4. The tip is distributed proportionally: each segment receives
   `tipAmount × (segmentRevenue / orderTotalRevenue)`
5. Each segment then distributes its portion among members using `splitJson` percentages

### Example

Alice and Bob (50/50) run the bar from 5pm. Bob clocks out at 8pm — a new segment
starts with just Alice (100%).

Customer's $80 tab: $50 in drinks ordered 5–8pm, $30 ordered 8–11pm.
Customer tips $20.

| Segment | Items Revenue | Proportion | Tip Allocation | Per Member |
|---------|--------------|------------|----------------|------------|
| Alice+Bob (5–8pm) | $50 | 62.5% | $12.50 | Alice $6.25, Bob $6.25 |
| Alice only (8–11pm) | $30 | 37.5% | $7.50 | Alice $7.50 |

**Alice earns: $6.25 + $7.50 = $13.75. Bob earns: $6.25.**

No one benefits from being the last closer. No one loses tips for leaving early.

### Fallback Behavior

The proportional path falls back to single-timestamp (`check_closed`) when:
- No items are found for the order
- All items map to the same segment (proportional would produce identical result)
- All items predate the group (no segment found for any item)

### Settings

| Field | Values | Default |
|-------|--------|---------|
| `tipAttributionTiming` | `'per_item'` | `'check_closed'` |
| `lateTabTipHandling` | `'pool_period'` (recommended) \| `'personal_bank'` | `'pool_period'` |
| `attributionModel` | `'primary_100'` \| `'primary_70_assist_30'` | `'primary_100'` |

### Late Tab Tip Handling

When the last group member runs provisional closeout, tabs may still be open.
Tips from those tabs are handled per `lateTabTipHandling`:
- `pool_period`: Credits are applied to the same pool period distribution even after
  provisional close (the recommended default)
- `personal_bank`: Credits go directly to the primary server's tip bank

---

## Allocation Algorithm

When a payment with a tip is processed, the pay route calls `allocateTipsForPayment()`. Here is the actual flow:

```
allocateTipsForPayment(params)
│
├─ 1. If tipBank.enabled is false → return null (skip allocation)
├─ 2. Convert totalTipsDollars to cents
├─ 3. Calculate CC fee deduction:
│     If deductCCFeeFromTips && ccFeePercent > 0:
│       ccFeeAmountCents = round(cardTipCents * ccFeePercent / 100)
│       netTipAmountCents = tipAmountCents - ccFeeAmountCents
│
├─ 4. Delegate to allocateTipsForOrder(netTipAmountCents, ...)
│     │
│     ├─ Idempotency check: if tip-txn:{orderId}:{paymentId} exists → return existing
│     │
│     ├─ Check table co-ownership (Skill 276):
│     │   If multiple owners AND tableTipOwnershipMode != PRIMARY_SERVER_OWNS_ALL:
│     │     → allocateWithOwnership() splits by owner %, then each owner
│     │       independently routes through group-or-individual logic
│     │
│     ├─ Check if primaryEmployee is in an active tip group:
│     │   activeGroup = findActiveGroupForEmployee(primaryEmployeeId)
│     │
│     ├─ If NO group → allocateIndividual():
│     │     Create TipTransaction + one DIRECT_TIP TipLedgerEntry
│     │
│     └─ If IN group → allocateToGroup():
│           │
│           ├─ Find segment: findSegmentForTimestamp(groupId, collectedAt)
│           │   WHERE startedAt <= timestamp AND (endedAt IS NULL OR endedAt > timestamp)
│           │
│           ├─ If no segment found → fallback to allocateIndividual()
│           │
│           ├─ Calculate shares from splitJson:
│           │   For each member (sorted alphabetically):
│           │     share = round(tipAmountCents * splitPercent)
│           │     Last member gets: tipAmountCents - sumOfOtherShares
│           │
│           └─ In single $transaction:
│               Create TipTransaction (linked to groupId + segmentId)
│               For each member: create TipLedgerEntry (CREDIT, TIP_GROUP)
```

**Idempotency:** Every `TipTransaction` has a unique `idempotencyKey` of format `tip-txn:{orderId}:{paymentId}`. Every `TipLedgerEntry` has `tip-ledger:{orderId}:{paymentId}:{employeeId}`. This prevents double-posting on retries.

**Penny-exact allocation:** The `calculateShares()` function uses `Math.round()` for each member's share, then the last member (alphabetically) absorbs the rounding remainder so the sum always equals the original tip amount exactly.

---

## Clock-In Group Selection

At clock-in, the system checks for admin-defined `TipGroupTemplate` records. The flow:

1. **Fetch eligible templates:** `getEligibleTemplates(locationId, roleId)` returns templates where the employee's role ID is in `allowedRoleIds`
2. **Display picker:** If templates exist, a modal lets the employee choose a team (or "No Group" if `allowStandaloneServers` is enabled)
3. **Assignment:** `assignEmployeeToTemplateGroup()` enforces the single-group invariant (employee can only be in one active group), then:
   - Calls `getOrCreateGroupForTemplate(templateId)` — finds existing active group for this template or creates one
   - If group has no members: creates first membership + initial segment directly
   - If group has members: calls `addMemberToGroup()` which closes current segment and creates a new one with recalculated splits
4. **Link to clock entry:** The `TimeClockEntry` is updated with `selectedTipGroupId` for audit trail

**Single-group invariant:** An employee can only be in one active group at a time. `findActiveGroupForEmployee()` checks this constraint.

---

## Clock-Out: Last-Member Rule

When an employee attempts to clock out (`PUT /api/time-clock` with `action: 'clockOut'`):

1. The API calls `findLastMemberGroup(employeeId, locationId)`
2. This checks every active group where the employee is an active member
3. For each group, counts total active members
4. If any group has exactly 1 active member (this employee):
   - **Block clock-out** with HTTP 409 and `errorCode: 'last_group_member'`
   - Response includes `groupId` so the UI can link to the group management page
   - Employee must navigate to `/crew/tip-group` and **close the group** before clocking out

**Manager override:** Passing `force: true` bypasses the guard. An audit log entry with action `clock_out_last_member_override` is created (fire-and-forget).

**Concurrency safety:** The check is a simple count query, not a DB constraint. Worst case: two members both see count=1 simultaneously, both get blocked, and one must resolve first. This is safe — it errs on the side of blocking rather than allowing a dangling group.

---

## Admin Controls

### Tip Group Templates

Admins create templates (e.g., "Bar Team", "Downstairs Servers") via the admin settings UI. Each template defines:

- `name` — Display name shown at clock-in
- `allowedRoleIds` — JSON array of role IDs eligible to join
- `defaultSplitMode` — `equal`, `custom`, `role_weighted`, or `hours_weighted`
- `active` — Whether the template appears at clock-in
- `sortOrder` — Display order in the clock-in picker

When the first employee selects a template at clock-in, a runtime `TipGroup` is created with `templateId` linking back to the template. Subsequent employees joining the same template are added to the existing runtime group.

### Ad-Hoc Groups

If `allowEmployeeCreatedGroups` is enabled in `TipBankSettings`, employees can start their own tip groups from `/crew/tip-group` without an admin-defined template. The creator becomes the group owner.

---

## Database Schema

### Enums

```prisma
enum TipGroupStatus {
  active
  closed
}

enum TipGroupSplitMode {
  equal
  custom
  role_weighted
  hours_weighted
}

enum TipGroupMembershipStatus {
  active
  left
  pending_approval
}
```

### TipGroup

```prisma
model TipGroup {
  id         String            @id @default(cuid())
  locationId String
  createdBy  String            // Employee who started the group
  ownerId    String            // Current owner (for approvals, can be transferred)
  registerId String?           // Terminal/register
  templateId String?           // Links to TipGroupTemplate (null = ad-hoc)
  startedAt  DateTime          @default(now())
  endedAt    DateTime?
  status     TipGroupStatus    @default(active)
  splitMode  TipGroupSplitMode @default(equal)
  createdAt  DateTime          @default(now())
  updatedAt  DateTime          @updatedAt
  deletedAt  DateTime?

  memberships    TipGroupMembership[]
  segments       TipGroupSegment[]
  clockEntries   TimeClockEntry[]
  tipTransactions TipTransaction[]

  @@index([locationId])
  @@index([status])
  @@index([startedAt])
  @@index([ownerId])
  @@index([templateId])
}
```

### TipGroupMembership

```prisma
model TipGroupMembership {
  id         String                   @id @default(cuid())
  locationId String
  groupId    String
  employeeId String
  joinedAt   DateTime                 @default(now())
  leftAt     DateTime?
  role       String?                  // For role-weighted splits
  approvedBy String?                  // Owner who approved join
  status     TipGroupMembershipStatus @default(active)
  createdAt  DateTime                 @default(now())
  updatedAt  DateTime                 @updatedAt
  deletedAt  DateTime?

  @@index([groupId])
  @@index([employeeId])
  @@index([status])
  @@index([locationId])
  @@index([locationId, status])
}
```

### TipGroupSegment

```prisma
model TipGroupSegment {
  id          String    @id @default(cuid())
  locationId  String
  groupId     String
  startedAt   DateTime
  endedAt     DateTime?
  memberCount Int
  splitJson   Json      // { "emp1": 0.5, "emp2": 0.5 }
  createdAt   DateTime  @default(now())
  updatedAt   DateTime  @updatedAt
  deletedAt   DateTime?

  tipTransactions TipTransaction[]

  @@index([groupId])
  @@index([startedAt])
  @@index([locationId])
}
```

### TipGroupTemplate

```prisma
model TipGroupTemplate {
  id               String            @id @default(cuid())
  locationId       String
  name             String            // "Bar Team", "Downstairs Servers", etc.
  allowedRoleIds   Json              // Array of role IDs that can join
  defaultSplitMode TipGroupSplitMode @default(equal)
  active           Boolean           @default(true)
  sortOrder        Int               @default(0)
  createdAt        DateTime          @default(now())
  updatedAt        DateTime          @updatedAt
  deletedAt        DateTime?

  tipGroups TipGroup[]               // Runtime group instances

  @@index([locationId])
  @@index([active])
}
```

### TipTransaction

```prisma
model TipTransaction {
  id                String   @id @default(cuid())
  locationId        String
  orderId           String
  paymentId         String?
  tipGroupId        String?           // Links to TipGroup (null = individual)
  segmentId         String?           // Links to TipGroupSegment (null = individual)
  amountCents       Decimal  @db.Decimal(10, 2)
  sourceType        TipTransactionSourceType  // CARD or CASH
  kind              String   @default("tip")   // 'tip' | 'service_charge' | 'auto_gratuity'
  collectedAt       DateTime
  primaryEmployeeId String?
  ccFeeAmountCents  Decimal  @default(0) @db.Decimal(10, 2)
  idempotencyKey    String?  @unique    // "tip-txn:{orderId}:{paymentId}"
  createdAt         DateTime @default(now())
  updatedAt         DateTime @updatedAt
  deletedAt         DateTime?

  @@index([locationId])
  @@index([orderId])
  @@index([tipGroupId])
  @@index([collectedAt])
}
```

### TipLedgerEntry

```prisma
model TipLedgerEntry {
  id             String             @id @default(cuid())
  locationId     String
  ledgerId       String
  employeeId     String
  type           TipLedgerEntryType // CREDIT or DEBIT
  amountCents    Decimal            @db.Decimal(10, 2)
  sourceType     String             // DIRECT_TIP, TIP_GROUP, ROLE_TIPOUT, MANUAL_TRANSFER, etc.
  sourceId       String?            // Links to TipTransaction.id
  memo           String?
  orderId        String?
  shiftId        String?
  idempotencyKey String?            @unique  // "tip-ledger:{orderId}:{paymentId}:{employeeId}"
  createdAt      DateTime           @default(now())
  updatedAt      DateTime           @updatedAt
  deletedAt      DateTime?

  @@index([locationId])
  @@index([ledgerId])
  @@index([employeeId])
  @@index([sourceType])
  @@index([shiftId])
  @@index([createdAt])
  @@index([locationId, sourceType, createdAt])
  @@index([locationId, employeeId, createdAt])
}
```

---

## Settings Reference

All settings live in `TipBankSettings` (defined in `src/lib/settings.ts`):

| Setting | Type | Default | Description |
|---------|------|---------|-------------|
| `enabled` | boolean | true | Master switch for tip allocation |
| `tipAttributionTiming` | enum | `check_closed` | When to credit tip to segment: `check_opened`, `check_closed`, `check_both`, `per_item` |
| `lateTabTipHandling` | enum | `pool_period` | When last member clocks out with open tabs: `pool_period` (recommended) or `personal_bank` |
| `attributionModel` | enum | `primary_100` | Within-segment attribution: `primary_100` or `primary_70_assist_30` |
| `deductCCFeeFromTips` | boolean | false | Reduce CC tips by processing fee before crediting |
| `ccFeePercent` | number | 0 | CC processing fee percentage (e.g., 3.0 = 3%) |
| `allowEmployeeCreatedGroups` | boolean | true | Employees can start ad-hoc groups from `/crew/tip-group` |
| `allowStandaloneServers` | boolean | false | "No Group" option at clock-in (opt out of pooling) |
| `tableTipOwnershipMode` | enum | `ITEM_BASED` | `ITEM_BASED` (helpers get credit) or `PRIMARY_SERVER_OWNS_ALL` (primary server gets 100%) |
| `allowManagerInPools` | boolean | false | Allow managers to join tip pools |
| `poolCashTips` | boolean | false | Include cash tips in group pooling |
| `allocationMode` | enum | `ITEM_BASED` | How tips are attributed to employees |
| `chargebackPolicy` | enum | `BUSINESS_ABSORBS` | Who absorbs chargebacks |
| `allowNegativeBalances` | boolean | false | Allow employee tip balance to go negative |
| `allowEODCashOut` | boolean | true | Show "Cash Out Tips" at shift closeout |
| `requireManagerApprovalForCashOut` | boolean | false | Require manager approval for cash payout |
| `defaultPayoutMethod` | enum | `cash` | Default payout method at closeout |

---

## API Reference

### Groups

| Method | Route | Description |
|--------|-------|-------------|
| `GET` | `/api/tips/groups?locationId=...&status=active` | List active groups at location |
| `POST` | `/api/tips/groups` | Start a new group. Body: `{ locationId, initialMemberIds, splitMode?, registerId? }` |
| `GET` | `/api/tips/groups/[id]` | Get group details (members, current segment) |
| `PUT` | `/api/tips/groups/[id]` | Update group: `{ newOwnerId?, splitMode? }` |
| `DELETE` | `/api/tips/groups/[id]` | Close group (owner or TIPS_MANAGE_GROUPS permission) |

### Members

| Method | Route | Description |
|--------|-------|-------------|
| `POST` | `/api/tips/groups/[id]/members` | Add member (`action: 'add'`) or request to join (`action: 'request'`) |
| `PUT` | `/api/tips/groups/[id]/members` | Approve pending join: `{ employeeId }` |
| `DELETE` | `/api/tips/groups/[id]/members?employeeId=...` | Remove member or self-leave |

### Time Clock (group-related)

| Method | Route | Description |
|--------|-------|-------------|
| `POST` | `/api/time-clock` | Clock in. Optional `selectedTipGroupTemplateId` assigns employee to template group |
| `PUT` | `/api/time-clock` | Clock out. Returns 409 with `errorCode: 'last_group_member'` if last member. Pass `force: true` for manager override |

**Auth model:** All group API routes use `x-employee-id` header. Group owner or `TIPS_MANAGE_GROUPS` permission required for admin operations. Self-service operations (request to join, leave) only require the employee's own ID.

**Socket events:** All mutation endpoints dispatch `tip-group-update` via `dispatchTipGroupUpdate()` (fire-and-forget) with actions: `created`, `closed`, `member-joined`, `member-left`, `ownership-transferred`.

---

## Shift Summary API

### `GET /api/tips/my-shift-summary`

Returns tip group participation and earnings for a single employee's shift. Used by the crew shift report page to display the "Tip Group Earnings" section.

**Query params:**

| Param | Required | Description |
|-------|----------|-------------|
| `employeeId` | yes | The employee to query |
| `locationId` | yes | The location |
| `date` | yes | Business day date (`YYYY-MM-DD`) |

**Response:**

```json
{
  "data": {
    "hasGroup": true,
    "groups": [
      {
        "groupId": "clxyz...",
        "splitMode": "equal",
        "segments": [
          {
            "segmentId": "clxyz...",
            "startedAt": "2026-03-02T14:00:00.000Z",
            "endedAt": "2026-03-02T18:00:00.000Z",
            "memberCount": 3,
            "sharePercent": 33
          }
        ],
        "totalEarnedCents": 4500
      }
    ],
    "totalGroupEarnedCents": 4500
  }
}
```

**Implementation:** Finds the employee's `TimeClockEntry` for the given date to determine the shift window, then queries `TipGroupMembership` for groups overlapping that window, fetches segments, and sums `TipLedgerEntry` credits with `sourceType` in `['TIP_GROUP', 'TIP_GROUP_SHARE', 'DIRECT_TIP']`.

---

## Crew UI Flow (`/crew/tip-group`)

The crew-facing tip group page (`src/app/(pos)/crew/tip-group/page.tsx`) provides:

**If the employee is in a group:**
- Shows active group panel with member list, split percentages from `currentSegment.splitJson`
- Group owner is indicated with a star icon
- Owner sees pending join requests with "Approve" buttons
- Owner can "Close Group"; non-owners can "Leave Group"

**If the employee is not in a group:**
- If `allowEmployeeCreatedGroups` is enabled: "Start New Group" button opens a modal where the employee selects coworkers and split mode (equal/custom)
- If disabled: shows "Teams Managed by Admin" message
- Lists other active groups at the location with "Request to Join" buttons
- Pending requests show "Pending" badge

**Join flow:**
1. Employee taps "Request to Join" → creates `pending_approval` membership
2. Group owner sees the pending request in their group panel
3. Owner taps "Approve" → membership activated, current segment closed, new segment created with updated splits

---

## Resolved Decisions

| Question | Decision | Rationale |
|----------|----------|-----------|
| Attribution: item-level or timestamp-level? | **Timestamp-level** — `findSegmentForTimestamp()` at payment time | Simpler, no schema changes to OrderItem, handles late-settling tabs naturally |
| Late tips to employee tip bank or group pool? | **Group segment** — closed segments can receive post-close tip credits | TipTransaction links to segmentId regardless of whether segment is still open |
| Attribution: primary server or all who touched? | **Primary server only** — helpers earn through tip-out rules | Keeps attribution deterministic, prevents disputes |
| Can closed segments receive tip credits? | **Yes** — a TipTransaction can reference any segment regardless of endedAt | Handles bar tabs that settle after a segment rotates |
| What happens when last member clocks out? | **Block clock-out** with 409 `last_group_member` | Forces explicit group closeout, prevents dangling groups |
| How are ad-hoc groups vs template groups differentiated? | **`templateId` field** on TipGroup — null = ad-hoc, non-null = template-based | Same runtime model, different creation path |
| Single group or multiple? | **Single group per employee** at a time | Enforced by `findActiveGroupForEmployee()` and `assignEmployeeToTemplateGroup()` |

---

*Last updated: March 2026. See also: `docs/domains/TIPS-DOMAIN.md`, `src/lib/settings.ts` (TipBankSettings).*
