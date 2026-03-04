# Feature: Discounts

> **Before editing this feature:** Read `_CROSS-REF-MATRIX.md` → find Discounts → read every listed dependency doc.

## Summary
Discounts covers order-level discounts, item-level discounts, preset discount rules, coupon codes, and comp/void operations. Discounts can be percentage-based or fixed amounts, applied manually or automatically. Manager approval is required above configurable thresholds. The discount system is event-sourced — every apply/remove emits `DISCOUNT_APPLIED` / `DISCOUNT_REMOVED` events. Comp/void is treated as a related operation with its own `COMP_VOID_APPLIED` event and separate permission gates.

## Status
`Active` (manual discounts, presets, comp/void) | `Planned` (auto-discounts, BOGO, promo codes)

## Repos Involved
| Repo | Role | Coverage |
|------|------|----------|
| `gwi-pos` | API, discount rules admin, POS discount UI, event engine | Full |
| `gwi-android-register` | Apply discount, comp/void from order screen | Partial |
| `gwi-cfd` | N/A | None |
| `gwi-backoffice` | Discount reporting aggregation | Partial |

---

## UI Entry Points

| Interface | Path / Screen | Who Accesses |
|-----------|--------------|--------------|
| POS Web | Order panel → "Discount" button | Managers |
| POS Web | Order item → long press → "Discount" | Managers |
| POS Web | Order item → long press → "Comp" / "Void" | Managers |
| Admin | `/discounts` | Managers (discount rule admin) |
| Admin | `/settings/discounts` | Managers (approval settings) |
| Admin | `/reports` → discount report | Managers |
| Android | `ApplyDiscountUseCase` | Managers |
| Android | `CompVoidUseCase` | Managers |

---

## Code Locations

### gwi-pos
| File / Directory | Purpose |
|-----------------|---------|
| `src/app/api/discounts/route.ts` | GET/POST — list/create discount rules |
| `src/app/api/discounts/[id]/route.ts` | GET/PUT/DELETE — CRUD single discount rule |
| `src/app/api/orders/[id]/discount/route.ts` | POST/GET/DELETE — apply/list/remove order-level discounts |
| `src/app/api/orders/[id]/items/[itemId]/discount/route.ts` | POST/DELETE — apply/remove item-level discounts |
| `src/app/api/orders/[id]/comp-void/route.ts` | POST/PUT/GET — comp/void/undo/history |
| `src/app/api/reports/discounts/route.ts` | GET — discount usage report |
| `src/lib/order-events/types.ts` | `DiscountAppliedPayload`, `DiscountRemovedPayload`, `CompVoidAppliedPayload` |
| `src/lib/order-events/reducer.ts` | `handleDiscountApplied()`, `handleDiscountRemoved()`, `handleCompVoidApplied()` |
| `src/stores/order-store.ts` | `applyDiscount()`, `syncServerTotals()` |
| `src/app/(admin)/discounts/page.tsx` | Admin discount rules page |
| `src/app/(admin)/settings/discounts/page.tsx` | Discount approval settings |

### gwi-android-register
| File | Purpose |
|------|---------|
| `usecase/ApplyDiscountUseCase.kt` | Apply discount from order screen |
| `usecase/CompVoidUseCase.kt` | Comp/void items |

---

## API Endpoints

### Discount Rules (Admin CRUD)
| Method | Route | Auth | Description |
|--------|-------|------|-------------|
| `GET` | `/api/discounts` | Employee PIN | List discount rules (filters: activeOnly, manualOnly, employeeOnly) |
| `POST` | `/api/discounts` | Manager | Create discount rule |
| `GET` | `/api/discounts/[id]` | Employee PIN | Single rule detail |
| `PUT` | `/api/discounts/[id]` | Manager | Update rule |
| `DELETE` | `/api/discounts/[id]` | Manager | Soft delete rule |

### Order-Level Discounts
| Method | Route | Auth | Description |
|--------|-------|------|-------------|
| `POST` | `/api/orders/[id]/discount` | `manager.discounts` | Apply (or toggle) order discount |
| `GET` | `/api/orders/[id]/discount` | Employee PIN | List discounts on order |
| `DELETE` | `/api/orders/[id]/discount?discountId=X` | `manager.discounts` | Remove order discount |

### Item-Level Discounts
| Method | Route | Auth | Description |
|--------|-------|------|-------------|
| `POST` | `/api/orders/[id]/items/[itemId]/discount` | `manager.discounts` | Apply item discount |
| `DELETE` | `/api/orders/[id]/items/[itemId]/discount?discountId=X` | `manager.discounts` | Remove item discount |

### Comp/Void
| Method | Route | Auth | Description |
|--------|-------|------|-------------|
| `POST` | `/api/orders/[id]/comp-void` | `manager.void_items` | Comp or void an item |
| `PUT` | `/api/orders/[id]/comp-void` | `manager.void_items` | Undo comp/void (restore item) |
| `GET` | `/api/orders/[id]/comp-void` | Employee PIN | Comp/void history for order |

### Reporting
| Method | Route | Auth | Description |
|--------|-------|------|-------------|
| `GET` | `/api/reports/discounts` | `reports.sales` | Discount usage report with breakdowns |

---

## Socket Events

### Emitted (POS → Clients)
| Event | Payload | Trigger |
|-------|---------|---------|
| `order:event` (DISCOUNT_APPLIED) | `{ discountId, type, value, amountCents, reason?, lineItemId? }` | Discount applied |
| `order:event` (DISCOUNT_REMOVED) | `{ discountId, lineItemId? }` | Discount removed |
| `order:event` (COMP_VOID_APPLIED) | `{ lineItemId, action, reason, employeeId, approvedById? }` | Item comped/voided |

All discount operations also dispatch:
- `dispatchOrderTotalsUpdate()` — cross-terminal total sync
- `dispatchOpenOrdersChanged()` — order list refresh
- `dispatchOrderSummaryUpdated()` — Android cross-terminal sync

---

## Data Model

### DiscountRule (preset discount templates)
```
id                String    @id
locationId        String
name              String              // "Military Discount"
displayText       String              // UI display
discountType      String              // bogo|quantity|mix_match|threshold|time_based|manual
discountConfig    Json                // { type: 'percent'|'fixed', value: number, maxAmount?: number }
triggerConfig     Json                // category IDs, item IDs, quantities
scheduleConfig    Json?               // days, times, date range
priority          Int       @default(0)
isStackable       Boolean   @default(true)
requiresApproval  Boolean   @default(false)
maxPerOrder       Int?
isActive          Boolean   @default(true)
isAutomatic       Boolean   @default(false)
isEmployeeDiscount Boolean  @default(false)
```

### OrderDiscount (applied to order)
```
id              String    @id
locationId      String
orderId         String              // FK Order (cascade delete)
discountRuleId  String?             // FK DiscountRule (null for custom)
name            String
amount          Decimal             // discount dollar amount
percent         Decimal?            // percentage (null if fixed)
appliedBy       String?             // employee who applied
isAutomatic     Boolean   @default(false)
reason          String?
```

### OrderItemDiscount (applied to item)
```
id              String    @id
locationId      String
orderId         String
orderItemId     String              // FK OrderItem
discountRuleId  String?             // FK DiscountRule
amount          Decimal
percent         Decimal?
appliedById     String?             // employee who applied
reason          String?
```

### Coupon (promo codes)
```
id              String    @id
locationId      String
code            String              // unique per location
name            String
discountType    String              // percent|fixed|free_item
discountValue   Decimal
minimumOrder    Decimal?
maximumDiscount Decimal?
appliesTo       String   @default('order')  // order|category|item
usageLimit      Int?
usageCount      Int      @default(0)
singleUse       Boolean  @default(false)
validFrom       DateTime?
validUntil      DateTime?
isActive        Boolean  @default(true)
@@unique([locationId, code])
```

### CouponRedemption
```
id              String    @id
couponId        String
orderId         String
customerId      String?
discountAmount  Decimal
redeemedBy      String?
```

### VoidLog (comp/void audit trail)
```
id          String
orderId     String
itemId      String?
voidType    String              // "item"
amount      Decimal
reason      String
wasMade     Boolean
employeeId  String
approvedById String?
```

---

## Business Logic

### Apply Order-Level Discount
1. Validate `manager.discounts` permission
2. Check order status is `open` or `in_progress`
3. **Toggle behavior:** If same `discountRuleId` already applied, remove it instead
4. **Stackability check:** If rule `isStackable: false` and other discounts exist, reject
5. **Max per order:** Enforce `maxPerOrder` limit
6. **Approval workflow:** Check `requireDiscountApproval` setting + `discountApprovalThreshold`
7. Calculate amount: percent → `subtotal × (value / 100)`, fixed → `value`
8. Cap: discount never exceeds subtotal
9. Create `OrderDiscount` record, update `Order.discountTotal`
10. Emit `DISCOUNT_APPLIED` event (fire-and-forget)

### Apply Item-Level Discount
1. Calculate: fixed → `min(value, itemTotal)`, percent → `itemTotal × (value / 100)`
2. Create `OrderItemDiscount` record
3. Increment `Order.discountTotal`
4. Recalculate order total
5. Emit `DISCOUNT_APPLIED` event with `lineItemId`

### Comp/Void Item
1. Validate `manager.void_items` permission
2. **Remote approval (Skill 122):** If manager not present, require 6-digit SMS code. See `docs/features/remote-void-approval.md`.
3. **Concurrency:** Acquire row-level lock to prevent void-during-payment race
4. Update item status: `'voided'` or `'comped'`
5. Create `VoidLog` entry + `AuditLog` entry
6. Recalculate order totals from active items
7. **Auto-close:** If all items voided/comped, order auto-closes with status `cancelled`
8. **Card reversal:** If order was paid with card, attempt Datacap reversal
9. **Inventory:** Comp or `wasMade=true` → deduct as waste; void + `wasMade=false` → restore stock
10. Emit `COMP_VOID_APPLIED` event

### Discount Approval Settings
| Setting | Effect |
|---------|--------|
| `requireDiscountApproval` | Always require manager approval |
| `discountApprovalThreshold` | Percent threshold triggering approval |
| `defaultMaxDiscountPercent` | Max percent without `manager.discounts` |
| `requireVoidApproval` | Require approval for voids |
| `voidApprovalThreshold` | Dollar threshold for void approval |
| `require2FAForLargeVoids` | SMS 2FA for large voids |
| `void2FAThreshold` | Dollar amount triggering 2FA |

### Edge Cases & Business Rules
- **Discount never exceeds subtotal** — capped at order subtotal
- **Comp vs Void:** Comp = $0 charge (item was made, tracked as waste). Void = item removed (not made, restore stock)
- **Undo comp/void:** `PUT /api/orders/[id]/comp-void` restores item to `active` status
- **Tax-inclusive handling:** Split tax calculation for mixed tax-inclusive/exclusive items on void
- **Split order totals:** Parent order totals = sum of all sibling child orders including discounts
- **50% tip warning:** Shown to customer on CFD when tip exceeds 50% of discounted total
- **200% tip hard reject:** POS rejects tips over 200% of total

---

## Cross-Feature Dependencies

> See `_CROSS-REF-MATRIX.md` for full matrix.

### This feature MODIFIES these features:
| Feature | How / Why |
|---------|-----------|
| Payments | Discounted total affects payment amount |
| Reports | Discount totals in sales reports, discount audit report |
| Tips | Discount amount may affect tip calculation basis |
| Inventory | Comp/void affects inventory deductions |

### These features MODIFY this feature:
| Feature | How / Why |
|---------|-----------|
| Orders | Discounts applied to orders/items |
| Roles | Permission required to apply discounts |
| Menu | Item eligibility for discount rules |
| Settings | Discount approval configuration |

### BEFORE CHANGING THIS FEATURE, VERIFY:
- [ ] **Payments** — does this change affect how discounted totals are calculated for payment?
- [ ] **Tips** — does this change affect the tip calculation basis?
- [ ] **Reports** — does this change affect discount reporting queries?
- [ ] **Permissions** — does this action need `manager.discounts` or `manager.void_items`?
- [ ] **Event Sourcing** — does this emit `DISCOUNT_APPLIED` / `DISCOUNT_REMOVED` / `COMP_VOID_APPLIED`?
- [ ] **Inventory** — for comp/void, is waste tracking correct?

---

## Permissions Required

| Action | Permission Key | Level |
|--------|---------------|-------|
| Apply order discount | `manager.discounts` | High |
| Remove order discount | `manager.discounts` | High |
| Apply item discount | `manager.discounts` | High |
| Void item | `manager.void_items` | High |
| Void order | `manager.void_orders` | High |
| Void payment | `manager.void_payments` | Critical |
| Refund | `manager.refunds` | Critical |
| Tax exempt | `manager.tax_exempt` | High |
| View discount report | `reports.sales` | Standard |

---

## Known Constraints & Limits
- **Toggle behavior:** Applying the same discount rule twice removes it (not stacks)
- **Non-stackable rules:** If `isStackable: false`, no other discounts can coexist
- **Discount cap:** Never exceeds order subtotal
- **Row-level lock on void:** Prevents concurrent void + payment race condition
- **Remote approval codes:** 6-digit SMS, single-use, time-limited
- **Auto-close on full void:** Order status → `cancelled` if all items voided/comped

---

## Discount Report

`GET /api/reports/discounts` returns comprehensive breakdown:

| Section | Contents |
|---------|----------|
| `summary` | Total count, total amount, preset vs custom ratio |
| `byRule` | Per-rule: count, total amount, avg amount |
| `byEmployee` | Per-employee: count, total, preset vs custom split |
| `byDay` | Daily: count, total, average |
| `byOrderType` | Per order type: count, total, avg per order |
| `recentDiscounts` | Last N discounts with full detail |

---

## Android-Specific Notes
- `ApplyDiscountUseCase` handles discount application from order screen
- `CompVoidUseCase` handles comp/void with optional `wasMade` flag
- `ManagerPinViewModel` gates elevated actions — discount and void require manager PIN

---

## Related Docs
- **Discount spec:** `docs/skills/SPEC-18-DISCOUNTS.md`
- **Auto-discount spec:** `docs/skills/SPEC-60-AUTO-DISCOUNTS.md`
- **Cross-ref matrix:** `docs/features/_CROSS-REF-MATRIX.md`
- **Order lifecycle:** `docs/guides/ORDER-LIFECYCLE.md` (event sourcing for discounts)
- **Payments rules:** `docs/guides/PAYMENTS-RULES.md` (discount affects payment total)

---

*Last updated: 2026-03-03*
