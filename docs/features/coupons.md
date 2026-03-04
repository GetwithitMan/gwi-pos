# Feature: Coupons

> **Before editing this feature:** Read `_CROSS-REF-MATRIX.md` → find Coupons → read every listed dependency doc.

## Summary

Coupons is a standalone promotional-code system that is distinct from `DiscountRule` presets (which are manager-applied order-level or item-level discounts). A coupon has a human-readable `code` (e.g., `SAVE20`, `WELCOME10`) that a customer or cashier enters at checkout. The system validates the code, checks validity windows, usage limits, and per-customer limits, then creates a `CouponRedemption` record tied to the order and increments the coupon's `usageCount`. Three discount types are supported: `percent` off, `fixed` dollar amount off, or `free_item` (a specific `MenuItem` at no charge). Coupons can be scoped to the entire order, specific categories, or specific menu items. A coupon report at `/api/reports/coupons` aggregates redemptions, discount totals, and daily trends for management review.

## Status
`Active`

## Repos Involved
| Repo | Role | Coverage |
|------|------|----------|
| `gwi-pos` | API, admin UI, redemption logic, reports | Full |
| `gwi-android-register` | N/A (coupon redemption not yet implemented on Android) | None |
| `gwi-cfd` | N/A | None |

---

## UI Entry Points

| Interface | Path / Screen | Who Accesses |
|-----------|--------------|--------------|
| Admin | `/coupons` → `src/app/(admin)/coupons/page.tsx` | Managers |
| Admin (alias) | `/settings/coupons` → re-exports from `/coupons/page.tsx` | Managers |
| Admin Reports | `/settings/reports/coupons` → coupon redemption report page | Managers |
| POS Web | Code entry field on checkout / discount sheet (triggers GET `/api/coupons?code=...`) | Cashiers |

---

## Code Locations

### gwi-pos
| File / Directory | Purpose |
|-----------------|---------|
| `src/app/api/coupons/route.ts` | GET (list / code-lookup with validation) / POST (create coupon) |
| `src/app/api/coupons/[id]/route.ts` | GET (single coupon + recent redemptions) / PUT (update, activate, deactivate, redeem) / DELETE (soft-delete or deactivate if redeemed) |
| `src/app/api/reports/coupons/route.ts` | GET coupon report — aggregate stats, per-coupon breakdown, daily trend, redemptions by type |
| `src/app/(admin)/coupons/page.tsx` | Coupon CRUD admin page (uses `useAdminCRUD`) |
| `src/app/(admin)/settings/coupons/page.tsx` | Re-exports coupon admin page |
| `src/app/(admin)/settings/reports/coupons/` | Coupon report admin page |

---

## API Endpoints

| Method | Route | Auth | Description |
|--------|-------|------|-------------|
| `GET` | `/api/coupons` | Employee PIN | List all coupons for location; `?activeOnly=true` filters inactive; `?code=XXX` does code lookup with full validity check |
| `POST` | `/api/coupons` | Manager | Create new coupon; code is forced uppercase and must be unique per location |
| `GET` | `/api/coupons/[id]` | Employee PIN | Get single coupon with up to 50 most-recent redemptions |
| `PUT` | `/api/coupons/[id]` | Employee PIN | Update coupon fields OR perform action: `activate`, `deactivate`, `redeem` |
| `DELETE` | `/api/coupons/[id]` | Manager | Soft-delete coupon; if redemptions exist, deactivates instead of deleting |
| `GET` | `/api/reports/coupons` | `REPORTS_SALES` | Coupon report with date range filter; requires permission check |

### Redemption via PUT action
`PUT /api/coupons/[id]` with `{ action: 'redeem', orderId, discountAmount, customerId?, employeeId? }` performs the full validation + redemption sequence (see Business Logic below).

---

## Data Model

```
model Coupon {
  id         String   // cuid
  locationId String
  location   Location

  // Identity
  code        String   // "SAVE20" — stored uppercase; unique per location
  name        String   // Display name for manager/receipt
  description String?

  // Discount configuration
  discountType  String  // 'percent' | 'fixed' | 'free_item'
  discountValue Decimal // Percent (e.g. 20) or dollar amount (e.g. 5.00)
  freeItemId    String? // If discountType = 'free_item', the MenuItem given free
  freeItem      MenuItem?

  // Scope restrictions
  minimumOrder    Decimal? // Minimum pre-discount order total required
  maximumDiscount Decimal? // Cap on total discount regardless of discountValue
  appliesTo       String   // 'order' | 'category' | 'item'
  categoryIds     Json?    // Array of category IDs (when appliesTo = 'category')
  itemIds         Json?    // Array of MenuItem IDs (when appliesTo = 'item')

  // Usage limits
  usageLimit       Int?    // Total redemptions allowed (null = unlimited)
  usageCount       Int     // Running total of redemptions
  perCustomerLimit Int?    // Max uses per customer (null = unlimited)
  singleUse        Boolean // One redemption per customer ever

  // Validity window
  validFrom  DateTime?  // Null = valid immediately
  validUntil DateTime?  // Null = no expiry
  isActive   Boolean    // Manual on/off switch

  // Audit
  createdBy  String?    // Employee ID who created this coupon

  createdAt  DateTime
  updatedAt  DateTime
  deletedAt  DateTime?  // Soft delete
  syncedAt   DateTime?  // Cloud sync

  redemptions CouponRedemption[]

  @@unique([locationId, code])
  @@index([locationId, isActive, validUntil])
  @@index([locationId, code])
}

model CouponRedemption {
  id         String
  locationId String
  location   Location

  couponId   String
  coupon     Coupon

  orderId    String
  order      Order

  customerId String?    // Optional — link to Customer record
  customer   Customer?

  discountAmount Decimal  // Actual dollar amount discounted on this order

  redeemedAt DateTime    // When the redemption occurred
  redeemedBy String?     // Employee ID who applied the coupon

  createdAt  DateTime
  updatedAt  DateTime
  deletedAt  DateTime?
  syncedAt   DateTime?

  @@index([locationId])
  @@index([couponId])
  @@index([orderId])
  @@index([customerId])
}
```

---

## Business Logic

### Code Lookup and Validation (GET `/api/coupons?code=XXX`)
1. Look up `Coupon` where `locationId` matches, `code = code.toUpperCase()`, and `isActive = true`.
2. If not found, return `404 Invalid coupon code`.
3. Check `validFrom`: if set and `now < validFrom`, return `400 Coupon not yet valid`.
4. Check `validUntil`: if set and `now > validUntil`, return `400 Coupon has expired`.
5. Check `usageLimit`: if set and `usageCount >= usageLimit`, return `400 Coupon usage limit reached`.
6. Return coupon with numeric Decimal fields coerced to `number`.

### Redemption Flow (PUT `/api/coupons/[id]` with `action: 'redeem'`)
1. Re-validate `isActive`, `validFrom`, `validUntil`, and `usageLimit` (same checks as lookup, guarding against race conditions).
2. **Per-customer limit check:** if `customerId` is provided and `perCustomerLimit` is set, count existing `CouponRedemption` records for this `(couponId, customerId)` pair; reject if at or above limit.
3. **Single-use check:** if `customerId` is provided and `singleUse = true`, look for any prior redemption for this `(couponId, customerId)` pair; reject if found.
4. Create `CouponRedemption` record with `orderId`, `customerId`, `discountAmount`, and `redeemedBy`.
5. Increment `Coupon.usageCount` by 1.
6. Return `{ success: true, coupon: { ...updatedCoupon } }`.

### Coupon Create Flow
1. Validate required fields: `locationId`, `code`, `name`, `discountType`, `discountValue`.
2. Force `code` to uppercase.
3. Check for duplicate `(locationId, code)` — return `400` if exists.
4. Create `Coupon` with `appliesTo` defaulting to `'order'` and `singleUse` defaulting to `false`.
5. Return created coupon with Decimal fields coerced to `number`.

### Activate / Deactivate
- `PUT /api/coupons/[id]` with `{ action: 'activate' }` — sets `isActive = true`.
- `PUT /api/coupons/[id]` with `{ action: 'deactivate' }` — sets `isActive = false`.

### Delete vs Deactivate on DELETE
1. Count existing `CouponRedemption` records for the coupon.
2. If `redemptionCount > 0`: **cannot hard-delete** — set `isActive = false` instead; return a message explaining deactivation was used.
3. If no redemptions: soft-delete via `deletedAt = new Date()`.

### Coupon Report (GET `/api/reports/coupons`)
1. Requires `REPORTS_SALES` permission (enforced via `requirePermission`).
2. Accepts `startDate` / `endDate` query params to filter `CouponRedemption.redeemedAt`.
3. Returns:
   - **Summary:** total coupons, active coupons, total redemptions, total discount given, total order value on redeemed orders, average discount per redemption.
   - **Per-coupon stats:** redemption count, total discount, average order value, usage vs limit.
   - **Daily trend:** redemption count and discount amount per day.
   - **By discount type:** counts and totals grouped by `discountType`.
   - **Recent redemptions:** up to 50 most recent, with coupon code/name, order number, order total.

---

## Cross-Feature Dependencies

> See `_CROSS-REF-MATRIX.md` for full matrix.

### This feature MODIFIES these features:
| Feature | How / Why |
|---------|-----------|
| Orders | `CouponRedemption` is linked to an `Order`; the discount amount affects the order total shown in reports |
| Customers | `CouponRedemption.customerId` links to `Customer`; per-customer limit and single-use checks require customer identification |
| Reports | Coupon report aggregates over `CouponRedemption` records; discount given appears in sales report revenue calculations |
| Payments | Coupon discount reduces the order total before payment; affects the amount charged to the customer |

### These features MODIFY this feature:
| Feature | How / Why |
|---------|-----------|
| Menu | `Coupon.freeItemId` references `MenuItem`; deleting a menu item that is a free-item coupon target would orphan the coupon |
| Customers | Customer record must exist for `perCustomerLimit` and `singleUse` enforcement |

### BEFORE CHANGING THIS FEATURE, VERIFY:
- [ ] **Orders** — does redemption logic still correctly link to the order and record the discount amount?
- [ ] **Customers** — if customer identification changes, does per-customer limit enforcement still work?
- [ ] **Reports** — does the coupon report correctly filter by date range on `redeemedAt`?
- [ ] **Delete safety** — ensure coupons with redemptions are deactivated, not hard-deleted.
- [ ] **Permissions** — coupon report requires `REPORTS_SALES`; coupon CRUD requires `CUSTOMERS_COUPONS` or manager permissions.

---

## Permissions Required

| Action | Permission Key | Level |
|--------|---------------|-------|
| View coupons | `CUSTOMERS_COUPONS` | Standard |
| Create coupon | `CUSTOMERS_COUPONS` | Manager |
| Edit / activate / deactivate coupon | `CUSTOMERS_COUPONS` | Manager |
| Delete coupon | `CUSTOMERS_COUPONS` | Manager |
| Redeem coupon at POS | Employee PIN (any authenticated employee) | Standard |
| View coupon report | `REPORTS_SALES` | Manager |

---

## Known Constraints
- Coupon codes are forced to uppercase on create and on lookup — case-insensitive matching is achieved by uppercasing both sides.
- Codes must be unique per location (`@@unique([locationId, code])`). The same code string can exist across different locations.
- A coupon with any redemptions **cannot be hard-deleted** — the API deactivates it instead and returns a message. This preserves the audit trail on closed orders.
- `singleUse` is only enforced when a `customerId` is provided at redemption time. A redemption without a `customerId` bypasses the single-use check entirely.
- `perCustomerLimit` similarly requires a `customerId` to be enforced.
- There is no race-condition guard for concurrent redemptions (e.g., two cashiers redeeming the same last-use coupon simultaneously). Under high load, `usageCount` could marginally exceed `usageLimit` before the increment propagates. A database-level atomic check (e.g., a conditional update) would be needed to fully prevent this.
- The `discountAmount` stored on `CouponRedemption` is passed in by the client — the server does not recalculate it from `discountType` + `discountValue`. Callers must compute the correct amount before calling the redeem action.
- `freeItemId` (free item coupon type) links to `MenuItem` but there is no cascade-delete guard. If the referenced `MenuItem` is deleted, the coupon becomes invalid at the UI layer but the database record persists.
- The coupon report fetches up to 50 recent redemptions per call. High-volume locations may need pagination for full historical analysis.
- No socket event is emitted when a coupon is created, redeemed, or deactivated. Admin UI refreshes must be triggered manually.

---

## Related Docs
- **Feature doc:** `docs/features/discounts.md`
- **Feature doc:** `docs/features/orders.md`
- **Feature doc:** `docs/features/customers.md`
- **Feature doc:** `docs/features/reports.md`
- **Feature doc:** `docs/features/payments.md`
- **Skills:** Skill 35

---

*Last updated: 2026-03-03*
