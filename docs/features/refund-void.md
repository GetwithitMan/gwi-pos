# Feature: Refund and Void

> **Before editing this feature:** Read `_CROSS-REF-MATRIX.md` → find this feature → read every listed dependency doc.

## Summary

The Refund and Void system formalizes two distinct payment reversal paths. A **void** cancels a pre-settlement payment record entirely in the local database — no Datacap round-trip is needed. A **refund** reverses a post-settlement payment through the Datacap processor (EMV return), then records the result. Both paths require manager PIN authorization and produce a full audit trail. All refunds are logged in the `RefundLog` model. Item-level voids (comping or voiding individual order items from an open order) are a separate subsystem handled by `POST /api/orders/[id]/comp-void` and documented separately.

## Status

`Active`

## Repos Involved

| Repo | Role | Coverage |
|------|------|----------|
| `gwi-pos` | API endpoints, modal UI, audit trail, Datacap integration | Full |
| `gwi-android-register` | Voided/refunded payment state synced to Android | Partial |
| `gwi-cfd` | None | None |
| `gwi-backoffice` | None | None |
| `gwi-mission-control` | None | None |

---

## UI Entry Points

| Interface | Path / Screen | Who Accesses |
|-----------|--------------|--------------|
| POS Web | Order detail panel → payment history | Managers only |
| POS Web | `/settings/orders/closed` | Managers only |

The `VoidPaymentModal` is accessible from the order detail view. It auto-selects the void or refund path based on whether the payment has a `settledAt` timestamp. The `ClosedOrderActionsModal` provides an alternate entry point from the closed orders management page.

---

## Code Locations

### gwi-pos

| File / Directory | Purpose |
|-----------------|---------|
| `src/app/api/orders/[id]/void-payment/route.ts` | `POST` — voids a pre-settlement payment (local DB only, no Datacap call) |
| `src/app/api/orders/[id]/refund-payment/route.ts` | `POST` — processes a post-settlement Datacap EMV return, creates `RefundLog` |
| `src/app/api/orders/[id]/comp-void/route.ts` | `POST`/`PUT`/`GET` — item-level comp/void for open orders (separate subsystem) |
| `src/components/orders/VoidPaymentModal.tsx` | Combined modal; auto-selects void vs. refund path based on `payment.settledAt` |
| `src/components/orders/ClosedOrderActionsModal.tsx` | Alternative void/refund entry from closed orders page |
| `src/app/(admin)/settings/orders/closed/page.tsx` | Closed orders list where managers can initiate voids |

---

## API Endpoints

| Method | Route | Auth | Description |
|--------|-------|------|-------------|
| `POST` | `/api/orders/[id]/void-payment` | Manager PIN (`manager.void_payments`) | Voids a pre-settlement payment in local DB only |
| `POST` | `/api/orders/[id]/refund-payment` | Manager PIN (`manager.void_payments`) | Processes a Datacap EMV return for a settled payment |
| `GET` | `/api/orders/[id]/comp-void` | Employee PIN | Retrieves item-level void history for an order |
| `POST` | `/api/orders/[id]/comp-void` | Manager PIN or remote approval | Voids or comps an individual order item |
| `PUT` | `/api/orders/[id]/comp-void` | Manager PIN | Undoes a prior item-level void |

### POST /api/orders/[id]/refund-payment — request body

```json
{
  "paymentId": "pay_abc123",
  "refundAmount": 25.00,
  "refundReason": "Customer complaint",
  "notes": "Product returned",
  "managerId": "emp_mgr1",
  "readerId": "reader-1"
}
```

### POST /api/orders/[id]/refund-payment — success response

```json
{
  "refundLog": {
    "id": "rfl_xyz",
    "refundAmount": 25.00,
    "refundReason": "Customer complaint",
    "createdAt": "2026-03-03T14:22:00Z"
  },
  "isPartial": false
}
```

---

## Socket Events

### Emitted (POS → Clients)

| Event | Payload | Trigger |
|-------|---------|---------|
| `payment:processed` | `{ orderId, paymentId, status }` | After void or refund is persisted |
| `order:totals_updated` | `{ orderId, totals }` | After void changes the order balance |

---

## Data Model

### RefundLog

```
RefundLog {
  id              String          // cuid
  locationId      String          // always filter by this
  orderId         String
  paymentId       String
  employeeId      String          // who initiated the refund
  refundAmount    Decimal
  originalAmount  Decimal         // full payment amount for reconciliation
  refundReason    String
  notes           String?
  datacapRecordNo String?         // original charge record (for ReturnByRecord)
  datacapRefNo    String?         // reference returned by Datacap refund response
  approvedById    String?         // manager who approved
  approvedAt      DateTime?
  receiptPrinted  Boolean
  receiptPrintedAt DateTime?
  createdAt       DateTime
  deletedAt       DateTime?
  syncedAt        DateTime?
}
```

### Payment (relevant refund/void fields)

```
Payment {
  id              String
  locationId      String
  status          PaymentStatus   // 'completed' | 'voided' | 'refunded'
  settledAt       DateTime?       // determines void vs. refund path
  refundedAmount  Decimal         // running total of refunds against this payment
  refundedAt      DateTime?
  refundReason    String?
  voidedAt        DateTime?
  voidedBy        String?         // Employee ID
  voidReason      String?
  datacapRecordNo String?         // needed for void and EMV return calls
  refundLogs      RefundLog[]
  deletedAt       DateTime?
}
```

---

## Business Logic

### Void vs. Refund Decision

The `VoidPaymentModal` auto-selects the action based on `payment.settledAt`:

```typescript
setPendingAction(payment?.settledAt ? 'refund' : 'void')
```

- `settledAt` is `null` → pre-settlement → **void path** (local DB change only)
- `settledAt` is set → post-settlement → **refund path** (requires Datacap round-trip)

### Void Path

1. Validates manager has `manager.void_payments` permission.
2. Checks payment is not already voided.
3. Runs a Prisma `$transaction`:
   - Sets `Payment.status = 'voided'`, writes `voidedAt`, `voidedBy`, `voidReason`.
   - Sets `Order.status = 'voided'` if no other active payments remain.
   - Creates an `AuditLog` entry with full context (action: `payment_voided`, IP, user-agent).
4. Fire-and-forget: dispatches `payment:processed` and `order:totals_updated` socket events.
5. Fire-and-forget: calls `handleTipChargeback()` if the payment had a tip, to reverse employee tip allocations.

No Datacap call is made. Void is a local DB operation only.

### Refund Path

1. Validates manager has `manager.void_payments` permission.
2. Validates `refundAmount > 0` and `refundAmount <= payment.amount`.
3. Guards against refunding a voided or already-fully-refunded payment.
4. If payment method is `credit` or `debit`, `readerId` is provided, and `payment.datacapRecordNo` is set, calls Datacap:

```typescript
const response = await client.emvReturn(readerId, {
  recordNo: payment.datacapRecordNo,
  invoiceNo: order.orderNumber?.toString() ?? id,
  amount: refundAmount,
  cardPresent: false,
})
```

5. If Datacap returns anything other than `cmdStatus === 'Approved'`, returns HTTP 422 with the processor's text response. The database is not written.
6. On approval, runs a Prisma `$transaction`:
   - Updates `Payment.status` to `'refunded'` (full refund) or leaves it as `'completed'` (partial).
   - Sets `Payment.refundedAt`.
   - Creates a `RefundLog` record.
   - Creates an `AuditLog` entry (action: `payment_refunded`).

### Partial Refunds

A refund is partial when `refundAmount < payment.amount`. The payment status stays `'completed'`; only a full refund sets status to `'refunded'`. The `RefundLog.originalAmount` always records the full payment amount for reconciliation. A second partial refund against the same payment is possible as long as the cumulative total does not exceed `payment.amount`.

### Item-Level Void (comp-void — separate subsystem)

`POST /api/orders/[id]/comp-void` handles voiding or comping individual line items from an open order before payment. Key behaviors:

- Supports remote manager approval (6-digit code, Skill 122). See `docs/features/remote-void-approval.md`.
- Optimistic concurrency: `version` field sent by client; HTTP 409 if order was modified on another terminal.
- Deducts inventory fire-and-forget: comps always deduct as waste; voids deduct only if `wasMade === true` or the void reason is in `WASTE_VOID_REASONS`.
- Auto-closes the order if all items are voided/comped.
- `PUT` undoes a void, restoring `OrderItem.status = 'active'`.

This path does not touch `RefundLog` and does not require Datacap.

### Edge Cases & Business Rules

- A voided payment cannot be refunded: the API returns HTTP 403 if `payment.status === 'voided'`.
- A fully refunded payment cannot be refunded again: HTTP 403 if `payment.status === 'refunded'`.
- Cash and house-account payments: `isCardPayment` is false, so the Datacap call is skipped. A `RefundLog` record is still created with `datacapRefNo = null` for record-keeping.
- Tip chargeback on void: `handleTipChargeback()` runs fire-and-forget. If the tip was never allocated, a warning is logged but the void does not fail.
- For refunds to flow through Datacap, the location must have an active `PaymentReader` with `communicationMode = 'local'` and valid Datacap credentials.

---

## Cross-Feature Dependencies

> See `_CROSS-REF-MATRIX.md` for full matrix.

### This feature MODIFIES these features:

| Feature | How / Why |
|---------|-----------|
| Payments | Updates `Payment.status`, `voidedAt`, `refundedAt`; creates `RefundLog` |
| Tips | Void triggers `handleTipChargeback()` to reverse tip allocations |
| Reports | Refunds and voids affect daily/shift revenue totals |
| Orders | Void may set `Order.status = 'voided'` if no active payments remain |

### These features MODIFY this feature:

| Feature | How / Why |
|---------|-----------|
| Roles & Permissions | `manager.void_payments` permission gates all void and refund actions |
| Hardware | Refund path requires an active Datacap reader to perform EMV return |

### BEFORE CHANGING THIS FEATURE, VERIFY:

- [ ] **Payments** — `Payment.status` transitions must remain `completed → voided` (pre-settlement) or `completed → refunded` (post-settlement); no other transitions are valid
- [ ] **Tips** — tip chargeback must fire on every payment void; verify `handleTipChargeback()` call is present
- [ ] **Reports** — refund amounts must be deducted from revenue totals in daily and shift reports
- [ ] **Permissions** — `manager.void_payments` must be present on the role; never allow standard employees to void
- [ ] **Offline** — void path is local DB only and works offline; refund path requires network access to Datacap
- [ ] **Socket** — `payment:processed` and `order:totals_updated` must fire after any void or refund

---

## Permissions Required

| Action | Permission Key | Level |
|--------|---------------|-------|
| Void payment | `manager.void_payments` | High |
| Refund payment | `manager.void_payments` | High |
| Item-level void/comp | Manager PIN or remote approval | High |

---

## Known Constraints & Limits

- There is no standalone `/settings/orders/refunds` list page. Refund history is visible via order detail queries and daily/shift reports.
- Partial refunds do not change `Payment.status` to `'refunded'`, so a second partial refund is technically allowed. Over-refunding is prevented at the API level by validating against `payment.amount`.
- The void path produces no receipt by default. The refund path sets `RefundLog.receiptPrinted` when a receipt is printed.
- The `AuditLog` entries for voids and refunds include IP address and user-agent for forensic use.
- Refund via `CreditByRecordNo` (sale-by-record return) is the same Datacap verb as `EMVRefund` in this implementation; `payment.datacapRecordNo` must be populated for the call to succeed.

---

## Android-Specific Notes

Voided and refunded payment statuses are synced to Android via the standard payment sync path. Android does not initiate voids or refunds; those actions are manager-only from the POS web UI. The Android payment history screen reflects `payment.status` and displays voided/refunded states correctly.

---

## Related Docs

- **Feature doc:** `docs/features/payments.md`
- **Feature doc:** `docs/features/roles-permissions.md`
- **Feature doc:** `docs/features/hardware.md`
- **Architecture guide:** `docs/guides/PAYMENTS-RULES.md`
- **Skills:** Skill 384 (see `docs/skills/384-REFUND-VOID.md`)

---

*Last updated: 2026-03-03*
