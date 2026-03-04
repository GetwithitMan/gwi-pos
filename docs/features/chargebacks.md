# Feature: Chargebacks

> **Before editing this feature:** Read `_CROSS-REF-MATRIX.md` → find this feature → read every listed dependency doc.

## Summary

Chargeback case management gives venue managers a structured way to track, respond to, and record the outcome of customer payment disputes. When a customer disputes a charge with their card issuer, the venue has a limited window (set by the processor's `responseDeadline`) to submit evidence and contest the dispute. This feature creates a `ChargebackCase` record — either manually or auto-matched to an existing `Payment` — and tracks the case through its lifecycle from `open` through response to `won` or `lost`. Evidence links (order snapshot, receipt, signature data on the payment record) are embedded in the associated records. If the chargeback covers a payment on which tips were allocated, the system creates a `TipDebt` against the relevant employee to recover the disputed tip amount.

## Status

`Active` — built and in production; verify current behavior against this doc before extending.

## Repos Involved

| Repo | Role | Coverage |
|------|------|----------|
| `gwi-pos` | API, case creation, auto-matching, audit log | Full |
| `gwi-android-register` | None | None |
| `gwi-cfd` | None | None |
| `gwi-backoffice` | None | None |
| `gwi-mission-control` | None | None |

---

## UI Entry Points

| Interface | Path / Screen | Who Accesses |
|-----------|--------------|--------------|
| POS Web | Admin chargeback management page (exact path TBD) | Managers only |

No dedicated admin UI page path was identified in the current codebase. The API is built; a full management UI should be verified or built before extending this feature.

---

## Code Locations

### gwi-pos

| File / Directory | Purpose |
|-----------------|---------|
| `src/app/api/chargebacks/route.ts` | `POST` (create case) + `GET` (list cases) |
| `prisma/schema.prisma` | `ChargebackCase` model, `ChargebackStatus` enum, `TipDebt` model |

---

## API Endpoints

| Method | Route | Auth | Description |
|--------|-------|------|-------------|
| `POST` | `/api/chargebacks` | Manager | Creates a chargeback case; auto-matches to Payment if found |
| `GET` | `/api/chargebacks` | Manager | Lists chargeback cases for a location; supports `?status=` filter |

### POST /api/chargebacks — request body

```json
{
  "locationId": "loc_abc",
  "cardLast4": "4242",
  "cardBrand": "Visa",
  "amount": 45.00,
  "chargebackDate": "2026-03-01T00:00:00Z",
  "reason": "Item not received",
  "reasonCode": "13.1",
  "responseDeadline": "2026-03-15T00:00:00Z",
  "notes": "Customer claims they never received the order."
}
```

Required fields: `locationId`, `cardLast4`, `amount`, `chargebackDate`.

### POST /api/chargebacks — success response

```json
{
  "data": {
    "id": "cb_xyz",
    "autoMatched": true,
    "matchedOrderId": "ord_abc",
    "matchedPaymentId": "pay_def"
  }
}
```

`autoMatched: false` when no payment record was found matching the card and amount within the 30-day lookback window.

### GET /api/chargebacks — query parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| `locationId` | String | Required |
| `status` | String | Optional. Filter: `open`, `responded`, `won`, `lost` |

Returns up to 100 cases ordered by `chargebackDate` descending.

---

## Socket Events

None. Chargeback management is a synchronous admin operation with no real-time socket events.

---

## Data Model

### ChargebackCase

```
ChargebackCase {
  id               String             // cuid
  locationId       String             // always filter by this

  // Auto-matched order and payment (nullable if no match found)
  orderId          String?
  paymentId        String?

  // Card info used for matching
  cardLast4        String
  cardBrand        String?

  // Dispute details
  amount           Decimal
  chargebackDate   DateTime
  reason           String?            // Human-readable reason from bank/processor
  reasonCode       String?            // Processor reason code (e.g., "10.4" = Fraud, "13.1" = Merchandise not received)
  responseDeadline DateTime?          // Deadline to submit response evidence

  // Status lifecycle
  status           ChargebackStatus   // open | responded | won | lost
  notes            String?

  // Response tracking
  respondedAt      DateTime?          // When venue submitted evidence
  respondedBy      String?            // Employee ID who submitted the response
  responseNotes    String?
  resolvedAt       DateTime?          // When final outcome (won/lost) was recorded

  createdAt        DateTime  @default(now())
  updatedAt        DateTime  @updatedAt
  deletedAt        DateTime?
  syncedAt         DateTime?
}
```

### ChargebackStatus (enum)

```
open        // Dispute received; no response submitted yet
responded   // Venue has submitted evidence to the processor
won         // Dispute resolved in the venue's favor; charge stands
lost        // Dispute resolved in the customer's favor; funds reversed
```

### TipDebt (related model — created when chargeback covers a tipped payment)

```
TipDebt {
  id                  String         // cuid
  locationId          String
  employeeId          String         // Employee who received the disputed tip
  originalAmountCents Decimal        // Tip amount owed at chargeback time
  remainingCents      Decimal        // Outstanding balance (reduced as recovered)
  sourcePaymentId     String         // Payment that triggered the chargeback
  sourceType          String         // "CHARGEBACK" (default)
  memo                String?
  status              TipDebtStatus  // open | partial | recovered | written_off
  createdAt           DateTime
  recoveredAt         DateTime?
  writtenOffAt        DateTime?
}
```

### Evidence Fields on Related Models

The chargeback defense evidence is not stored in `ChargebackCase` itself — it lives on the associated records:

| Record | Field | Evidence |
|--------|-------|----------|
| `Payment` | `signatureData` | Base64 cardholder signature captured at time of payment |
| `Payment` | `authCode` | Processor authorization code |
| `Payment` | `cardBrand`, `cardLast4`, `entryMethod` | Card and entry method (chip vs. swipe vs. tap) |
| `DigitalReceipt` | `receiptData` | Full receipt content: items, amounts, taxes, discounts |
| `DigitalReceipt` | `signatureData`, `signatureSource` | Signature at receipt level |
| `OrderSnapshot` | *(full snapshot)* | Point-in-time order state at payment time |

---

## Business Logic

### Case Creation (Primary Flow)

1. Manager opens the chargeback entry form and enters the card information, amount, and chargeback date received from their processor or bank statement.
2. `POST /api/chargebacks` is called.
3. **Auto-matching:** The route searches `Payment` records at the same location for:
   - `cardLast4` match
   - `totalAmount` match (exact)
   - `processedAt` within 30 days before the `chargebackDate`
   - Not soft-deleted
   - Ordered by `processedAt` descending; first match wins.
4. If a match is found:
   - `orderId` and `paymentId` are set on the case.
   - The matched `Payment` is marked `needsReconciliation: true` inside a Prisma `$transaction`.
5. An `AuditLog` entry is created with `action: 'chargeback_created'` and full context (case ID, amount, card, matched IDs, reason, reason code).
6. The response indicates whether auto-matching succeeded.

### No Match Scenario

If no payment is found within the 30-day window, the case is created with `orderId: null` and `paymentId: null`. The manager can manually investigate and update the case notes. There is currently no API endpoint to subsequently link a case to a payment — this would need to be added.

### Status Lifecycle

```
open
 ├── responded   (manager submits evidence to processor)
 │    ├── won    (processor decides in venue's favor)
 │    └── lost   (processor decides in customer's favor)
 └── won / lost  (processor decides without venue response, e.g., deadline missed)
```

Status transitions and the `respondedAt` / `respondedBy` / `resolvedAt` fields are not updated by the current `POST`/`GET` routes — the `ChargebackCase` model has these fields but no dedicated PATCH/PUT endpoint exists yet to advance the status. This is a known gap.

### TipDebt Relation

When a chargeback is filed against a payment on which tips were allocated to an employee, a `TipDebt` record should be created to track recovery of that tip amount. The `TipDebt.sourceType = 'CHARGEBACK'` and `sourcePaymentId` links back to the disputed payment. The chargeback case creation route does not currently auto-create `TipDebt` records — `TipDebt` creation is handled by the tip chargeback handler (`handleTipChargeback()`) invoked from the void/refund paths, not from this route directly.

### Response Deadline Tracking

`responseDeadline` is an optional field set at case creation. The GET list endpoint returns this field so a management UI can sort or highlight cases approaching their deadline. No automated alert or escalation is built — a UI-level deadline indicator is the intended consumer of this field.

### Evidence Assembly

When preparing a chargeback response, managers should pull:
1. The linked `OrderSnapshot` — full point-in-time order state.
2. The linked `Payment` — `authCode`, `entryMethod`, `signatureData`, `cardBrand`, `cardLast4`.
3. The linked `DigitalReceipt` — `receiptData` (itemized), `signatureData`.

These are not automatically bundled by any API endpoint today. A future "export evidence package" route could assemble them.

### Edge Cases & Business Rules

- Auto-match uses exact `totalAmount` (including tip) and exact `cardLast4`. A dispute for only the base amount (excluding tip) will not match if the stored `totalAmount` differs.
- Only the most recent matching payment within 30 days is used. If multiple payments match (e.g., a customer visited twice in 30 days with the same card and amount), the most recent is selected.
- `needsReconciliation: true` on the matched `Payment` signals to reporting that this payment is under dispute and its revenue figure may be reversed.
- Soft-deleted cases (`deletedAt` set) are excluded from the GET list.
- Maximum 100 cases returned per list query (no pagination currently).

---

## Cross-Feature Dependencies

> See `_CROSS-REF-MATRIX.md` for full matrix.

### This feature MODIFIES these features:

| Feature | How / Why |
|---------|-----------|
| Payments | Sets `Payment.needsReconciliation = true` on the auto-matched payment |
| Tips | `TipDebt` records represent disputed tip amounts owed by employees; chargeback is the primary `sourceType` |
| Orders | Reads `Order` and `OrderSnapshot` for evidence context |

### These features MODIFY this feature:

| Feature | How / Why |
|---------|-----------|
| Payments | `Payment.signatureData`, `authCode`, `cardLast4`, `totalAmount` are the primary auto-match and evidence fields |
| Tips | `handleTipChargeback()` in the void/refund path creates `TipDebt` records that relate back to the disputed payment |
| Roles & Permissions | Manager-level access required for all chargeback routes |

### BEFORE CHANGING THIS FEATURE, VERIFY:

- [ ] **Payments** — auto-match logic uses `totalAmount` (amount + tip); confirm this is correct when chargebacks cover only the base sale amount
- [ ] **Tips** — confirm `TipDebt` creation is handled appropriately for the void/refund path when a chargeback is later disputed; double-creation must be prevented
- [ ] **Reports** — `needsReconciliation` on Payment should be factored into reconciliation reports; changing this field affects financial accuracy
- [ ] **Permissions** — chargeback routes must remain manager-gated; verify `withVenue()` is enforcing role checks
- [ ] **Offline** — chargeback management is an admin function and is not expected to work offline; acceptable to fail gracefully
- [ ] **Socket** — no socket events; no changes needed here unless a real-time dashboard is added

---

## Permissions Required

| Action | Permission Key | Level |
|--------|---------------|-------|
| Create chargeback case | Manager role required | High |
| List chargeback cases | Manager role required | High |
| Update case status / add response | Manager role required (endpoint TBD) | High |

No granular permission key is defined for chargebacks in the current permission registry. Access is implicitly controlled by the manager role via `withVenue()` route guards.

---

## Known Constraints & Limits

- **No status update endpoint:** The `ChargebackCase` model has `respondedAt`, `respondedBy`, `responseNotes`, `resolvedAt`, and `status` fields, but there is no `PUT /api/chargebacks/[id]` endpoint to advance status. This must be built before the full case management workflow is usable.
- **No UI page confirmed:** The API is built, but a dedicated admin UI page for chargeback management was not found in the codebase scan. Verify before extending.
- **Single match only:** Auto-matching takes the single most recent matching payment; if the wrong payment is matched, there is no API to correct the link.
- **100-record cap:** `GET /api/chargebacks` returns at most 100 records. A cursor-based pagination strategy should be added before this scales to high-volume venues.
- **TipDebt not auto-created here:** The chargeback creation route does not create `TipDebt` records. Tip debt from a chargeback is only created when a void or refund triggers `handleTipChargeback()`. If a chargeback is logged without a corresponding void/refund, tip debt will not be recorded automatically.
- **No evidence bundle export:** Evidence fields are scattered across `Payment`, `DigitalReceipt`, and `OrderSnapshot`. A future route to assemble these into a single exportable package would significantly improve dispute response workflows.
- **Soft delete only:** Cases are soft-deleted (`deletedAt`) and are excluded from the default list query. There is no hard-delete path.

---

## Android-Specific Notes

Android has no chargeback management functionality. Chargeback case creation and review is a manager-only web admin operation. Payment records synced to Android include `signatureData` and `authCode` fields that may be referenced as evidence, but this is handled on the POS/web side.

---

## Related Docs

- **Feature doc:** `docs/features/payments.md`
- **Feature doc:** `docs/features/refund-void.md`
- **Feature doc:** `docs/features/tips.md`
- **Architecture guide:** `docs/guides/PAYMENTS-RULES.md`

---

*Last updated: 2026-03-03*
