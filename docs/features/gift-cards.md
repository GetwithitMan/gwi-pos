# Feature: Gift Cards

> **Before editing this feature:** Read `_CROSS-REF-MATRIX.md` → find Gift Cards → read every listed dependency doc.

## Summary

Gift Cards are a software-only, closed-loop stored-value instrument. A location issues a physical or digital gift card by creating a `GiftCard` record with an initial dollar balance. The card carries a unique alphanumeric code (`GC-XXXX-XXXX-XXXX`) and an optional PIN. Servers and cashiers can issue new cards, reload existing ones, and redeem them as a payment tender on any order. Every balance movement — purchase, reload, redemption, refund, and manual adjustment — is recorded as a `GiftCardTransaction` row, forming a complete audit trail from which the current balance can always be reconstructed.

Gift card redemption is tightly integrated with the payment pipeline: the balance decrement and the audit transaction record are written in the same `db.$transaction` as the Prisma balance update, preventing TOCTOU race conditions. Gift card payments do not support tips, do not open the cash drawer, and are **offline-incompatible** — there is no outbox or SAF path.

## Status

`Active`

## Repos Involved

| Repo | Role | Coverage |
|------|------|----------|
| `gwi-pos` | API routes, admin management UI, POS payment UI, reports, Datacap Virtual Gift webhook | Full |
| `gwi-mission-control` | Datacap Virtual Gift storefront config, venue settings | Full |
| `gwi-android-register` | PayOrderUseCase, gift card payment path in PaymentSheet | Full (commit `78fdb35`) |
| `gwi-cfd` | N/A — CFD is not involved in gift card flows (no tip prompt) | None |

---

## UI Entry Points

| Interface | Path / Screen | Who Accesses |
|-----------|--------------|--------------|
| Admin — Issue & Manage | `/gift-cards` → `src/app/(admin)/gift-cards/page.tsx` | Managers (or `customers.gift_cards` permission) |
| Admin — Settings alias | `/settings/gift-cards` → re-exports the same page | Managers |
| Admin — Payment Settings | `/settings/payments` → Accept Gift Cards toggle | Managers |
| Admin — Cash-Flow Report | `/reports/cash-liabilities` → Gift Card Balances section | Managers |
| Admin — Daily Report | `/reports/daily` → Gift Cards section (loads, redemptions, net liability change) | Managers |
| POS Web — Payment Sheet | `PaymentMethodStep` → "Gift Card" button → `GiftCardStep` | Servers / Cashiers |
| Android — Payment Screen | `PayOrderUseCase` — gift card path in PaymentSheet | Servers / Cashiers |

---

## Code Locations

### gwi-pos

| File / Directory | Purpose |
|-----------------|---------|
| `src/app/api/gift-cards/route.ts` | `GET` (list with filters) + `POST` (issue new card) |
| `src/app/api/gift-cards/[id]/route.ts` | `GET` (detail + balance lookup) + `PUT` (freeze / unfreeze / reload / redeem / refund) |
| `src/app/api/orders/[id]/pay/route.ts` | Core redemption path — gift card branch in the payment loop; `db.$transaction` atomicity |
| `src/app/api/reports/cash-liabilities/route.ts` | Aggregates active gift card balances as a liability line |
| `src/app/(admin)/gift-cards/page.tsx` | Admin management page — list, filter, create, reload, freeze/unfreeze, transaction history |
| `src/app/(admin)/settings/gift-cards/page.tsx` | Re-exports `/gift-cards` admin page (accessible from Settings nav) |
| `src/app/(admin)/settings/payments/page.tsx` | `acceptGiftCards` toggle (feature flag) |
| `src/app/(admin)/reports/cash-liabilities/page.tsx` | Renders gift card liability table |
| `src/app/(admin)/reports/daily/page.tsx` | Renders gift card loads / redemptions / net liability in daily report |
| `src/components/payment/steps/GiftCardStep.tsx` | POS web — card number entry, balance check display, partial-payment notice |
| `src/components/payment/steps/PaymentMethodStep.tsx` | POS web — "Gift Card" button in method selector (enabled by `enabledMethods.giftCard`) |
| `src/components/payment/PaymentModal.tsx` | POS web — orchestrates `GiftCardStep`; holds `GiftCardInfo` state |
| `src/components/receipt/Receipt.tsx` | Receipt renderer — shows "Gift Card ending in XXXX" and remaining balance if partial |
| `src/lib/settings.ts` | `PaymentSettings.acceptGiftCards` field; defaults to `false` |
| `src/lib/settings/types.ts` | `giftCardPoolMode`, `giftCardLowPoolThreshold`, `PublicDatacapVirtualGiftSettings` type |
| `src/lib/permission-registry.ts` | `customers.gift_cards` permission key (CRITICAL risk level) |
| `prisma/schema.prisma` | `GiftCard` model, `GiftCardTransaction` model, `GiftCardStatus` enum, `ExternalWebhookEvent` model |
| `src/lib/domain/gift-cards/` | Domain commands: adjust, activate, allocate, freeze, import, process-datacap, schemas |
| `src/app/api/gift-cards/import/route.ts` | `POST` — Bulk import card numbers (CSV/JSON) |
| `src/app/api/gift-cards/generate-range/route.ts` | `POST` — Generate card number range |
| `src/app/api/gift-cards/pool/route.ts` | `GET` — Pool inventory stats |
| `src/app/api/gift-cards/[id]/activate/route.ts` | `POST` — Activate pool card with amount |
| `src/app/api/gift-cards/stats/route.ts` | `GET` — Dashboard stats (liability, counts) |
| `src/app/api/gift-cards/export/route.ts` | `GET` — Streamed CSV export (cards or transactions) |
| `src/app/api/gift-cards/batch/route.ts` | `POST` — Batch operations (activate, freeze, unfreeze, delete) |
| `src/app/api/webhooks/datacap-virtual-gift/route.ts` | `POST` — Datacap Virtual Gift webhook receiver |
| `src/lib/datacap/virtual-gift-client.ts` | Datacap Virtual Gift API client (create/get/update/archive page, get transactions) |
| `src/app/(admin)/gift-cards/components/` | 7 sub-components: Dashboard, List, Detail, Import, PoolStatus, Adjustment, Export |

---

## API Endpoints

| Method | Route | Auth | Description |
|--------|-------|------|-------------|
| `GET` | `/api/gift-cards` | Employee PIN | List gift cards for a location. Supports `?status=` filter and `?search=` (card number, recipient name/email, purchaser name) |
| `POST` | `/api/gift-cards` | Employee PIN (`customers.gift_cards`) | Issue a new gift card. Generates unique `GC-XXXX-XXXX-XXXX` card number, sets `initialBalance = currentBalance`, creates `GiftCardTransaction` of type `purchase`. Returns `201` with the full card. |
| `GET` | `/api/gift-cards/[id]` | Employee PIN | Fetch a single card by DB `id` or by `cardNumber` (falls back). Returns card fields + last 20 `GiftCardTransaction` rows. Lazy-expires the card if `expiresAt` has passed. |
| `PUT` | `/api/gift-cards/[id]` | Employee PIN (`customers.gift_cards`) | Multi-action endpoint driven by `body.action`. See actions below. |
| `POST` | `/api/orders/[id]/pay` | Employee PIN | Core payment route. When `payments[].method === 'gift_card'`: checks `acceptGiftCards` setting, resolves card by `giftCardId` or `giftCardNumber`, runs atomic `db.$transaction` to decrement balance and create `GiftCardTransaction`. |
| `GET` | `/api/reports/cash-liabilities` | Manager | Returns all active gift card balances as a liability block: `{ total, count, activeCount, cards[] }`. |

### PUT /api/gift-cards/[id] — Actions

| `action` | Required fields | Effect |
|----------|----------------|--------|
| `freeze` | `reason` | Sets `status → 'frozen'`, writes `frozenAt` + `frozenReason`. Only on `active` cards. |
| `adjust` | `amount`, `notes` (required) | Manual balance +/- with required reason. Creates `adjustment_credit` or `adjustment_debit` transaction. |

### New Endpoints (Pool Management + Datacap Virtual Gift)

| Method | Route | Auth | Description |
|--------|-------|------|-------------|
| `POST` | `/api/gift-cards/import` | `customers.gift_cards` | Bulk import card numbers (CSV or JSON). Creates `unactivated` cards with shared `batchId`. |
| `POST` | `/api/gift-cards/generate-range` | `customers.gift_cards` | Generate card number range (prefix + start/end). Supports `dryRun` preview. Max 5000/batch. |
| `GET` | `/api/gift-cards/pool` | Read-only | Pool inventory: total, available (unactivated), activated, low-pool alert, per-batch breakdown. |
| `POST` | `/api/gift-cards/[id]/activate` | `customers.gift_cards` | Activate a pool card with a specific amount. Creates `activated` transaction. |
| `GET` | `/api/gift-cards/stats` | Read-only | Dashboard stats: total liability, counts by status, recent transactions. |
| `GET` | `/api/gift-cards/export` | `customers.gift_cards` | Streamed CSV export. `?type=cards` or `?type=transactions`, optional date range. |
| `POST` | `/api/gift-cards/batch` | `customers.gift_cards` | Batch operations (activate/freeze/unfreeze/delete). Per-card validation, partial success. |
| `POST` | `/api/webhooks/datacap-virtual-gift` | Public (HMAC verified) | Datacap Virtual Gift webhook. Creates local GiftCard on `payment.completed`. CVV never stored. |

### Transaction Type Taxonomy

| Type | Direction | Meaning |
|------|-----------|---------|
| `purchased` | + | Online or in-store purchase (new card) |
| `activated` | + | Pool card activated at register |
| `imported` | 0 | Card number imported into pool (balance = 0) |
| `redeemed` | - | Used as payment on an order |
| `reloaded` | + | Additional funds added |
| `adjustment_credit` | + | Manual balance increase (with reason) |
| `adjustment_debit` | - | Manual balance decrease (with reason) |
| `refunded` | + | Payment refund returned to card |
| `frozen` | 0 | Card frozen (status change only) |
| `unfrozen` | 0 | Card unfrozen (status change only) |
| `expired` | 0 | Card expired (status change only) |

### Card Number Pool

Cards can be issued from a pre-imported pool (`giftCardPoolMode: 'pool'`) or generated randomly (`giftCardPoolMode: 'open'`, default).

**Pool mode:** Import physical card numbers via CSV/JSON → creates `unactivated` GiftCard records → when sold at register, `FOR UPDATE SKIP LOCKED` allocates next available → activates with amount.

**Datacap Virtual Gift:** Hosted storefront (configured in Mission Control) sells digital gift cards online. Webhook creates local GiftCard record with `source: 'datacap_virtual'`. Print delivery only (we handle email/SMS ourselves). CVV never stored.

### PCI Scope Note

Gift card CVV from Datacap Virtual Gift webhook is **never stored, logged, or persisted**. Card numbers are stored as required for redemption lookup. The `ExternalWebhookEvent.payload` has CVV stripped before storage. 90-day PII retention policy on webhook payloads.
| `unfreeze` | — | Sets `status → 'active'`, clears `frozenAt` / `frozenReason`. Only on `frozen` cards. |
| `reload` | `amount` (positive) | Increments `currentBalance` by amount. Creates `GiftCardTransaction` of type `reload` (positive amount). Only on `active` cards. |
| `redeem` | `amount`, `employeeId?`, `orderId?`, `notes?` | Decrements `currentBalance`; sets `status → 'depleted'` if balance reaches zero. Creates `GiftCardTransaction` of type `redemption` (negative amount). Fails if balance insufficient. |
| `refund` | `amount`, `employeeId?`, `orderId?`, `notes?` | Increments `currentBalance`. Reactivates card to `active` regardless of prior status (e.g. `depleted`). Creates `GiftCardTransaction` of type `refund` (positive amount). |

---

## Data Model

### GiftCardStatus enum

```prisma
enum GiftCardStatus {
  active     // Balance > 0, can be redeemed
  depleted   // Balance exactly $0; set atomically when decrement reaches zero
  expired    // expiresAt is in the past; set lazily on GET or during redemption
  frozen     // Manually suspended by manager; blocks redemption
}
```

### GiftCard model

```prisma
model GiftCard {
  id         String   @id @default(cuid())
  locationId String
  location   Location @relation(fields: [locationId], references: [id])

  // Card identification
  cardNumber String  @unique   // "GC-XXXX-XXXX-XXXX" format, 19 chars
  pin        String?           // Optional PIN for additional security (not enforced at POS yet)

  // Balance (Decimal — stored as cents-compatible precision)
  initialBalance Decimal       // Balance at time of issue; never changes
  currentBalance Decimal       // Live spendable balance

  // Status lifecycle
  status GiftCardStatus @default(active)

  // Validity
  purchasedAt  DateTime  @default(now())
  expiresAt    DateTime?           // Null = never expires
  frozenAt     DateTime?           // Set when action: 'freeze'
  frozenReason String?             // Human-readable freeze reason

  // Purchaser / recipient metadata (all optional)
  purchasedById  String?           // Employee who issued the card
  purchasedBy    Employee?  @relation("GiftCardSoldBy", ...)
  recipientName  String?
  recipientEmail String?
  recipientPhone String?
  purchaserName  String?
  message        String?           // Gift message printed or displayed

  // Order link (card purchased as part of an order)
  orderId String?
  order   Order?  @relation("GiftCardOrder", ...)

  createdAt DateTime  @default(now())
  updatedAt DateTime  @updatedAt
  deletedAt DateTime?             // Soft delete
  syncedAt  DateTime?             // Cloud sync timestamp

  transactions GiftCardTransaction[]

  @@index([cardNumber])
  @@index([status])
  @@index([locationId, cardNumber])   // Gift card lookup per location
  @@index([locationId, status])       // Active gift card queries
}
```

### GiftCardTransaction model

```prisma
model GiftCardTransaction {
  id         String   @id @default(cuid())
  locationId String
  location   Location @relation(fields: [locationId], references: [id])
  giftCardId String
  giftCard   GiftCard @relation(fields: [giftCardId], references: [id])

  // Transaction type (string — values: purchase, redemption, reload, refund, adjustment)
  type String

  // Amounts (Decimal)
  // SIGN CONVENTION:
  //   purchase, reload, refund, adjustment → POSITIVE (balance increases)
  //   redemption → NEGATIVE (balance decreases)
  amount        Decimal
  balanceBefore Decimal      // Balance before this transaction
  balanceAfter  Decimal      // Balance after this transaction

  // Reference links
  orderId    String?          // Order where card was used or purchased
  order      Order?    @relation("GiftCardTransactionOrder", ...)
  employeeId String?          // Employee who processed the transaction
  employee   Employee? @relation("GiftCardTransactionEmployee", ...)
  notes      String?          // Free-text: 'Initial purchase', 'Reload', 'Payment for order #N'

  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt
  deletedAt DateTime?
  syncedAt  DateTime?
}
```

---

## Business Logic

### Issue a Gift Card (purchase)

1. Manager or authorized server opens `/gift-cards` → "Create Gift Card".
2. Enters amount, optional recipient name/email, optional purchaser name, optional gift message.
3. `POST /api/gift-cards` generates a unique `GC-XXXX-XXXX-XXXX` card number (alphanumeric, 3 groups of 4, collision-retry up to 10 times).
4. Creates `GiftCard` with `initialBalance = currentBalance = amount`, `status: 'active'`.
5. Creates a `GiftCardTransaction` of type `purchase` inline (`balanceBefore: 0`, `balanceAfter: amount`, `notes: 'Initial purchase'`).
6. Card number is displayed / printed — this is the only identifier needed for redemption.

### Balance Check (pre-payment lookup)

1. Server enters card number in `GiftCardStep` or Android `PayOrderUseCase`.
2. Client calls `GET /api/gift-cards/[cardNumber]`.
3. API resolves by card number (falls back from ID lookup to `cardNumber` lookup, uppercased).
4. If `expiresAt` is in the past and `status === 'active'`, API lazily updates `status → 'expired'` and returns the expired card.
5. Client displays current balance and active/inactive status.
6. Balance check is informational only — it is NOT atomic with the subsequent charge. Do not make payment decisions based solely on the balance check result; the atomic check inside `db.$transaction` is the authoritative gate.

### Redemption (payment via `POST /api/orders/[id]/pay`)

1. Client submits `{ payments: [{ method: 'gift_card', amount, giftCardId? | giftCardNumber?, idempotencyKey }] }`.
2. API checks `settings.payments.acceptGiftCards` — returns 400 if false. No DB work is done.
3. API checks `idempotencyKey` — if a `Payment` record with the same key and `status: 'completed'` already exists, returns 200 immediately. No double-decrement.
4. Inside `db.$transaction`:
   a. Resolves `GiftCard` by `giftCardId` or `giftCardNumber` (case-insensitive). Throws `GC_NOT_FOUND` if not found.
   b. Asserts `status === 'active'`. Throws `GC_STATUS:{status}` otherwise.
   c. Checks `expiresAt` — updates `status → 'expired'` and throws `GC_EXPIRED` if past.
   d. Asserts `currentBalance >= paymentAmount`. Throws `GC_INSUFFICIENT:{balance}` if insufficient.
   e. Atomically decrements `currentBalance` by `paymentAmount`; sets `status → 'depleted'` if `newBalance === 0`.
   f. Creates `GiftCardTransaction` of type `redemption`, `amount: -paymentAmount`, with `balanceBefore`, `balanceAfter`, `orderId`, `employeeId`, `notes: 'Payment for order #N'`.
5. After the transaction succeeds: creates `Payment` record with `paymentMethod: 'gift_card'`, `transactionId: 'GC:{cardNumber}'`, `cardLast4: last 4 chars of cardNumber`, `status: 'completed'`.
6. Emits `PAYMENT_APPLIED` order event → triggers `OrderSnapshot` update.
7. Emits `ORDER_CLOSED` event if `paidAmountCents >= totalCents`.
8. Fire-and-forget side effects: `printReceipt()` (shows "Gift Card ending in XXXX", remaining balance if partial), `processInventoryDeductions()`, `allocateTipsForPayment()` (tip is always $0 on gift cards). Cash drawer is NOT opened.

### Partial Redemption / Split Tender

1. Client sends `amount` less than `order.totalCents / 100`.
2. Gift card is decremented by the partial amount only.
3. `OrderSnapshot.paidAmountCents` updated but order remains open (`isClosed: false`).
4. `GiftCardStep` displays: "Partial payment of $X.XX will be applied. Remaining $Y.YY due via another method."
5. Server selects a second payment method (cash, card) to cover the remainder.
6. Order closes when cumulative `paidAmountCents >= totalCents`.
7. Receipt shows both tenders.

### Reload / Top-Up

1. Manager opens card detail in `/gift-cards`, clicks "Reload".
2. Enters reload amount → `PUT /api/gift-cards/[id]` with `{ action: 'reload', amount }`.
3. API adds `amount` to `currentBalance` and creates `GiftCardTransaction` of type `reload` (positive amount).
4. Only `active` cards can be reloaded (frozen or depleted cards require unfreeze first).

### Void / Refund Back to Gift Card

1. When reversing a gift card payment, a manager calls `PUT /api/gift-cards/[id]` with `{ action: 'refund', amount, orderId, notes }`.
2. API increments `currentBalance` by `amount`, forces `status → 'active'` (reactivates depleted cards), and creates `GiftCardTransaction` of type `refund` (positive amount).
3. This is distinct from the standard payment void/refund flow — gift card refunds go directly to the card balance, not to any card processor.

### Freeze / Unfreeze

1. Manager selects card in `/gift-cards` admin page → "Freeze" button.
2. `PUT /api/gift-cards/[id]` with `{ action: 'freeze', reason? }`.
3. Sets `status → 'frozen'`, records `frozenAt` and `frozenReason`.
4. Frozen cards block redemption — the atomic check in `db.$transaction` will throw `GC_STATUS:frozen`.
5. "Unfreeze" reverses: sets `status → 'active'`, clears freeze fields. Balance is unchanged.

### Error Codes

| Code | HTTP | Thrown When | Client Behavior |
|------|------|-------------|----------------|
| `GC_NOT_FOUND` | 404 | Card ID/number not found in DB | "Gift card not found" — re-enter card number |
| `GC_STATUS:{status}` | 400 | Card is `depleted`, `frozen`, or `expired` (at time of atomic check) | "Gift card is {status}" — show reason, suggest different payment |
| `GC_EXPIRED` | 400 | `expiresAt` is in the past (discovered during atomic check) | "Gift card has expired" — suggest different payment |
| `GC_INSUFFICIENT:{balance}` | 400 | `currentBalance < paymentAmount` | "Insufficient gift card balance ($X.XX)" — show remaining balance, offer split tender |

---

## Cross-Feature Dependencies

> See `_CROSS-REF-MATRIX.md` for the full matrix.

### This feature MODIFIES these features:

| Feature | How / Why |
|---------|-----------|
| Payments | Gift card is a payment method inside `POST /api/orders/[id]/pay`; creates a `Payment` record; triggers `PAYMENT_APPLIED` event |
| Orders | Order `paidAmountCents` and `status` updated via `OrderSnapshot` when gift card payment is applied |
| Reports | Gift card liabilities included in Cash-Flow & Liabilities report; loads and redemptions in Daily Report |

### These features MODIFY this feature:

| Feature | How / Why |
|---------|-----------|
| Settings | `settings.payments.acceptGiftCards` is the master on/off switch; changing it immediately blocks or enables gift card redemption |
| Permissions | `customers.gift_cards` controls who can issue, reload, and void cards |

### BEFORE CHANGING THIS FEATURE, VERIFY:

- [ ] **Payments** — does the change affect `db.$transaction` atomicity or `Payment` record creation?
- [ ] **Orders** — does the change affect `PAYMENT_APPLIED` or `ORDER_CLOSED` event emission?
- [ ] **Reports** — does the balance or transaction change affect Cash-Flow liability totals?
- [ ] **Settings** — does the change respect the `acceptGiftCards` feature flag?
- [ ] **Offline sync** — gift cards are explicitly offline-incompatible; no change should add an outbox path without solving balance-replay attacks.

---

## Permissions Required

| Action | Permission Key | Risk Level | Notes |
|--------|---------------|-----------|-------|
| View gift card list | `customers.gift_cards` | CRITICAL | Monetary value |
| Issue (create) gift card | `customers.gift_cards` | CRITICAL | Monetary value |
| Reload gift card | `customers.gift_cards` | CRITICAL | Monetary value |
| Freeze / unfreeze | `customers.gift_cards` | CRITICAL | Monetary value |
| Refund to gift card | `customers.gift_cards` | CRITICAL | Monetary value |
| Redeem at POS (payment) | `pos.cash_payments` | Standard | Gift card treated as soft-currency tender; same permission as cash |
| Void payment (void path) | `manager.void_payments` | High | Only for voiding a gift card payment after the fact |
| Configure `acceptGiftCards` | `settings.customers` | High | Controls customer-facing payment policy |
| View Cash-Flow / Liability report | `reports.sales` | Standard | Includes gift card liability block |

---

## Known Constraints

- **Offline-incompatible.** Gift card redemptions require NUC connectivity. There is no outbox, SAF, or deferred-sync path. If the NUC is unreachable, the POS must inform the customer to pay with cash or a card. Adding an offline path is explicitly prohibited without first solving the balance-replay attack problem (an offline redemption could be replayed multiple times against the same card before syncing).
- **No SAF path.** Store-and-Forward (SAF) is Datacap card-reader only. Gift cards are software-only — no reader required, no SAF.
- **No tip on gift cards.** Gift card payments always carry `tipAmount: 0`. The tip prompt is not shown in the payment flow for gift card tenders.
- **Cash drawer not opened.** `openCashDrawer()` is never called for a gift card payment.
- **Balance sign convention is fixed.** Redemption `amount` stored as a negative Decimal in `GiftCardTransaction`. Reloads, purchases, refunds, and adjustments are positive. Reversing this convention breaks all balance reconstruction and reporting.
- **Card number format.** `GC-XXXX-XXXX-XXXX` where each segment is 4 alphanumeric characters (A-Z, 0-9). Lookup is case-insensitive (uppercased before DB query).
- **No digital delivery.** The API accepts `recipientEmail` but does not currently send an email — the field is stored for future use.
- **PIN field not enforced.** The `GiftCard.pin` field exists in the schema but is not currently checked during redemption at the POS. It is a placeholder for a future PIN-at-POS security flow.
- **Expiry is lazily updated.** `GiftCard.status` is updated to `expired` when the card is looked up (`GET /api/gift-cards/[id]`) or during the payment `db.$transaction`. It is not updated by a background job.
- **`acceptGiftCards` defaults to `false`.** New locations must explicitly enable gift card acceptance in Settings → Payments.
- **Atomicity window.** The `db.$transaction` covers `GiftCard` balance decrement + `GiftCardTransaction` creation. The `Payment` record is created outside this transaction. If the `Payment` creation fails after the transaction commits, the `GiftCardTransaction` record serves as the audit proof; a retry or manual `Payment` record creation is needed to reconcile.

---

## Android-Specific Notes

- **Commit:** `78fdb35` — gift card payment path added to `gwi-android-register`.
- `PayOrderUseCase` handles gift card as a `PaymentMethod.GIFT_CARD` branch. The card number is entered or barcode-scanned in the Android `PaymentSheet`. The use case calls `POST /api/orders/[id]/pay` with `{ method: 'gift_card', giftCardNumber }` — identical to the web POS flow.
- Pre-payment balance check: Android calls `GET /api/gift-cards/[cardNumber]` to show the current balance before the server presses "Pay". This call is advisory; the authoritative check is inside the pay route's `db.$transaction`.
- CFD is not involved in any part of the gift card flow — no tip prompt, no CFD screen transition.
- Gift card redemption blocks if `isUnavailablePhase` (server heartbeat has lapsed > 10 s) — gift cards require connectivity and the connectivity overlay correctly prevents the payment attempt.

---

## Related Docs

- **Flow doc (redemption path):** `docs/flows/gift-card-payment.md` — full step-by-step sequence, events emitted, state changes, all edge cases, and invariants
- **Payment rules:** `docs/guides/PAYMENTS-RULES.md` — money-first rule, fire-and-forget side effects, no double-charge
- **Order lifecycle:** `docs/guides/ORDER-LIFECYCLE.md` — `PAYMENT_APPLIED` + `ORDER_CLOSED` event sourcing model
- **Offline sync:** `docs/features/offline-sync.md` — confirms gift card is explicitly offline-incompatible; SAF is card-reader only
- **Payments feature:** `docs/features/payments.md` — full payment data model, idempotency, multi-tender / split patterns
- **Roles & permissions:** `docs/features/roles-permissions.md` — `customers.gift_cards` key definition and risk level

---

*Last updated: 2026-03-03*
