# Feature: Loyalty Rewards

> **Before editing this feature:** Read `_CROSS-REF-MATRIX.md` -> find Loyalty -> read every listed dependency doc.
>
> **Spec status (2026-04-23):** This document describes the **target end-state** after the Loyalty Rewards Cleanup workstream (T1-T11) ships. Sections marked with **[POST-CLEANUP]** describe behavior that must be enforced once the cleanup lands. See `~/.claude/projects/-Users-brianlewis/memory/loyalty-cleanup.md` for the migration plan.

## Summary

Loyalty Rewards is the points-earning, tier-progression, and points-redemption system attached to `Customer` records. A linked customer earns points whenever an order they own is paid in full; points accrue against a configurable `LoyaltyProgram` and may promote the customer through `LoyaltyTier` rungs based on `lifetimePoints`. Earning is **persisted exactly once per order lifecycle** through a single canonical engine that writes a `LoyaltyTransaction(type='earn')` row, increments `Customer.loyaltyPoints` + `Customer.lifetimePoints`, and re-evaluates the tier — all driven from a durable post-commit outbox so process death between payment commit and loyalty write cannot lose the earn. Refunds and voids reverse the earn through the same canonical engine. Online checkout uses the same engine — there is no flat fallback. Points redemption is **discount-only** today (a `RewardRedemptionBenefit` in the checkout engine reduces the payable amount); the legacy "loyalty as tender" payment method (`src/lib/domain/payment/payment-methods/loyalty.ts`) is RESERVED and may not be added to new code paths.

## Status

`Active` — engine present today, **hardening in progress** (Loyalty Rewards Cleanup, started 2026-04-23). Earn invariants below describe the target post-cleanup behavior.

## Repos Involved

| Repo | Role | Coverage |
|------|------|----------|
| `gwi-pos` | Canonical engine, schema, outbox, REST API, admin UI, online checkout, web portal | Full |
| `gwi-android-register` | Customer link UI, tender gate (must block tender until link confirmed), receipt point display | Full **[POST-T1]** |
| `gwi-pax-a6650` | Shares unified register codepath with Android post-`mobile-register-unification` v1.3.2 — same link/tender behavior | Full **[POST-T1]** |
| `gwi-cfd` | Reads loyalty snapshot for balance display + enrollment prompt | Partial |
| `gwi-mission-control` | None | None |
| `gwi-backoffice` | Cloud sync of `LoyaltyTransaction`/`LoyaltyProgram`/`LoyaltyTier`/`Customer` | Partial |

---

## UI Entry Points

| Interface | Path / Screen | Who Accesses |
|-----------|--------------|--------------|
| Admin | `/loyalty` | Managers (`CUSTOMERS_VIEW`) |
| Admin | `/loyalty/program` | Managers (`SETTINGS_CUSTOMERS`) |
| Admin | `/loyalty/tiers` | Managers (`SETTINGS_CUSTOMERS`) |
| Admin | `/loyalty/customers` | Managers (`CUSTOMERS_VIEW`) |
| Admin | `/loyalty/transactions` | Managers (`CUSTOMERS_VIEW`) |
| Admin | `/settings/loyalty` | Managers (`SETTINGS_CUSTOMERS`) |
| Admin | `/settings/venue-portal/rewards` | Managers (`SETTINGS_CUSTOMERS`) |
| POS Web | `CustomerLookupModal` (order panel) — link customer | Servers, Bartenders |
| Android Register | Customer attach button on order screen | All FOH staff |
| Mobile Register | `MobileTabActions` "Link Customer" sheet **[POST-T6]** | Owners, Managers |
| CFD | Loyalty balance + enrollment prompt during payment | Customers |
| Customer Portal | `/account/rewards`, `/(site)/account` | Authenticated guests |

---

## Code Locations

### gwi-pos (canonical engine + APIs)

| File / Directory | Purpose |
|-----------------|---------|
| `src/lib/domain/payment/commit/commit-payment-transaction.ts` | **Pre-computes** `pointsEarned`, `loyaltyEarningBase`, `loyaltyTierMultiplier` inside the payment commit transaction (lines ~207-235). Re-reads `customerId` from row-locked Order **[POST-T3]** |
| `src/lib/domain/payment/effects/run-payment-post-commit-effects.ts` | `updateCustomerAndLoyalty()` (lines ~402-475) — increments `Customer.loyaltyPoints`/`lifetimePoints`, inserts `LoyaltyTransaction(type='earn')`, evaluates tier promotion. Driven by durable outbox **[POST-T4]** |
| `src/lib/domain/payment/payment-methods/loyalty.ts` | **RESERVED / DEPRECATED** — points-as-tender path. No new callers permitted |
| `src/app/api/orders/[id]/pay/route.ts` | POS pay handler — emits earn through the canonical engine |
| `src/app/api/orders/[id]/close-tab/route.ts` | Tab close handler — emits earn through the canonical engine. Phase-1 early-exit at lines 46-54 protects the pay->close direction |
| `src/app/api/orders/[id]/pay-all-splits/route.ts` | Split payment handler — earn rule defined per T10 (single earn per parent order lifecycle) |
| `src/app/api/orders/[id]/void-payment/route.ts` | Reverses an earn via the canonical engine when a payment is voided |
| `src/app/api/orders/[id]/refund-payment/route.ts` | Reverses an earn via the canonical engine when a payment is refunded |
| `src/app/api/orders/[id]/customer/route.ts` | `GET`/`PUT` link/unlink customer to order. Returns loyalty settings for the linked customer |
| `src/app/api/online/checkout/route.ts` | Online checkout — calls the canonical engine **[POST-T5]**; no flat fallback |
| `src/lib/customer-upsert.ts` | `upsertOnlineCustomer()` only — `accrueOnlineLoyaltyPoints()` MUST be removed/replaced by the canonical engine call **[POST-T5]** |
| `src/app/api/loyalty/earn/route.ts` | **DEPRECATED (Q3, 2026-04-23)** — returns `410 Gone` with `{ error, migration: '/api/loyalty/adjust' }`. Kept as a stub for backward compat. Manual corrections go through `/api/loyalty/adjust` (`type='admin_adjustment'`); order-driven earn always went through the inline commit + outbox path and was never affected by this route |
| `src/app/api/loyalty/adjust/route.ts` | Manual loyalty adjustment (positive or negative). Writes `LoyaltyTransaction(type='admin_adjustment')`. The ONLY supported manual-credit path. Requires `LOYALTY_ADJUST` permission and a non-empty `reason` |
| `src/app/api/loyalty/balance/route.ts` | GET current points + tier for a customer |
| `src/app/api/loyalty/transactions/route.ts` | GET ledger of `LoyaltyTransaction` rows |
| `src/app/api/loyalty/programs/route.ts`, `[id]/route.ts` | CRUD for `LoyaltyProgram` |
| `src/app/api/loyalty/tiers/route.ts`, `[id]/route.ts` | CRUD for `LoyaltyTier` |
| `src/app/api/loyalty/tier-check/route.ts` | Re-evaluates tier from `lifetimePoints` |
| `src/app/api/loyalty/enroll/route.ts` | Enroll a customer in a program |
| `src/app/api/loyalty/rewards/route.ts`, `[id]/route.ts` | Catalog of redeemable rewards |
| `src/app/api/loyalty/redemptions/route.ts`, `redemptions/apply/route.ts`, `redeem/route.ts` | Redemption flow (creates a `RewardRedemptionBenefit` in the checkout engine) |
| `src/app/api/cfd/loyalty/enroll/route.ts` | CFD-driven self-enroll |
| `src/lib/cfd-loyalty-snapshot.ts` | Builds the loyalty snapshot the CFD reads |
| `src/app/api/public/portal/[slug]/rewards/*` | Customer-facing portal balance/redeem |

### gwi-android-register

| File | Purpose |
|------|---------|
| `viewmodel/OrderViewModel.kt` (~1784, 1841, 3907) | `linkCustomer()` MUST `await wireCustomerToEngine()` before tender enables. `isLinkingCustomer` state guards the tender button **[POST-T1]** |
| `customer/CustomerManager.kt` | Owns the customer-link RPC + linking-state flow |
| `screen/OrderScreen.kt` | Renders linked-customer chip + tier badge |
| `usecase/PayOrderUseCase.kt` | Pay request body has NO `customerId` — server reads customer from the locked Order row **[POST-T3]** |

---

## API Endpoints

| Method | Route | Auth | Description |
|--------|-------|------|-------------|
| `GET` | `/api/orders/[id]/customer` | Employee PIN | Returns linked customer + loyalty settings |
| `PUT` | `/api/orders/[id]/customer` | Employee PIN | Link/unlink customer to order. Tender MUST NOT proceed until this returns 200 **[POST-T1]** |
| `POST` | `/api/orders/[id]/pay` | Employee PIN | Payment commit — fires canonical earn through outbox |
| `POST` | `/api/orders/[id]/close-tab` | Employee PIN | Tab close — fires canonical earn through outbox |
| `POST` | `/api/orders/[id]/pay-all-splits` | Employee PIN | Split close — earn rule per T10 |
| `POST` | `/api/orders/[id]/void-payment` | `manager.void_payments` | Reverses earn (one reversal per earn) |
| `POST` | `/api/orders/[id]/refund-payment` | `manager.void_payments` | Reverses earn (one reversal per earn) |
| `POST` | `/api/online/checkout` | Public | Online checkout — fires canonical earn (no flat fallback) **[POST-T5]** |
| `POST` | `/api/loyalty/earn` | n/a | **DEPRECATED (Q3, 2026-04-23)** — always returns `410 Gone` with `{ error: 'Deprecated. Use POST /api/loyalty/adjust instead.', migration: '/api/loyalty/adjust' }`. Use `POST /api/loyalty/adjust` for manual corrections |
| `POST` | `/api/loyalty/adjust` | `LOYALTY_ADJUST` | Manual loyalty adjustment (positive or negative integer). Writes `LoyaltyTransaction(type='admin_adjustment')`. Body: `{ customerId, points, reason }` |
| `POST` | `/api/loyalty/redeem` | `POS_ACCESS` | Redeem points for a reward (creates `RewardRedemptionBenefit`) |
| `POST` | `/api/loyalty/redemptions/apply` | `POS_ACCESS` | Apply a redemption to an open order |
| `POST` | `/api/loyalty/enroll` | `POS_ACCESS` | Enroll customer in a program |
| `GET` | `/api/loyalty/balance` | Employee PIN | Current points + tier |
| `GET` | `/api/loyalty/transactions` | `CUSTOMERS_VIEW` | Earn/redeem ledger |
| `GET`/`POST`/`PUT`/`DELETE` | `/api/loyalty/programs[/id]` | `SETTINGS_CUSTOMERS` | Program CRUD |
| `GET`/`POST`/`PUT`/`DELETE` | `/api/loyalty/tiers[/id]` | `SETTINGS_CUSTOMERS` | Tier CRUD |
| `GET`/`POST`/`PUT`/`DELETE` | `/api/loyalty/rewards[/id]` | `SETTINGS_CUSTOMERS` | Reward catalog CRUD |
| `POST` | `/api/loyalty/tier-check` | `CUSTOMERS_VIEW` | Re-evaluate tier from `lifetimePoints` |
| `POST` | `/api/cfd/loyalty/enroll` | CFD pairing token | CFD-driven self-enroll |
| `GET` | `/api/public/portal/[slug]/rewards/balance` | Portal session | Customer-facing balance |
| `POST` | `/api/public/portal/[slug]/rewards/redeem` | Portal session | Customer-facing redeem |

---

## Socket Events

Loyalty earn/redeem do not emit dedicated socket events. Two existing channels carry the relevant updates:

| Event | Source | Carries Loyalty Info |
|-------|--------|---------------------|
| `order:summary-updated` | Payment commit + close-tab | `loyaltyPointsEarned` field on the order summary |
| `cfd:show-order` | CFD dispatcher | Loyalty snapshot (balance, tier, multiplier) for display |

> **Note:** A future `loyalty:txn-created` event is **not** in scope for the cleanup. If added later, document in `_CROSS-REF-MATRIX.md` and `docs/guides/SOCKET-REALTIME.md`.

---

## Data Model

### LoyaltyProgram

```
LoyaltyProgram {
  id                  String          // cuid
  locationId          String
  name                String          // default: "Loyalty Program"
  isActive            Boolean         // default: true
  pointsPerDollar     Int             // default: 1
  pointValueCents     Int             // default: 1 (1 point = $0.01 redemption value)
  minimumRedeemPoints Int             // default: 100
  roundingMode        String          // 'floor' | 'round' | 'ceil' (default: 'floor')
  excludedCategoryIds String[]        // categories that do NOT earn points
  excludedItemTypes   String[]        // e.g., ['entertainment']
  lastMutatedBy       String?         // 'cloud' | 'local' | null
  createdAt           DateTime
  updatedAt           DateTime
  deletedAt           DateTime?
  syncedAt            DateTime?
  tiers               LoyaltyTier[]
  customers           Customer[]
}
```

### LoyaltyTier

```
LoyaltyTier {
  id               String           // cuid
  locationId       String
  programId        String
  name             String           // e.g., "Silver", "Gold", "Platinum"
  minimumPoints    Int              // lifetime points required to enter this tier
  pointsMultiplier Decimal(6,2)     // e.g., 1.5 = 1.5x points (default: 1.0)
  perks            Json             // { freeItems: [], discountPercent: 0, birthdayReward: false }
  color            String           // UI badge color (default: "#6366f1")
  sortOrder        Int
  lastMutatedBy    String?
  createdAt        DateTime
  updatedAt        DateTime
  deletedAt        DateTime?
  syncedAt         DateTime?
  customers        Customer[]
}
```

### LoyaltyTransaction (the canonical ledger)

```
LoyaltyTransaction {
  id            String          // cuid (server-generated; idempotency keyed on (orderId, type='earn'))
  customerId    String
  locationId    String
  orderId       String?         // null for manual adjustments / welcome bonus
  type          String          // canonical writers: 'earn' | 'redeem' | 'reversal' | 'admin_adjustment' | 'tier_change' | 'welcome' | 'expire' | 'tier_bonus'
                                // legacy / deprecated (read-only): 'adjust' (Q4, 2026-04-23 — no current writers)
  points        Int             // positive for earn/welcome/tier_bonus, negative for redeem/reversal/expire
  balanceBefore Int
  balanceAfter  Int
  description   String
  employeeId    String?
  metadata      Json?           // { orderAmount, pointsPerDollar, tierMultiplier, tierName, ... }
  createdAt     DateTime
  updatedAt     DateTime
  syncedAt      DateTime?
}
```

**Canonical type taxonomy (Q4, 2026-04-23):** the supported writer types are
`earn` | `redeem` | `reversal` | `admin_adjustment` | `tier_change` | `welcome` | `expire` | `tier_bonus`.
The legacy `'adjust'` type has **no current writers** — T7 replaced inline reversal code with `'reversal'` and T8b's `/api/loyalty/adjust` writes `'admin_adjustment'`. Historical `'adjust'` rows in seed/migration data are left in place as read-only legacy. `reverse-earn.ts` continues to query `type IN ('reversal', 'adjust')` so it does not re-reverse on top of legacy adjust rows. A static-analysis regression test (`src/lib/domain/loyalty/__tests__/loyalty-transaction-type-invariants.test.ts`) enforces that no source file under `src/` writes `type: 'adjust'`.

**[POST-T2] DB-level uniqueness:** a partial unique index `LoyaltyTransaction_orderId_earn_unique` on `(orderId) WHERE type = 'earn' AND deletedAt IS NULL` enforces single-earn-per-order. Reversal rows (`type IN ('reversal','expire')` with negative `points` and `metadata.reversesTransactionId` set) are NOT covered by the index — multiple non-earn rows per order are allowed.

### Customer fields used by loyalty

```
Customer {
  // ...other fields documented in customers.md
  loyaltyProgramId String?
  loyaltyTierId    String?
  loyaltyPoints    Int        // current redeemable balance (NEVER write outside the canonical engine)
  lifetimePoints   Int        // monotonic — drives tier promotion (NEVER write outside the canonical engine)
}
```

---

## Business Logic

### Earn Formula (canonical)

```
earningBase = settings.loyalty.earnOnSubtotal
              ? Order.subtotal
              : Order.total
              + (settings.loyalty.earnOnTips ? tipTotal : 0)
              - (sum of excluded category/itemType subtotals)

if earningBase < settings.loyalty.minimumEarnAmount:
  pointsEarned = 0
else:
  pointsEarned = round(earningBase * program.pointsPerDollar * tierMultiplier)
```

- `program.pointsPerDollar` is read from `LoyaltyProgram` (per-customer-program), with `settings.loyalty.pointsPerDollar` as the location-level default when no program is attached.
- `tierMultiplier` = `LoyaltyTier.pointsMultiplier` for the customer's current tier (default `1.0`).
- `roundingMode` = `program.roundingMode` ∈ {`floor`,`round`,`ceil`}. **Default `floor`** when the customer has no enrolled `LoyaltyProgram`, when the program omits the field, or when the stored value is unrecognized — see `src/lib/domain/loyalty/compute-earn.ts` (`DEFAULT_LOYALTY_ROUNDING_MODE`, `resolveRoundingMode`, `lookupCustomerRoundingMode`). The canonical engine, `commit-payment-transaction.ts`, `close-tab/route.ts`, `pay-all-splits/route.ts`, and `record-online-earn.ts` all read the mode from the customer's program — every earn-capable surface uses the same rule. **Migration note (Q1, 2026-04-23):** the engine previously hard-coded `Math.round`. Existing venues are unaffected because the `LoyaltyProgram.roundingMode` column already defaults to `'floor'` at the schema level (`prisma/schema.prisma`) and `/api/loyalty/earn` already used `'floor'` as its default — no venue silently changes mode.
- `excludedCategoryIds` and `excludedItemTypes` on `LoyaltyProgram` exclude their items' subtotals from `earningBase`.

### Earning Base Selection

| Setting | `earnOnSubtotal` | `earnOnTips` | `earningBase` |
|---------|------------------|--------------|---------------|
| Default | `true` | `false` | `Order.subtotal` (pre-tax, pre-discount NOT — see implementation in `commit-payment-transaction.ts`) |
| Post-tax | `false` | `false` | `Order.total` |
| Tips-included | `true` or `false` | `true` | base + `tipTotal` |

### Tier Thresholds

Tiers are **fully data-driven** from the `LoyaltyTier` table — there are no hardcoded thresholds in code. A common starter configuration (matches the legacy "VIP Tier" doc in `customers.md`, which was tied to `Customer.totalSpent` in dollars and is **separate from** the loyalty point thresholds documented here):

| Tier | `minimumPoints` (lifetime) | `pointsMultiplier` |
|------|----------------------------|--------------------|
| Bronze (default) | 0 | 1.0 |
| Silver | 500 | 1.0 |
| Gold | 2000 | 1.25 |
| Platinum | 5000 | 1.5 |

> **Important:** `customers.md` documents a "VIP Tier System" keyed off `totalSpent` in **dollars** (Silver $500, Gold $2000, Platinum $5000). That is a **separate** display/perk system on `Customer` and does NOT drive loyalty earn. Loyalty tiers are point-based via `LoyaltyTier.minimumPoints`. See Spec Questions below.

### Single Canonical Award Rule **[POST-T2]**

> **The invariant: exactly one persisted `LoyaltyTransaction(type='earn')` per order lifecycle, regardless of which terminal route fires first.**

Earn-capable terminal routes:
- `POST /api/orders/[id]/pay`
- `POST /api/orders/[id]/close-tab`
- `POST /api/orders/[id]/pay-all-splits` (per T10 rule)
- `POST /api/online/checkout`

> **Note:** `POST /api/loyalty/earn` was deprecated 2026-04-23 (Q3) and now returns `410 Gone`. Manual corrections go through `POST /api/loyalty/adjust`, which writes a `LoyaltyTransaction(type='admin_adjustment')` row — distinct from organic earns in reports.

Reversal-capable routes (do not award; they reverse):
- `POST /api/orders/[id]/void-payment`
- `POST /api/orders/[id]/refund-payment`
- `POST /api/orders/[id]/comp-void`
- `POST /api/orders/[id]/void-tab`

All earn-capable routes funnel through the canonical engine in `commit-payment-transaction.ts` + the post-commit outbox in `run-payment-post-commit-effects.ts`. The DB partial unique index (see Data Model) makes retries safe.

### Split-Payment Earn Rule **[POST-T10]**

> **Decision (Q5):** Parent-order-only earn. Tips count when `earnOnTips=true`.

When `pay-all-splits` closes a parent order's split children in one atomic call, exactly one `LoyaltyTransaction(type='earn')` row is persisted **per parent order lifecycle**:

1. **Customer:** the earn is attributed to the **parent order's** `customerId`, re-read inside the FOR UPDATE-locked parent row at commit time (T3). Per-split `customerId` values (today always `null`; reserved for future use) are **ignored** — splitting an order does not allow rerouting points to a different customer.
2. **Earning base:** the canonical engine receives the **sum of split children's subtotals** (`subtotal` field) and the **sum of split children's totals** (`combinedTotal` after dual-pricing). This equals the same number a single non-split order with the same totals would earn.
3. **Tips:** the engine receives the **sum of every split child's `tipTotal`** plus any **auto-gratuity newly applied this call** (`autoGratPerSplit`). The engine adds tips to the earning base only when `loyaltySettings.earnOnTips === true` (single conditional, single source of truth).
4. **Idempotency:** the earn is enqueued into `PendingLoyaltyEarn` keyed on `parentOrderId`. The unique constraint + the partial unique index on `LoyaltyTransaction (orderId) WHERE type='earn'` together guarantee at most one persisted earn even if `pay-all-splits` is invoked twice or if a sibling route (`pay`, `close-tab`) later runs on a child split.
5. **No customer linked:** no earn, no enqueue.
6. **Loyalty disabled:** no earn, no enqueue.

**Why parent-only?** Splitting an order should not change the earning model. Awarding per-split would let a venue inflate points by splitting a $1 ticket into ten 10¢ children. Parent-only is least gameable and matches operator intuition: the "order" earned the points, not the ticket presentation.

**Tests:** `src/lib/domain/loyalty/__tests__/split-payment-earn.test.ts` pins the contract.

### Customer-Link Re-read at Commit Boundary **[POST-T3]**

Inside the payment transaction:

1. `SELECT id, customerId, ... FROM "Order" WHERE id = ${orderId} FOR UPDATE` (mirrors `add-ha-payment` lock discipline).
2. Re-read `customerId` from the locked row — never trust the in-memory `order.customer` snapshot from before the transaction.
3. If `customerId` is `NULL` at this point: **no points awarded**, no `LoyaltyTransaction` row created.
4. If `customerId` is set: pre-compute `pointsEarned` and enqueue the canonical earn for the post-commit outbox.

### Durable Post-Commit Earn Write **[POST-T4]**

The post-commit loyalty write is wrapped by the durable outbox (the same pattern as `add-ha-payment`):

1. Inside the payment commit transaction, write an outbox record `OutboxEvent(type='loyalty.earn', orderId, customerId, pointsEarned, metadata)`.
2. After commit, the worker drains the outbox; on failure it retries with backoff. The `(orderId) WHERE type='earn'` partial unique index makes the retry idempotent.
3. Process death between commit and worker drain does **not** lose the earn — the outbox row survives.
4. The fire-and-forget `void ... .catch(...)` shape at `run-payment-post-commit-effects.ts:415` is REPLACED by the outbox enqueue.

### Reversal Rules

> **Cross-reference:** see `docs/features/refund-void.md` for the full void-vs-refund decision tree and Datacap interaction. The reversal rules below describe ONLY the loyalty side.

- A `void-payment` or `refund-payment` against a paid order with a linked customer reverses the earn.
- The reversal writes a `LoyaltyTransaction` row with `type='reversal'` (T7, 2026-04-23 — replaced legacy `'adjust'`), negative `points`, and `metadata.reversesTransactionId` pointing to the original earn.
- Reversal is **idempotent**: applying the same void/refund twice produces zero additional ledger rows. Enforced by checking for an existing reversal whose `metadata.reversesTransactionId` matches the original earn id.
- `Customer.loyaltyPoints` is decremented by the reversed amount; `Customer.lifetimePoints` is also decremented.
- If `lifetimePoints` falls below the customer's current `LoyaltyTier.minimumPoints`, the customer is **demoted** to the highest tier whose `minimumPoints <= newLifetime` (writes a `tier_bonus` row with `points=0` and a "Demoted to {tier}" description). Demotion is deterministic and runs in the same transaction as the reversal.
- `comp-void` and `void-tab` do not directly award/reverse loyalty; they change order state. The downstream payment void/refund (if any) carries the reversal.

### Online Checkout **[POST-T5]**

`POST /api/online/checkout` MUST call the canonical engine after a successful Datacap PayAPI capture. The legacy `accrueOnlineLoyaltyPoints()` in `src/lib/customer-upsert.ts` (which used `Math.floor(orderTotal)` and ignored `pointsPerDollar`, tier multiplier, and program settings) is REMOVED.

### Redemption (discount-only)

- Customer redeems points via `/api/loyalty/redeem` or `/api/loyalty/redemptions/apply`.
- Engine creates a `RewardRedemptionBenefit` in the checkout engine that reduces the payable amount.
- `Customer.loyaltyPoints` is decremented atomically (FOR UPDATE on the Customer row inside a transaction — same pattern as `/api/loyalty/adjust`).
- A `LoyaltyTransaction(type='redeem', points=-N)` row is created in the same transaction.
- Payment then proceeds with cash/card/gift_card/house_account for the residual amount. **Loyalty is NOT a tender.**

### Welcome Bonus

If `settings.loyalty.welcomeBonus > 0` and a new `Customer` is created, a one-time `LoyaltyTransaction(type='welcome', points=+N)` row is written and `Customer.loyaltyPoints` / `lifetimePoints` are incremented by N.

---

## Known Constraints

- **Customer must be linked BEFORE payment commits.** The Android tender gate (`OrderViewModel.linkCustomer()` + `isLinkingCustomer`) MUST `await wireCustomerToEngine()` before enabling tender. This applies to both initial link AND relink on existing orders. **[POST-T1]**
- **Online checkout uses the same canonical engine** — there is no flat fallback path. `customer-upsert.ts:123` divergent formula (`Math.floor(orderTotal)`) is removed. **[POST-T5]**
- **Mobile Register supports linking.** `MobileTabActions` exposes a customer search modal that emits `MOBILE_EVENTS.LINK_CUSTOMER_REQUEST` via socket relay -> `PUT /api/orders/{id}/customer`. **[POST-T6]** (If product de-scopes T6, surface MUST display explicit "no rewards on this surface" copy.)
- **PAX A6650 inherits Android behavior** via the unified register codepath (`mobile-register-unification` v1.3.2). One T1 fix covers both surfaces.
- **Direct writes to `Customer.loyaltyPoints` and `Customer.lifetimePoints` are FORBIDDEN outside the canonical engine + outbox path.** This includes admin "manual adjust" — it MUST go through `POST /api/loyalty/adjust`, which writes a `LoyaltyTransaction(type='admin_adjustment')` row (T8b). `POST /api/loyalty/earn` is **deprecated (Q3, 2026-04-23)** and returns `410 Gone`. The 530-point unbacked balance discovered in the audit (T8) is the failure mode this rule prevents.
- `LoyaltyTransaction.type='earn'` rows have a partial unique index on `orderId` — duplicates return P2002, not 500.
- The legacy points-as-tender path (`payment-methods/loyalty.ts`) is RESERVED — no new callers.
- Earning excludes categories listed in `LoyaltyProgram.excludedCategoryIds` and item types in `excludedItemTypes` (e.g., `entertainment`).
- A linked customer with `customer.loyaltyProgramId == null` does NOT earn points (program enrollment required).
- Tier promotion only fires on `earn`. Tier demotion fires on reversal. A `tier_check` API is exposed for manual re-evaluation.
- `LoyaltyTier.pointsMultiplier` applies to earn ONLY — it does not affect redemption or display values.

---

## Cross-Feature Dependencies

> See `_CROSS-REF-MATRIX.md` (Loyalty row) for the full matrix.

### This feature MODIFIES these features:

| Feature | How / Why |
|---------|-----------|
| Customers | Updates `loyaltyPoints`, `lifetimePoints`, `loyaltyTierId`, `totalSpent`, `totalOrders`, `lastVisit`, `averageTicket` on payment commit |
| Reports | `LoyaltyTransaction` ledger feeds loyalty reports + customer detail history |
| Online Ordering | Online checkout invokes the canonical engine on successful capture |
| CFD | CFD reads loyalty snapshot for balance/tier display |

### These features MODIFY this feature:

| Feature | How / Why |
|---------|-----------|
| Orders | `customerId` on the Order is the input to "should we earn?" |
| Payments | Payment commit is the trigger for earn; void/refund are the reversal triggers |
| Refund/Void | Drives reversal of `LoyaltyTransaction(type='earn')` (see `refund-void.md`) |
| Settings | `LoyaltySettings` (enabled, pointsPerDollar, earnOnSubtotal, earnOnTips, minimumEarnAmount, welcomeBonus, redemption config) gates and parameterizes the engine |
| Roles | `CUSTOMERS_VIEW`, `SETTINGS_CUSTOMERS`, and the legacy `LOYALTY_POINTS` permission gate access |

### BEFORE CHANGING THIS FEATURE, VERIFY:

- [ ] **Orders** — `customerId` is read from the FOR UPDATE-locked Order row inside the payment transaction (T3)
- [ ] **Payments** — pay, close-tab, pay-all-splits, and online/checkout all funnel through the canonical engine
- [ ] **Refund/Void** — every reversal is idempotent; one `LoyaltyTransaction(type='reversal')` per earn
- [ ] **Customers** — direct writes to `Customer.loyaltyPoints`/`lifetimePoints` outside the engine are absent
- [ ] **Settings** — schema additions/removals to `LoyaltySettings` are reflected in `mergeWithDefaults()` and the admin UI
- [ ] **Online Ordering** — `customer-upsert.ts:accrueOnlineLoyaltyPoints` does not exist OR is a thin wrapper that calls the canonical engine
- [ ] **Mobile Register** — link UI dispatches `LINK_CUSTOMER_REQUEST` and the socket handler is wired (T6)
- [ ] **CFD** — loyalty snapshot reflects post-earn balance and tier within the CFD's read window

---

## Permissions Required

| Action | Permission Key | Level |
|--------|---------------|-------|
| View loyalty balance + ledger | `customers.view` | Standard |
| Earn (in-line via payment) | Inherits the payment route's permission | Standard |
| Manual earn / adjust | `customers.loyalty_points` (legacy `LOYALTY_POINTS`) | High |
| Redeem points | `pos.access` (server-side) | Standard |
| Configure program / tiers / rewards | `settings.customers` | Critical |
| Reverse earn (void/refund) | `manager.void_payments` | High |

---

## Observability **[POST-T9]**

A metric `orders_paid_with_customer_without_loyalty_txn_within_30s` MUST be exported and alarmed on non-zero. Without this, any future regression of the cleanup invariants would be silent (which is exactly how the 154-orders-zero-earns gap reached production).

---

## Related Docs

- **Cross-ref:** `docs/features/_CROSS-REF-MATRIX.md` -> Loyalty row
- **Customers (PII):** `docs/features/customers.md`
- **Refund/Void reversal:** `docs/features/refund-void.md`
- **Online ordering checkout:** `docs/features/online-ordering.md`
- **CFD snapshot:** `docs/features/cfd.md`
- **Mobile Register link UI:** `docs/features/mobile-tab-management.md`
- **Cleanup plan:** `~/.claude/projects/-Users-brianlewis/memory/loyalty-cleanup.md`
- **Regression invariants:** `docs/planning/AUDIT_REGRESSION.md` -> Loyalty section (INV-LOYALTY-1..6)
- **Skills:** Skill 52 (Loyalty), Skill 228 (Card Token Loyalty)

---

*Last updated: 2026-04-23 (initial spec — target end-state for Loyalty Rewards Cleanup workstream)*
