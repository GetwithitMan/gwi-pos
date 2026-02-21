# Skill 384 — Refund vs Void System (P2-P02)

## Overview

Skill 384 formalises the distinction between two separate payment reversal flows: a **void** (pre-settlement cancellation of a payment record) and a **refund** (post-settlement money-back through the Datacap processor). Both paths require manager PIN authorization and produce an audit trail, but they operate on different system states and call different Datacap API verbs. Item-level voids (comps/voids of order items before close) are a separate subsystem handled by `POST /api/orders/[id]/comp-void` and are documented independently.

## Schema Changes

A new `RefundLog` model was added to track every refund attempt and its Datacap response:

```prisma
model RefundLog {
  id              String    @id @default(cuid())
  locationId      String
  location        Location  @relation(fields: [locationId], references: [id])
  orderId         String
  order           Order     @relation(fields: [orderId], references: [id])
  paymentId       String
  payment         Payment   @relation(fields: [paymentId], references: [id])
  employeeId      String
  employee        Employee  @relation(fields: [employeeId], references: [id])

  refundAmount    Decimal
  originalAmount  Decimal
  refundReason    String
  notes           String?

  // Datacap processor reference
  datacapRecordNo String?   // Record number from original charge (for ReturnByRecord)
  datacapRefNo    String?   // Reference number returned by Datacap refund response

  // Approval chain
  approvedById    String?
  approvedAt      DateTime?

  // Receipt
  receiptPrinted    Boolean   @default(false)
  receiptPrintedAt  DateTime?

  createdAt       DateTime  @default(now())
  updatedAt       DateTime  @updatedAt
  deletedAt       DateTime?
  syncedAt        DateTime?

  @@index([locationId])
  @@index([orderId])
  @@index([paymentId])
  @@index([employeeId])
  @@index([createdAt])
  @@index([locationId, createdAt])
}
```

The `Order` model carries `refundLogs RefundLog[]`. The `Payment` model also carries `refundLogs RefundLog[]` and gains `refundedAt DateTime?` and `voidedAt DateTime?` fields on the existing `Payment` model, along with `voidedBy String?` and `voidReason String?`.

## Key Files

| File | Description |
|------|-------------|
| `src/app/api/orders/[id]/refund-payment/route.ts` | `POST` — processes a Datacap EMV return (post-settlement refund), creates `RefundLog`, updates `Payment.status` |
| `src/app/api/orders/[id]/void-payment/route.ts` | `POST` — voids a pre-settlement payment in the local DB only (no Datacap call), creates `AuditLog`, updates `Payment.status = 'voided'` |
| `src/app/api/orders/[id]/comp-void/route.ts` | `POST` — item-level void/comp before order close; `PUT` — undo a void; `GET` — void history |
| `src/components/orders/VoidPaymentModal.tsx` | Combined modal handling both void and refund; auto-selects the correct path based on `payment.settledAt` |
| `src/components/orders/ClosedOrderActionsModal.tsx` | Alternative void path from the Closed Orders management page |
| `src/app/(admin)/settings/orders/closed/page.tsx` | Closed order list page where managers can initiate voids |
| `prisma/schema.prisma` | `RefundLog` model (lines 6518-6557) |

## How It Works

### Void vs Refund Decision

The `VoidPaymentModal` auto-selects the action based on whether the payment has been settled:

```typescript
// In VoidPaymentModal useEffect:
setPendingAction(payment?.settledAt ? 'refund' : 'void')
```

- `settledAt` is null → payment is pre-settlement → **void** path.
- `settledAt` is set → payment is settled → **refund** path (requires Datacap round-trip).

### Void Path (`POST /api/orders/[id]/void-payment`)

1. Validates manager has `manager.void_payments` permission.
2. Checks payment is not already voided.
3. Wraps all writes in a single Prisma `$transaction`:
   - Updates `Payment.status = 'voided'`, sets `voidedAt`, `voidedBy`, `voidReason`.
   - Updates `Order.status = 'voided'` if no other active payments remain.
   - Creates an `AuditLog` entry with full context.
4. Fire-and-forget: dispatches socket events (`dispatchPaymentProcessed`, `dispatchOrderTotalsUpdate`).
5. Fire-and-forget: calls `handleTipChargeback()` if the payment had a tip, to reverse employee tip allocations per location policy.

No Datacap call is made. Void is a local DB operation only.

### Refund Path (`POST /api/orders/[id]/refund-payment`)

Body: `{ paymentId, refundAmount, refundReason, notes, managerId, readerId }`

1. Validates manager has `manager.void_payments` permission.
2. Validates `refundAmount > 0` and `refundAmount <= payment.amount`.
3. Guards against refunding an already-voided or already-fully-refunded payment.
4. If payment method is `credit` or `debit` AND a `readerId` is provided AND `payment.datacapRecordNo` is set, calls Datacap:

```typescript
const response = await client.emvReturn(readerId, {
  recordNo: payment.datacapRecordNo,
  invoiceNo: order.orderNumber?.toString() ?? id,
  amount: refundAmount,
  cardPresent: false,
})
```

5. If Datacap returns anything other than `cmdStatus === 'Approved'`, returns HTTP 422 with the processor's text response. The DB is not written.
6. On approval, runs a Prisma `$transaction`:
   - Updates `Payment.status` to `'refunded'` (full) or keeps `'completed'` (partial).
   - Sets `Payment.refundedAt`.
   - Creates a `RefundLog` record with `datacapRecordNo` and `datacapRefNo`.
   - Creates an `AuditLog` entry.
7. Returns `{ refundLog: { id, refundAmount, refundReason, createdAt }, isPartial }`.

### Partial Refunds

A refund is partial when `refundAmount < payment.amount`. In this case the payment status stays `'completed'` (not `'refunded'`). The `RefundLog.originalAmount` always records the full payment amount for reconciliation.

### Item-Level Void (comp-void)

`POST /api/orders/[id]/comp-void` handles voiding or comping individual line items from an open order (before payment). This is separate from payment-level voids and does not touch the `RefundLog` model. Key behaviors:

- Supports remote manager approval (6-digit code from Skill 121).
- Optimistic concurrency: sends `version` field, rejects with HTTP 409 if order was modified on another terminal.
- Deducts inventory fire-and-forget: comps always deduct as waste; voids deduct only if `wasMade === true` or the void reason is in the `WASTE_VOID_REASONS` list.
- Auto-closes the order if all items are voided/comped (`activeItems.length === 0`).
- `PUT` on the same route undoes a void, restoring `OrderItem.status = 'active'`.

## Configuration

- No special configuration is required for the void path.
- For refunds to flow through Datacap, the location must have an active `PaymentReader` with `communicationMode = 'local'` and valid Datacap credentials (`merchantId`, `operatorId`).
- The refund UI sends the selected `readerId`; if no reader is selected (e.g., cash payment), the Datacap round-trip is skipped and only the DB record is created.
- Manager PIN is required for all void and refund actions. The `manager.void_payments` permission must be on the manager's role.

## Notes

- **No independent admin page for refunds**: Refunds appear in the order's payment history via the closed orders view and daily/shift reports. There is no standalone `/settings/orders/refunds` list page yet — `RefundLog` records are exposed through order detail queries.
- **Cannot refund a voided payment**: The API guards: `if (payment.status === 'voided') return 403`.
- **Cannot double-refund**: `if (payment.status === 'refunded') return 403`. Partial refunds do not set status to `'refunded'` so a second partial refund against the same payment is technically possible (the DB allows it). Prevent over-refunding by validating against `payment.amount` at the API level.
- **Cash and house-account payments**: `isCardPayment` is false → Datacap call is skipped → the `RefundLog` is still created for record-keeping with `datacapRefNo = null`.
- **Tip chargeback on void**: When a payment with a tip is voided, `handleTipChargeback()` runs fire-and-forget. If the tip was never allocated (e.g., cash payment with no tip transaction), this logs a warning but does not fail the void.
- **Audit trail**: Every void and refund produces an `AuditLog` entry with `action: 'payment_voided'` or `action: 'payment_refunded'`, including IP address and user-agent.
