# Feature: Payments

> **Before editing this feature:** Read `_CROSS-REF-MATRIX.md` → find Payments → read every listed dependency doc.

## Summary
Payments handles all monetary transactions in GWI POS: cash, card (Datacap VP3300/VP3350), gift cards, house accounts, and loyalty points. **Datacap is the ONLY payment processor** — Stripe, Square, and Braintree are explicitly forbidden. The system supports dual pricing (cash discount program), split payments, bar tab pre-auth/capture, offline store-and-forward, walkout recovery, and chargeback defense. Money-first philosophy: payment reliability always wins over reporting accuracy.

## Status
`Active`

## Repos Involved
| Repo | Role | Coverage |
|------|------|----------|
| `gwi-pos` | API, Datacap client, payment logic, POS UI | Full |
| `gwi-android-register` | Primary client — card reader interaction, payment flow | Full |
| `gwi-cfd` | Customer-facing display — server-driven tip prompt, approval/decline | Full |
| `gwi-backoffice` | Payment facts, settlement reporting | Partial |

---

## UI Entry Points

| Interface | Path / Screen | Who Accesses |
|-----------|--------------|--------------|
| POS Web | Order panel → "Pay" button | Servers, Bartenders, Managers |
| Android | `PayOrderUseCase` → payment flow | All FOH staff |
| CFD | Tip screen, approval display, receipt choice | Customers |
| Admin | `/reports` (payment reports) | Managers |

---

## Code Locations

### gwi-pos
| File / Directory | Purpose |
|-----------------|---------|
| `src/lib/datacap/client.ts` | DatacapClient — TCP/HTTPS transport (17 transaction types) |
| `src/lib/datacap/types.ts` | TypeScript interfaces for Datacap XML protocol |
| `src/lib/datacap/use-cases.ts` | `processSale()`, `openBarTab()`, `closeBarTab()`, `voidPayment()` |
| `src/lib/datacap/helpers.ts` | `getDatacapClient()`, `requireDatacapClient()`, `validateReader()` |
| `src/lib/datacap/xml-builder.ts` | XML request builder |
| `src/lib/datacap/xml-parser.ts` | XML response parser |
| `src/lib/datacap/sequence.ts` | Sequence number tracking per reader |
| `src/lib/datacap/reader-health.ts` | Health metrics and trending |
| `src/lib/datacap/simulator.ts` | Dev-only simulated responses |
| `src/lib/datacap/discovery.ts` | Reader discovery on LAN |
| `src/lib/datacap/constants.ts` | Error codes, timeouts, card type maps |
| `src/lib/pricing.ts` | Dual pricing — `calculateCardPrice()`, `getDualPrices()`, `roundPrice()` |
| `src/lib/socket-dispatch.ts` | `dispatchPaymentProcessed()`, `dispatchOrderClosed()` |
| `src/app/api/orders/[id]/pay/route.ts` | POST — process payment (cash/card) |
| `src/app/api/orders/[id]/void-payment/route.ts` | POST — void payment |
| `src/app/api/orders/[id]/refund-payment/route.ts` | POST — refund payment |
| `src/app/api/orders/[id]/payments/route.ts` | GET — payment history for order |
| `src/app/api/orders/[id]/open-tab/route.ts` | POST — open bar tab (pre-auth) |
| `src/app/api/orders/[id]/close-tab/route.ts` | POST — close tab (capture) |
| `src/app/api/orders/[id]/void-tab/route.ts` | POST — void entire tab |
| `src/app/api/orders/[id]/cards/route.ts` | GET/POST — manage order cards |
| `src/app/api/orders/[id]/adjust-tip/route.ts` | POST — adjust tip after payment |
| `src/app/api/orders/[id]/retry-capture/route.ts` | POST — retry failed capture |
| `src/app/api/orders/[id]/mark-walkout/route.ts` | POST — mark as walkout |
| `src/app/api/payments/tip-eligible/route.ts` | GET — card payments eligible for tip adj |
| `src/app/api/payments/sync/route.ts` | POST — sync offline-captured payment |
| `src/types/multi-surface.ts` | CFD event constants |

### gwi-android-register
| File | Purpose |
|------|---------|
| `usecase/PayOrderUseCase.kt` | Payment orchestration |
| `payment/PaymentManager.kt` | Card reader interaction |
| `payment/DatacapReader.kt` | VP3300/VP3350 communication |

### gwi-cfd
| File | Purpose |
|------|---------|
| `CFDTipScreen.kt` | Customer tip selection |
| `CFDApprovalScreen.kt` | Approved/declined display |
| `CFDReceiptScreen.kt` | Receipt choice (print/email/none) |

---

## API Endpoints

| Method | Route | Auth | Description |
|--------|-------|------|-------------|
| `POST` | `/api/orders/[id]/pay` | Employee PIN | Process payment (cash/card/gift/house) |
| `POST` | `/api/orders/[id]/void-payment` | `manager.void_payments` | Void a payment |
| `POST` | `/api/orders/[id]/refund-payment` | `manager.refunds` | Refund a payment |
| `GET` | `/api/orders/[id]/payments` | Employee PIN | List payments for order |
| `POST` | `/api/orders/[id]/open-tab` | Employee PIN | Open bar tab (pre-auth) |
| `POST` | `/api/orders/[id]/close-tab` | Employee PIN | Close tab (capture + tip) |
| `POST` | `/api/orders/[id]/void-tab` | Employee PIN | Void entire tab |
| `POST` | `/api/orders/[id]/adjust-tip` | Employee PIN | Adjust tip after close |
| `POST` | `/api/orders/[id]/retry-capture` | Employee PIN | Retry failed capture |
| `POST` | `/api/orders/[id]/mark-walkout` | Manager | Mark as walkout |
| `GET` | `/api/payments/tip-eligible` | Employee PIN | Card payments for tip adjustment |
| `POST` | `/api/payments/sync` | Employee PIN | Sync offline payment |

---

## Socket Events

### Emitted (POS → Clients)
| Event | Payload | Trigger |
|-------|---------|---------|
| `payment:applied` | `{ orderId, paymentId, status }` | Payment completed |
| `payment:voided` | `{ orderId, paymentId, reason }` | Payment voided |
| `cfd:payment-started` | `{ orderId, total }` | Server payment handler begins card phase |
| `cfd:tip-prompt` | `{ orderId, tipSuggestions[] }` | Server-dispatched tip screen on CFD |
| `cfd:processing` | `{ orderId }` | Card is being processed |
| `cfd:approved` | `{ orderId, cardLast4 }` | Transaction approved |
| `cfd:declined` | `{ orderId, reason }` | Transaction declined |
| `cfd:idle` | `{}` | CFD returns to idle |
| `cfd:signature-request` | `{ orderId }` | Signature needed |
| `cfd:receipt-sent` | `{ orderId }` | Receipt sent to CFD |

### Received (Clients → POS)
| Event | Source | Purpose |
|-------|--------|---------|
| `cfd:tip-selected` | CFD | Customer selected tip amount |
| `cfd:signature-done` | CFD | Signature captured |
| `cfd:receipt-choice` | CFD | Print/email/none selection |

---

## Data Model

### Payment
```
id                String    @id
locationId        String
orderId           String
employeeId        String?
drawerId          String?              // physical drawer that received cash (null for card/purse)
shiftId           String?              // shift active at payment time (for reconciliation)
terminalId        String?              // terminal that processed the payment
amount            Decimal              // payment amount
tipAmount         Decimal              // tip on this payment
totalAmount       Decimal              // amount + tip
paymentMethod     PaymentMethod        // cash|credit|debit|gift_card|house_account|loyalty_points
amountTendered    Decimal?             // cash: amount given by customer
changeGiven       Decimal?             // cash: change returned
roundingAdjustment Decimal?            // cash rounding adjustment (+ or -)
cardBrand         String?              // Visa, Mastercard, etc.
cardLast4         String?
authCode          String?
transactionId     String?
paymentReaderId   String?              // which PaymentReader processed this
datacapRecordNo   String?              // RecordNo token — needed for voids, adjustments, captures
datacapRefNumber  String?
datacapSequenceNo String?              // sequence number for audit trail
entryMethod       String?              // Chip|Tap|Swipe|Manual
amountRequested   Decimal?             // original amount requested (before partial approval)
amountAuthorized  Decimal?             // actual amount approved by Datacap (may differ for partial approvals)
signatureData     String?              // base64 signature captured from reader (chargeback defense)
status            PaymentStatus        // pending|completed|refunded|voided
refundedAmount    Decimal              // total amount refunded
refundedAt        DateTime?
refundReason      String?
voidedAt          DateTime?
voidedBy          String?              // employeeId who voided
voidReason        String?
settledAt         DateTime?            // when payment was settled/batched by processor
idempotencyKey    String?   @unique    // terminal+order+timestamp fingerprint for deduplication
offlineIntentId   String?   @unique    // UUID from PaymentIntentManager for deduplication
isOfflineCapture  Boolean              // was this captured while the terminal was offline (SAF)
offlineCapturedAt DateTime?            // when the offline capture was queued
offlineTerminalId String?              // which terminal queued the offline capture
safStatus         String?              // APPROVED_ONLINE|APPROVED_SAF_PENDING_UPLOAD|UPLOAD_SUCCESS|UPLOAD_FAILED|NEEDS_ATTENTION
safUploadedAt     DateTime?            // when SAF batch was uploaded to processor
safError          String?              // last SAF upload error message
cashDiscountAmount  Decimal?           // cash discount component (dual pricing)
priceBeforeDiscount Decimal?           // pre-discount card price (dual pricing)
pricingMode       String?              // "cash" or "card" — which pricing program was active at payment time
needsReconciliation Boolean            // flag for EOD reconciliation review
reconciledAt      DateTime?            // when verified against bank statement
reconciledBy      String?              // employeeId who reconciled
syncAttempts      Int                  // how many sync attempts were made
wasDuplicateBlocked Boolean            // was a duplicate blocked by idempotency check
processedAt       DateTime
```

> **The Payment model has 40+ fields — see `prisma/schema.prisma` for the complete definition.**

### OrderCard (bar tabs)
```
id            String    @id
orderId       String
recordNo      String              // Datacap token for capture
cardType      String?
cardLast4     String?
authAmount    Decimal
status        OrderCardStatus     // authorized|declined|captured|voided
capturedAmount  Decimal?
tipAmount     Decimal?
```

### PaymentReader
```
id                String    @id
locationId        String
name              String
serialNumber      String    @unique
ipAddress         String?
connectionType    String              // IP|USB|BLUETOOTH|WIFI
communicationMode String              // local|cloud|local_with_cloud_fallback|simulated
deviceType        String              // PAX|INGENICO|IDTECH
isActive          Boolean
isOnline          Boolean
avgResponseTime   Int?
successRate       Decimal?
```

---

## Business Logic

### Payment Flow (Card)
1. POS/payment handler receives the card charge request and emits `cfd:payment-started` server-side
2. CFD shows tip prompt → customer selects tip → `cfd:tip-selected` back to POS
3. POS calls `processSale()` → Datacap EMVSale to reader
4. Reader prompts card → chip/tap/swipe → auth response
5. On approval: create Payment record, emit `PAYMENT_APPLIED` event, update order
6. Fire-and-forget: tip ledger credit, inventory deductions, receipt print, socket dispatch
7. CFD shows `cfd:approved` with card last 4

### Payment Flow (Cash)
1. POS calculates `amountTendered` and `changeGiven`
2. Create Payment record with `paymentMethod: 'cash'`
3. Cash drawer opens via ESC/POS command (fire-and-forget)
4. Emit `PAYMENT_APPLIED` event, close order

### Bar Tab Pre-Auth / Capture
1. **Open tab:** `CollectCardData` reads cardholder name → `EMVPreAuth` holds configurable amount → creates `OrderCard` with `recordNo` token
2. **Add items:** Normal item append to order
3. **Close tab:** `PreAuthCaptureByRecordNo` captures final amount + tip → creates Payment → closes order
4. **Incremental auth:** If spend exceeds hold, `IncrementalAuthByRecordNo` increases hold

### Dual Pricing (Cash Discount Program)
- Menu prices are stored as **cash prices** (the lower price)
- Card price = cash price × (1 + surcharge%)
- Example: $10.00 cash → $10.40 card (at 4% surcharge)
- Applied at checkout based on payment method
- `src/lib/pricing.ts` contains all calculation functions

### Split Payments
- Multiple payments on one order via `AppliedPayment(method, amountCents)`
- Partial cash: pay $20 cash on $35 order → remaining $15 on card
- Order closes only when `paidAmountCents >= totalCents`

### Walkout Recovery
- Manager marks order as walkout → creates `WalkoutRetry`
- System auto-retries capture against stored `OrderCard.recordNo`
- Configurable max retries with declining amounts
- Status: pending → collected | exhausted | written_off

### Offline Store-and-Forward (SAF)
- If network down, reader stores transaction locally
- `safStatus` tracks: APPROVED_ONLINE → SAF_PENDING_UPLOAD → UPLOAD_SUCCESS
- Sync via `POST /api/payments/sync` with `offlineIntentId` for dedup

### Edge Cases & Business Rules
- **Idempotency:** Client generates UUID on pay button press, same key on retry
- **Double-capture prevention:** Check `order.status` and `tabStatus` before capture
- **Void requires manager:** `manager.void_payments` permission + reason
- **Tip chargebacks:** On void, `handleTipChargebacks()` reverses tip ledger entries
- **Fire-and-forget:** Print, inventory, tip ledger, socket — never block payment response
- **Reader health:** `PaymentReaderLog` tracks response time and success rate per transaction

---

## Cross-Feature Dependencies

> See `_CROSS-REF-MATRIX.md` for full matrix.

### This feature MODIFIES these features:
| Feature | How / Why |
|---------|-----------|
| Tips | `postToTipLedger(CREDIT, DIRECT_TIP)` called after payment |
| Inventory | `processInventoryDeductions()` triggered at pay (fire-and-forget) |
| Reports | Payment records feed sales and payment reports |
| Orders | Payment closes order, updates totals |
| Cash Drawers | Cash payment opens drawer via ESC/POS |

### These features MODIFY this feature:
| Feature | How / Why |
|---------|-----------|
| Orders | Payment targets an order (orderId FK) |
| Discounts | Discount reduces payment total |
| Tabs | Pre-auth/capture flow drives bar tab payments |
| Settings | Tax, dual pricing, rounding configuration |
| Hardware | Card reader and receipt printer required |
| Roles | Payment permissions gate who can void/refund |

### BEFORE CHANGING THIS FEATURE, VERIFY:
- [ ] **Tips** — does this change affect how tips are credited to the ledger?
- [ ] **Inventory** — does this change affect when deductions fire?
- [ ] **Reports** — does this change affect payment fact records?
- [ ] **CFD** — does this change require updating CFD socket events?
- [ ] **Offline** — does this payment path work offline (SAF)?
- [ ] **Event Sourcing** — does this emit `PAYMENT_APPLIED` / `PAYMENT_VOIDED` events?

---

## Permissions Required

| Action | Permission Key | Level |
|--------|---------------|-------|
| Cash payment | `pos.cash_payments` | Standard |
| Card payment | `pos.card_payments` | Standard |
| Void payment | `manager.void_payments` | Critical |
| Refund | `manager.refunds` | Critical |
| Cash drawer access | `pos.cash_drawer` | Standard |
| No-sale drawer open | `pos.no_sale` | Medium |

---

## Known Constraints & Limits
- **Datacap ONLY** — NEVER add Stripe/Square/Braintree
- **All payment code in `src/lib/datacap/`** — no payment logic elsewhere
- **Local-first:** Reader on LAN (192.168.x.x), NUC DATABASE_URL = localhost
- **60s local timeout** for card interaction, 30s cloud timeout
- **VP3300/VP3350** are the only supported card readers
- **RecordNo token** is the key to all future operations (capture, void, adjust)
- **Payment intent created BEFORE network call** to handle crash recovery
- **Dual Pricing Display Rule (2026-03-03):** Stored prices are CASH prices. Card surcharge is applied POST-TAX: `cardTotal = cashTotal × (1 + cashDiscountPercent/100)`. The surcharge base MUST be the full post-tax cash total — never the pre-tax subtotal. Android `OrderViewModel.recalcSurcharge()` and web `usePricing.ts` must produce identical cash and card totals for the same Order ID. Any change to order panel price display on either platform must verify invariant DP1/DP2 in `docs/planning/AUDIT_REGRESSION.md`. Root cause of past bug: Android used `(subtotal - discount) × pct/100` (pre-tax basis), missing the `subtotal × pct × taxRate` cross-term. Fixed 2026-03-03.

---

## Datacap Transaction Types (17)

| Transaction | Datacap TranCode | Use Case |
|-------------|-----------------|----------|
| Sale | `EMVSale` | Standard card payment |
| Pre-Auth | `EMVPreAuth` | Bar tab hold |
| Capture | `PreAuthCaptureByRecordNo` | Tab close |
| Increment | `IncrementalAuthByRecordNo` | Increase tab hold |
| Adjust | `AdjustByRecordNo` | Tip adjustment |
| Void Sale | `VoidSaleByRecordNo` | Void card payment |
| Return | `EMVReturn` | Refund |
| Collect Card | `CollectCardData` | Read card (no charge) |
| Partial Reversal | `PartialReversalByRecordNo` | Partial void |
| Batch Summary | `BatchSummary` | Settlement report |
| Batch Close | `BatchClose` | End-of-day settlement |
| SAF Forward | `SAF_ForwardAll` | Upload offline transactions |

---

## Android-Specific Notes
- `PayOrderUseCase` orchestrates the full payment flow
- `PaymentManager` handles direct VP3300/VP3350 communication
- Android generates `idempotencyKey` UUID on pay button press
- Offline payments stored locally with `offlineIntentId` for sync
- CFD tip selection is race-free with 60s timeout

---

## Related Docs
- **Domain doc:** `docs/domains/PAYMENTS-DOMAIN.md`
- **Architecture guide:** `docs/guides/PAYMENTS-RULES.md`
- **Dual pricing spec:** `docs/skills/SPEC-31-DUAL-PRICING.md`
- **Cross-ref matrix:** `docs/features/_CROSS-REF-MATRIX.md`
- **Datacap README:** `src/lib/datacap/README-USE-CASES.md`

---

*Last updated: 2026-03-03*
