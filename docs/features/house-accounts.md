# Feature: House Accounts

> **Before editing this feature:** Read `_CROSS-REF-MATRIX.md` → find this feature → read every listed dependency doc.

## Summary

House Accounts are B2B credit lines that allow venues to extend in-house billing to regular business customers — corporate clients, frequent regulars, or partner organizations — who prefer to pay on account rather than per-visit. Instead of tendering each transaction with cash or card, the order is charged to the account, which accumulates a running balance. The business invoices the account holder on a billing cycle (monthly, weekly, or on demand) with configurable payment terms (Net 7 through Net 90). Payments are recorded manually via check, ACH, wire, cash, or card. Accounts support tax-exempt status with a Tax ID, optional linkage to a Customer profile, credit limit enforcement, and account suspension.

## Status

`Active`

## Repos Involved

| Repo | Role | Coverage |
|------|------|----------|
| `gwi-pos` | API, admin UI | Full |
| `gwi-android-register` | None | None |
| `gwi-cfd` | None | None |
| `gwi-backoffice` | None | None |
| `gwi-mission-control` | None | None |

---

## UI Entry Points

| Interface | Path / Screen | Who Accesses |
|-----------|--------------|--------------|
| Admin | `/house-accounts` | Managers only |
| Admin (Reports) | `/reports` → House Accounts aging section | Managers only |

---

## Code Locations

### gwi-pos

| File / Directory | Purpose |
|-----------------|---------|
| `src/app/api/house-accounts/route.ts` | `GET` list + `POST` create |
| `src/app/api/house-accounts/[id]/route.ts` | `GET` single, `PUT` update, `DELETE` close/soft-delete |
| `src/app/api/house-accounts/[id]/payments/route.ts` | `POST` record a payment against a balance |
| `src/app/api/reports/house-accounts/route.ts` | `GET` aging report (current / 30 / 60 / 90 / 90+ day buckets) |
| `src/app/(admin)/house-accounts/page.tsx` | Admin UI: account list, detail panel, create/edit modal, payment modal |

---

## API Endpoints

| Method | Route | Auth | Description |
|--------|-------|------|-------------|
| `GET` | `/api/house-accounts` | `withVenue` | List all house accounts for a location; optional `status` and `search` filters |
| `POST` | `/api/house-accounts` | `withVenue` | Create a new house account; enforces unique name per location |
| `GET` | `/api/house-accounts/[id]` | `withVenue` | Get a single account with last 50 transactions |
| `PUT` | `/api/house-accounts/[id]` | `withVenue` | Update account fields (name, credit limit, terms, tax status, etc.) |
| `DELETE` | `/api/house-accounts/[id]` | `withVenue` | Close account if it has history, or soft-delete if empty; blocks if balance is non-zero |
| `POST` | `/api/house-accounts/[id]/payments` | `withVenue` | Record a payment (cash, check, ACH, wire, card); uses atomic DB transaction to prevent race conditions |
| `GET` | `/api/reports/house-accounts` | `withVenue` | Aging report: accounts grouped by how long charges have been outstanding (current, 30d, 60d, 90d, 90d+) |

---

## Socket Events

None. House accounts are admin-only CRUD; no real-time socket events are emitted or consumed.

---

## Data Model

```
HouseAccount {
  id              String                     @id cuid
  locationId      String                     // always filter by this
  name            String                     // unique per location
  contactName     String?
  email           String?
  phone           String?
  address         String?

  creditLimit     Decimal  @default(0)       // 0 = unlimited
  currentBalance  Decimal  @default(0)       // positive = owes money

  paymentTerms    Int      @default(30)      // days: 0, 7, 15, 30, 45, 60, 90
  billingCycle    String   @default("monthly")  // monthly | weekly | on_demand
  lastBilledAt    DateTime?
  nextBillDate    DateTime?

  status          HouseAccountStatus @default(active)  // active | suspended | closed
  suspendedAt     DateTime?
  suspendedReason String?

  taxExempt       Boolean  @default(false)
  taxId           String?

  customerId      String?                    // optional link to Customer record

  deletedAt       DateTime?                  // soft delete
  syncedAt        DateTime?

  transactions    HouseAccountTransaction[]
}

HouseAccountTransaction {
  id              String
  locationId      String
  houseAccountId  String

  type            String    // charge | payment | adjustment | credit
  amount          Decimal   // positive = charge, negative = payment/credit
  balanceBefore   Decimal
  balanceAfter    Decimal

  orderId         String?   // order that generated this charge
  employeeId      String?   // employee who processed
  paymentMethod   String?   // cash | check | ach | wire | card
  referenceNumber String?   // check number, ACH ref, etc.
  notes           String?
  dueDate         DateTime? // due date for charge transactions

  deletedAt       DateTime?
  syncedAt        DateTime?
}

enum HouseAccountStatus {
  active
  suspended
  closed
}
```

---

## Business Logic

### Primary Flow: Charging an Order to a House Account

1. During order payment, cashier selects "Charge to Account" and picks a house account.
2. System checks account status — must be `active`; suspended accounts cannot be charged.
3. If `creditLimit > 0`, system checks that `currentBalance + orderTotal <= creditLimit`. If over limit, the charge is blocked.
4. On approval, a `HouseAccountTransaction` of type `charge` is created (positive `amount`, `orderId` linked, `dueDate` calculated as `createdAt + paymentTerms` days).
5. `currentBalance` is incremented atomically.

### Primary Flow: Recording a Payment

1. Manager opens the account detail panel in Admin → House Accounts.
2. Clicks "Record Payment", enters amount, payment method (check, cash, ACH, wire, card), optional reference number and notes.
3. `POST /api/house-accounts/[id]/payments` runs inside a DB transaction:
   - Reads current balance inside the transaction (prevents race conditions).
   - Clamps the payment to the current balance — payments cannot reduce balance below zero.
   - Atomically decrements `currentBalance` using `{ decrement: effectiveAmount }`.
   - Creates a `HouseAccountTransaction` of type `payment` with negative `amount`.
4. UI refreshes the account list and detail panel.

### Account Creation

- Name must be unique per location (enforced by `@@unique([locationId, name])` and checked by the API before insert).
- `creditLimit = 0` means unlimited credit.
- `paymentTerms` options: 0 (due on receipt), 7, 15, 30, 45, 60, 90 days.
- `billingCycle` options: `monthly`, `weekly`, `on_demand`.

### Account Lifecycle

- **Active** — can be charged and accept payments.
- **Suspended** — account blocked; no new charges. Can be reactivated by a manager.
- **Closed** — permanent; account had transaction history so it is retained for audit. Cannot be charged.
- **Soft-deleted** — `deletedAt` set; only applies to accounts with no transaction history at all.

### Delete / Close Rules

- Cannot delete or close an account that has a non-zero `currentBalance`.
- If the account has any transaction history, `DELETE` closes it (`status = closed`) rather than destroying records.
- If the account has no transactions, `DELETE` soft-deletes it (`deletedAt = now()`).

### Aging Report

- Groups outstanding balances into buckets: current (not yet overdue), 30d, 60d, 90d, 90d+.
- Aging is calculated from the oldest unpaid `charge` transaction's due date relative to today.
- Default filter: `status = active`; zero-balance accounts excluded unless `includeZeroBalance=true`.

### Edge Cases & Business Rules

- Payment methods accepted for balance repayment: `cash`, `check`, `ach`, `wire`, `card`.
- A `charge` transaction stores `orderId` so the order is traceable.
- Tax-exempt accounts should not have sales tax applied during checkout (consuming code must check `taxExempt` flag).
- The admin UI shows total outstanding balance across all active accounts in the page header.
- The UI client-side search filters by account name, contact name, and email without re-fetching.

---

## Cross-Feature Dependencies

> See `_CROSS-REF-MATRIX.md` for full matrix.

### This feature MODIFIES these features:

| Feature | How / Why |
|---------|-----------|
| Orders | An order charged to a house account creates a `HouseAccountTransaction` linked to the order via `orderId` |
| Payments | House account is a payment method alternative to cash/card |
| Reports | Aging report surfaces in the reports section |

### These features MODIFY this feature:

| Feature | How / Why |
|---------|-----------|
| Customers | A `HouseAccount` can be optionally linked to a `Customer` record |
| Tax Rules | Tax-exempt flag on account must be respected by the tax calculation on checkout |

### BEFORE CHANGING THIS FEATURE, VERIFY:

- [ ] **Orders** — if integrating "charge to account" into the order payment flow, emit order events and verify the outbox
- [ ] **Payments** — house account charges must not conflict with Datacap payment ledger
- [ ] **Reports** — aging report calculations depend on `dueDate` and `paymentTerms`; changes to transaction structure break the report
- [ ] **Permissions** — account creation and suspension require manager-level access; charging to account should be available to servers
- [ ] **Offline** — house account charges must be queued in the outbox if the NUC is offline

---

## Permissions Required

| Action | Permission Key | Level |
|--------|---------------|-------|
| View accounts | `manager.shift_review` or manager role | Standard/Manager |
| Create account | Manager role | High |
| Edit account | Manager role | High |
| Suspend / reactivate | Manager role | High |
| Record payment | Manager role | High |
| Delete / close | Manager role | Critical |
| Charge to account at POS | Employee (server / bartender) | Standard |

---

## Known Constraints & Limits

- Account names must be unique per location — duplicate names return HTTP 400.
- Credit limit of `0` means unlimited; set a non-zero value to enforce a cap.
- Payment amounts are clamped to the current balance — overpayments are not allowed via the API.
- Aging report date range is not capped (unlike the audit log which caps at 31 days).
- Balance is stored as `Decimal` in the DB but converted to `Number` in all API responses; financial comparisons must account for floating-point edge cases.
- Tax exemption is a flag only — the UI displays it but the tax exemption must be enforced by checkout-side code that reads `taxExempt` before applying tax.

---

## Android-Specific Notes

House accounts are not currently exposed in the Android register. Charging an order to a house account is a web POS / admin workflow only.

---

## Related Docs

- **Domain doc:** `docs/domains/GUEST-DOMAIN.md` (customers)
- **Feature doc:** `docs/features/customers.md`
- **Feature doc:** `docs/features/reports.md`
- **Feature doc:** `docs/features/payments.md`

---

*Last updated: 2026-03-03*
