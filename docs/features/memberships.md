# Feature: Memberships

> **Before editing this feature:** Read `_CROSS-REF-MATRIX.md` → find Memberships → read every listed dependency doc.

## Summary
Recurring membership subscriptions for customers. Supports enrollment, automated billing via Datacap PayAPI (card-not-present), retry/dunning on decline, pause/resume, cancel (immediate or at-period-end), mid-cycle plan changes with proration, and manual charge retry. Billing runs via Vercel cron every 6 hours. Uses Datacap's `RecurringData` chain for token reuse compliance.

## Status
`Active`

## Repos Involved
| Repo | Role | Coverage |
|------|------|----------|
| `gwi-pos` | API, admin UI, billing processor, cron | Full |

---

## UI Entry Points

| Interface | Path / Screen | Who Accesses |
|-----------|--------------|--------------|
| Admin | `/memberships` | Managers |
| Admin | `/memberships/plans` | Managers |
| Admin | `/reports/memberships` | Managers |
| Customer Detail | Customer → Memberships tab | Managers |

---

## Code Locations

### gwi-pos
| File / Directory | Purpose |
|-----------------|---------|
| `src/lib/membership/types.ts` | Enums + table interfaces (canonical types) |
| `src/lib/membership/state-machine.ts` | Status + billing transition validation |
| `src/lib/membership/billing-processor.ts` | Cron billing: lease → charge → atomic write |
| `src/lib/membership/dunning.ts` | Grace period expiry + cancel-at-period-end enforcement |
| `src/lib/membership/proration.ts` | Mid-cycle plan change + signup proration |
| `src/lib/membership/idempotency.ts` | Typed idempotency key generation (6 charge types) |
| `src/lib/membership/decline-rules.ts` | Decline classification (hard/soft/processor/config) |
| `src/lib/membership/emails.ts` | 8 email templates (welcome, charge, failed, cancel, etc.) |
| `src/app/api/memberships/route.ts` | POST (enroll), GET (list for location) |
| `src/app/api/memberships/plans/route.ts` | POST (create plan), GET (list plans) |
| `src/app/api/memberships/plans/[id]/route.ts` | PUT (update plan), DELETE (soft-delete plan) |
| `src/app/api/memberships/[id]/route.ts` | GET (detail), PUT (update metadata) |
| `src/app/api/memberships/[id]/charges/route.ts` | GET (charge history for membership) |
| `src/app/api/memberships/[id]/events/route.ts` | GET (event log for membership) |
| `src/app/api/memberships/[id]/pause/route.ts` | POST — pause membership |
| `src/app/api/memberships/[id]/resume/route.ts` | POST — resume membership |
| `src/app/api/memberships/[id]/cancel/route.ts` | POST — cancel (immediate or at-period-end) |
| `src/app/api/memberships/[id]/replace-card/route.ts` | POST — replace saved card |
| `src/app/api/memberships/[id]/change-plan/route.ts` | POST — change plan (immediate or next period) |
| `src/app/api/memberships/[id]/preview-change-plan/route.ts` | POST — preview proration (read-only) |
| `src/app/api/memberships/[id]/preview-cancel/route.ts` | POST — preview cancel impact (read-only) |
| `src/app/api/memberships/[id]/retry/route.ts` | POST — manual charge retry |
| `src/app/api/cron/process-memberships/route.ts` | GET — cron: billing + dunning per location |
| `src/lib/socket-dispatch.ts` | `dispatchMembershipUpdate()` — real-time events |
| `src/lib/settings.ts` | `MembershipSettings` in Location.settings |
| `src/lib/permission-registry.ts` | 2 permission keys for memberships |
| `scripts/migrations/038-memberships.js` | Schema migration (4 tables + indexes) |

---

## API Endpoints

| Method | Route | Auth | Description |
|--------|-------|------|-------------|
| `POST` | `/api/memberships` | `admin.manage_memberships` | Enroll customer in plan |
| `GET` | `/api/memberships` | `admin.manage_memberships` | List memberships for location |
| `GET` | `/api/memberships/[id]` | `admin.manage_memberships` | Membership detail |
| `PUT` | `/api/memberships/[id]` | `admin.manage_memberships` | Update metadata |
| `GET` | `/api/memberships/[id]/charges` | `admin.manage_memberships` | Charge history |
| `GET` | `/api/memberships/[id]/events` | `admin.manage_memberships` | Event log |
| `POST` | `/api/memberships/[id]/pause` | `admin.manage_memberships` | Pause membership |
| `POST` | `/api/memberships/[id]/resume` | `admin.manage_memberships` | Resume membership |
| `POST` | `/api/memberships/[id]/cancel` | `admin.manage_memberships` | Cancel membership |
| `POST` | `/api/memberships/[id]/replace-card` | `admin.manage_memberships` | Replace card on file |
| `POST` | `/api/memberships/[id]/change-plan` | `admin.manage_memberships` | Change plan |
| `POST` | `/api/memberships/[id]/preview-change-plan` | `admin.manage_memberships` | Preview proration |
| `POST` | `/api/memberships/[id]/preview-cancel` | `admin.manage_memberships` | Preview cancel impact |
| `POST` | `/api/memberships/[id]/retry` | `admin.retry_membership_charge` | Manual charge retry |
| `POST` | `/api/memberships/plans` | `admin.manage_memberships` | Create plan |
| `GET` | `/api/memberships/plans` | `admin.manage_memberships` | List plans |
| `PUT` | `/api/memberships/plans/[id]` | `admin.manage_memberships` | Update plan |
| `DELETE` | `/api/memberships/plans/[id]` | `admin.manage_memberships` | Soft-delete plan |
| `GET` | `/api/cron/process-memberships` | Cron secret | Billing + dunning |

---

## Socket Events

### Emitted (POS → Clients)
| Event | Payload | Trigger |
|-------|---------|---------|
| `membership:updated` | `{ action, membershipId, customerId?, details? }` | Any membership mutation |

Actions: `enrolled`, `charged`, `declined`, `paused`, `resumed`, `cancelled`, `card_updated`, `expired`

---

## Data Model

### MembershipPlan
```
id                  String    @id @default(cuid())
locationId          String
name                String
description         String?
price               Decimal(10,2)
billingCycle        String    // 'weekly' | 'monthly' | 'annual'
billingDayOfMonth   Int?
billingDayOfWeek    Int?
trialDays           Int       @default(0)
setupFee            Decimal(10,2) @default(0)
benefits            Json?
maxMembers          Int?
isActive            Boolean   @default(true)
sortOrder           Int       @default(0)
currency            String    @default('USD')
```

### Membership
```
id                  String    @id @default(cuid())
locationId          String
customerId          String
planId              String
savedCardId         String?

status              String    // trial | active | paused | cancelled | expired
billingStatus       String    // current | past_due | retry_scheduled | uncollectible
statusReason        String?

currentPeriodStart  DateTime?
currentPeriodEnd    DateTime?
nextBillingDate     DateTime?
trialEndsAt         DateTime?

priceAtSignup       Decimal(10,2)?
billingCycle        String?
currency            String    @default('USD')

recurringData       String?   // Datacap recurring chain token
lastToken           String?   // last-used Datacap multi-use token
version             Int       @default(1)

startedAt           DateTime?
endedAt             DateTime?
lastChargedAt       DateTime?

failedAttempts      Int       @default(0)
lastFailedAt        DateTime?
lastFailReason      String?
nextRetryAt         DateTime?

pausedAt            DateTime?
pauseResumeDate     DateTime?

cancelledAt         DateTime?
cancellationReason  String?
cancelAtPeriodEnd   Boolean   @default(false)
cancelEffectiveAt   DateTime?

billingLockedAt     DateTime?   // Lease lock for concurrent billing
billingLockId       String?
billingLockExpiresAt DateTime?
```

### MembershipCharge
```
id                  String    @id @default(cuid())
locationId          String
membershipId        String
subtotalAmount      Decimal(10,2)?
taxAmount           Decimal(10,2)?
totalAmount         Decimal(10,2)?
status              String    // pending | approved | declined | voided | refunded
chargeType          String    // setup_fee | initial | renewal | retry | proration | manual
failureType         String?   // decline | processor_error | timeout | config_error
attemptNumber       Int       @default(1)
retryNumber         Int       @default(0)
isProrated          Boolean   @default(false)
proratedFromAmount  Decimal(10,2)?
datacapRefNo        String?
datacapAuthCode     String?
datacapToken        String?
recurringDataSent   String?
recurringDataReceived String?
invoiceNo           String?
declineReason       String?
returnCode          String?
processorResponseMessage String?
idempotencyKey      String?   @unique
```

### MembershipEvent
```
id                  String    @id @default(cuid())
locationId          String
membershipId        String
eventType           String    // 17 event types (see types.ts)
details             Json?
employeeId          String?
```

---

## Business Logic

### Enrollment Flow
1. Manager selects customer + plan → `POST /api/memberships`
2. If plan has `trialDays > 0`: status = `trial`, trialEndsAt set
3. If plan has `setupFee > 0`: immediate PayAPI charge (chargeType = setup_fee)
4. Otherwise: status = `active`, first billing cycle starts immediately

### Billing Cycle (Automated)
1. Cron runs every 6 hours → `GET /api/cron/process-memberships`
2. For each location with memberships enabled:
   a. **Billing processor:** acquires 5-minute leases on due memberships, charges via PayAPI
   b. **Dunning processor:** expires past-due memberships beyond grace period, enforces cancel-at-period-end
3. On charge success: advance period, reset failure counters, update recurring chain
4. On decline: classify (hard → uncollectible, soft → schedule retry per `retryScheduleDays`)

### Retry / Dunning
- Default retry schedule: `[0, 3, 7]` days (configurable in settings)
- Hard declines (stolen, expired, lost) → immediately `uncollectible`
- Soft declines → `retry_scheduled` with exponential schedule
- After `gracePeriodDays` (default 14): status → `expired` if billing not resolved

### Pause / Resume
- **Pause:** status → paused, clears nextBillingDate (stops billing)
- **Resume:** status → active, starts fresh cycle, nextBillingDate = NOW (bills on next cron)

### Cancel
- **Immediate:** status → cancelled, endedAt = NOW
- **At-period-end:** cancelAtPeriodEnd = true, cancelEffectiveAt = currentPeriodEnd (dunning enforces)

### Plan Change
- **Immediate:** calculateProration() → charge net difference via PayAPI → update plan
- **Next period:** store pending change, applied at next renewal

### Replace Card
- Validates new SavedCard belongs to same customer + location
- Rejects if billing lock active (409)
- Resets `recurringData` to `'Recurring'` (new chain starts)

### Manual Retry
- Elevated permission: `admin.retry_membership_charge`
- Generates unique requestId → idempotency key → PayAPI sale
- Same atomic write pattern as billing processor

---

## State Machines

### Membership Status Transitions
```
trial     → active, cancelled
active    → paused, cancelled, expired
paused    → active, cancelled
cancelled → active (re-enrollment)
expired   → (terminal)
```

### Billing Status Transitions
```
current         → past_due, retry_scheduled
past_due        → retry_scheduled, current, uncollectible
retry_scheduled → current, past_due, uncollectible
uncollectible   → current (card update)
```

### Status Terminology
- **cancelled** = voluntary (customer or manager requested)
- **expired** = involuntary (dunning exhausted, grace period exceeded)

---

## Cross-Feature Dependencies

> See `_CROSS-REF-MATRIX.md` for full matrix.

### This feature DEPENDS ON:
| Feature | How / Why |
|---------|-----------|
| Customers | Customer record required for enrollment |
| SavedCards | Card-on-file for recurring billing |
| Payments / Datacap | PayAPI for card-not-present charges |
| Settings | Membership config (enabled, grace period, retry schedule) |
| Reports | Membership analytics and revenue reporting |

### These features are MODIFIED BY this feature:
| Feature | How / Why |
|---------|-----------|
| Customers | Customer detail page shows membership status |

### BEFORE CHANGING THIS FEATURE, VERIFY:
- [ ] **Payments** — does this change affect PayAPI charge flow?
- [ ] **Settings** — does this change add/modify membership settings?
- [ ] **Permissions** — does this action need a new permission gate?
- [ ] **RecurringData** — does this change break the Datacap chain?
- [ ] **Idempotency** — does this charge type have a unique key?
- [ ] **Socket** — does this change need a new socket action type?

---

## Permissions Required

| Action | Permission Key | Level |
|--------|---------------|-------|
| Manage memberships (CRUD, pause, resume, cancel, card) | `admin.manage_memberships` | Manager |
| Manual charge retry | `admin.retry_membership_charge` | Admin |

---

## Known Constraints & Limits

- **RecurringData chain integrity:** Each PayAPI response returns `recurringData` that MUST be sent on the next charge. New chain starts on card replacement. Chain NEVER crosses subscriptions.
- **Single-writer rule:** Billing lock (5-minute lease) prevents concurrent charges on same membership. Manual retry rejects with 409 if lock active.
- **Atomic write path:** Charge insert + membership update + event insert must succeed together.
- **Typed idempotency keys:** 6 key formats prevent duplicate charges: renewal, setup_fee, retry, proration, manual, initial.
- **No refunds on cancel:** v1 does not prorate refunds on mid-cycle cancellation. `refundEligible: false` in preview.
- **SavedCard table must exist:** Migration 038 creates membership tables but assumes `SavedCard` table already exists from earlier migration.

---

## Operator Runbook

### How to Manually Retry a Charge
1. Navigate to Memberships → find the declined membership
2. Verify card on file is still valid (check card expiry)
3. Click "Retry Charge" — requires `admin.retry_membership_charge` permission
4. System generates unique requestId, charges via PayAPI
5. On success: billingStatus resets to `current`, failure counters cleared
6. On failure: new decline recorded, billingStatus may escalate

### How to Handle Expired Cards
1. Customer provides new card → tokenize via Datacap
2. Create SavedCard record for customer
3. Use "Replace Card" action on the membership
4. System resets `recurringData` chain (new card = new chain)
5. If membership was `uncollectible`, manual retry is now possible

### How to Reconcile Duplicate Charges
1. Check MembershipCharge table — look for duplicate `idempotencyKey` values
2. If two `approved` charges exist for same key: one is a system bug
3. Void the duplicate via Datacap PayAPI using the `datacapRefNo`
4. Insert a MembershipEvent with type `charge_voided` for audit trail

### State Transition Quick Reference
| Current Status | User Action | Result |
|---------------|-------------|--------|
| active | Pause | paused, billing stops |
| paused | Resume | active, fresh cycle, bills immediately |
| active/trial | Cancel (immediate) | cancelled, access ends now |
| active/trial | Cancel (at period end) | stays active until currentPeriodEnd |
| active | Card expires | charge fails → retry_scheduled → past_due → expired |
| expired | — | Terminal state. Must re-enroll. |

---

## Settings

Stored in `Location.settings.memberships`:

```typescript
interface MembershipSettings {
  enabled: boolean           // default: false
  gracePeriodDays: number    // default: 14
  retryScheduleDays: number[] // default: [0, 3, 7]
}
```

---

## Related Docs
- **Cross-ref matrix:** `docs/features/_CROSS-REF-MATRIX.md`
- **Payment rules:** `docs/guides/PAYMENTS-RULES.md`
- **Settings:** `docs/features/settings.md`
- **Customers:** `docs/features/customers.md`

---

*Last updated: 2026-03-10*
