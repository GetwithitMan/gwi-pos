# Feature: Happy Hour / Time-Based Pricing

> **Before editing this feature:** Read `_CROSS-REF-MATRIX.md` → find Happy Hour → read every listed dependency doc.

## Summary

Happy Hour provides automatic time-based price discounts. Managers define one or more named schedules (days of week + start/end times), select a discount type (percent off or fixed amount off), and choose which items the discount applies to (all, specific categories, or specific items). When the current time falls inside an active schedule, `isHappyHourActive()` returns true and `getHappyHourPrice()` applies the discount at the point of POS rendering. All configuration lives in `LocationSettings.happyHour` (a JSON blob stored in `Location.settings`) — there is no dedicated happy hour database table. The feature also has legacy per-`MenuItem` fields (`happyHourEnabled`, `happyHourDiscount`, `happyHourStart`, `happyHourEnd`, `happyHourDays`) used solely by the Entertainment/Timed Rentals subsystem; the main POS uses the settings-driven path only.

## Status
`Active`

## Repos Involved
| Repo | Role | Coverage |
|------|------|----------|
| `gwi-pos` | Settings storage, pricing engine, admin UI, POS integration | Full |
| `gwi-android-register` | Reads bootstrap settings; happy hour pricing evaluated client-side via the same settings object | Partial |
| `gwi-cfd` | N/A | None |

---

## UI Entry Points

| Interface | Path / Screen | Who Accesses |
|-----------|--------------|--------------|
| Admin | `/settings/happy-hour` → `src/app/(admin)/settings/happy-hour/page.tsx` | Managers |
| POS Web | Item price display on order screen (badge + struck-through original price) | All staff |
| Entertainment | `EntertainmentSessionStart` uses per-item `happyHourEnabled` / `happyHourPrice` fields | All staff |

---

## Code Locations

### gwi-pos
| File / Directory | Purpose |
|-----------------|---------|
| `src/app/(admin)/settings/happy-hour/page.tsx` | Admin UI — master toggle, schedule builder, discount config |
| `src/lib/settings.ts` | `HappyHourSettings` type, `HappyHourSchedule` type, `isHappyHourActive()`, `getHappyHourPrice()`, default values, `mergeWithDefaults()` handling for schedules |
| `src/app/api/settings/route.ts` | GET/PUT `/api/settings` — persists happy hour config in `Location.settings` JSON |
| `src/app/api/menu/items/[id]/route.ts` | Reads `happyHourEnabled` / `happyHourPrice` on MenuItem (entertainment path only) |
| `src/app/(pos)/orders/hooks/useOrderHandlers.ts` | Reads `happyHourEnabled` / `happyHourPrice` when launching entertainment sessions |
| `src/lib/entertainment-pricing.ts` | Entertainment-specific happy hour pricing (separate from main POS flow) |
| `src/components/entertainment/EntertainmentSessionStart.tsx` | Passes `happyHourEnabled` / `happyHourPrice` into session start |
| `src/app/(pos)/orders/types.ts` | `happyHourPrice` field on POS item type |

---

## API Endpoints

| Method | Route | Auth | Description |
|--------|-------|------|-------------|
| `GET` | `/api/settings` | Employee PIN | Fetch location settings (includes `happyHour` object) |
| `PUT` | `/api/settings` | Manager (`SETTINGS_EDIT`) | Save updated happy hour config |

There is no dedicated `/api/happy-hour` route. All persistence goes through `/api/settings`.

---

## Data Model

Happy hour configuration is stored as a nested object inside `Location.settings` (a JSON column). There is no standalone Prisma model.

```
LocationSettings.happyHour: HappyHourSettings {
  enabled         Boolean               // Master on/off switch
  name            String                // Display name, e.g. "Happy Hour", "Early Bird"

  schedules       HappyHourSchedule[]   // One or more active windows
  //   HappyHourSchedule {
  //     dayOfWeek   number[]            // 0–6, Sunday–Saturday
  //     startTime   string              // "HH:MM" 24-hour
  //     endTime     string              // "HH:MM" 24-hour
  //   }

  discountType    'percent' | 'fixed'   // How the discount is expressed
  discountValue   number                // Percent (e.g. 20) or dollar amount (e.g. 2.00)

  appliesTo       'all' | 'categories' | 'items'
  categoryIds     string[]              // Used when appliesTo = 'categories'
  itemIds         string[]              // Used when appliesTo = 'items'

  showBadge         Boolean             // Show "Happy Hour" label on qualifying items
  showOriginalPrice Boolean             // Strike through original price
}
```

Legacy per-item fields on `MenuItem` (used only by Entertainment):
```
MenuItem {
  happyHourEnabled  Boolean?    // Per-item override for entertainment items
  happyHourDiscount Int?        // Percentage off (e.g. 50 = 50% off)
  happyHourStart    String?     // "13:00"
  happyHourEnd      String?     // "16:00"
  happyHourDays     Json?       // ["monday", "tuesday", ...]
}
```

Default settings (from `DEFAULT_SETTINGS`):
- `enabled: false`
- `name: 'Happy Hour'`
- `schedules: [{ dayOfWeek: [1,2,3,4,5], startTime: '16:00', endTime: '18:00' }]`
- `discountType: 'percent'`, `discountValue: 20`
- `appliesTo: 'all'`
- `showBadge: true`, `showOriginalPrice: true`

---

## Business Logic

### Schedule Activation Check (`isHappyHourActive`)
1. If `enabled` is false, return immediately — no discount applied.
2. Get current day of week (0–6) and current time as total minutes since midnight.
3. Iterate each schedule in `settings.schedules`.
4. For each schedule, check if `currentDay` is in `schedule.dayOfWeek`.
5. Convert `startTime`/`endTime` to minutes.
6. **Overnight schedule handling:** if `endMinutes < startMinutes`, schedule crosses midnight — match if `currentTime >= startMinutes` OR `currentTime <= endMinutes`.
7. **Normal schedule:** match if `startMinutes <= currentTime <= endMinutes`.
8. Return `true` if any schedule matches; otherwise `false`.

### Price Calculation (`getHappyHourPrice`)
1. If `!enabled` or `!isHappyHourActive()`, return original price unchanged with `isDiscounted: false`.
2. Determine if item qualifies based on `appliesTo`:
   - `'all'` → always qualifies.
   - `'categories'` → qualifies if `categoryId` is in `settings.categoryIds`.
   - `'items'` → qualifies if `itemId` is in `settings.itemIds`.
3. If item does not qualify, return original price with `isDiscounted: false`.
4. Apply discount:
   - `'percent'`: `discountedPrice = originalPrice * (1 - discountValue / 100)`.
   - `'fixed'`: `discountedPrice = Math.max(0, originalPrice - discountValue)`.
5. Round to nearest cent: `Math.round(discountedPrice * 100) / 100`.
6. Return `{ price: discountedPrice, isDiscounted: true }`.

### Admin Configuration Flow
1. Manager navigates to `/settings/happy-hour`.
2. Toggle master `enabled` switch.
3. Set display name (shown on POS badges and receipts).
4. Add one or more schedules — select days by clicking day buttons (Sun–Sat), set start and end times.
5. Choose discount type (percentage or fixed) and value.
6. Choose scope: All Items, Specific Categories, or Specific Items.
   - If categories or items: a notice directs manager to the Menu page to tag individual items/categories.
7. Toggle badge visibility and original-price strikethrough.
8. Click Save — PUT `/api/settings` persists the full `happyHour` object.
9. POS and Android clients re-read settings on next bootstrap or settings reload.

### Edge Cases
- **Overnight schedules** (e.g., 10 PM – 2 AM) are supported; the midnight-crossing logic in `isHappyHourActive` handles them correctly.
- **Multiple schedules** are supported (e.g., lunch happy hour 11–13 + evening 16–18). Any matching schedule activates pricing.
- **categoryIds / itemIds inclusion** is configured on the Menu page, not inside this settings page; the settings page only controls the mode (`appliesTo`).
- **Price floor:** fixed-amount discounts cannot reduce a price below $0.00 (`Math.max(0, ...)`).
- **Entertainment items** use the legacy per-`MenuItem` fields and a separate pricing path (`entertainment-pricing.ts`), not the settings-driven path.

---

## Cross-Feature Dependencies

> See `_CROSS-REF-MATRIX.md` for full matrix.

### This feature MODIFIES these features:
| Feature | How / Why |
|---------|-----------|
| Menu | Discounted prices displayed on POS item grid and item detail |
| Orders | Item prices on new order items may be reduced by happy hour pricing |
| Online Ordering | Happy hour badge and pricing visible to online customers if enabled |
| Entertainment | Per-item `happyHourEnabled` fields affect entertainment session start pricing |

### These features MODIFY this feature:
| Feature | How / Why |
|---------|-----------|
| Settings | Entire config lives in `Location.settings` JSON; settings API saves/loads it |
| Menu | Category/item IDs referenced by `categoryIds` / `itemIds` must exist |

### BEFORE CHANGING THIS FEATURE, VERIFY:
- [ ] **Settings** — does your change affect how `mergeWithDefaults()` handles the `schedules` array? (It requires special handling to avoid overwriting with the default schedule.)
- [ ] **Orders** — does a pricing change affect already-added order items or only new additions?
- [ ] **Entertainment** — legacy MenuItem fields use a different code path; don't conflate the two.
- [ ] **Android** — settings sync: does the Android bootstrap pick up updated happy hour settings?

---

## Permissions Required

| Action | Permission Key | Level |
|--------|---------------|-------|
| View happy hour settings | `SETTINGS_VIEW` | Standard |
| Save happy hour settings | `SETTINGS_EDIT` | Manager |

---

## Known Constraints
- There is no dedicated `/api/happy-hour` route — all config lives in `/api/settings`.
- The `schedules` array requires special merge logic in `mergeWithDefaults()` to avoid being overwritten by the default; a partial `happyHour` update with an empty or missing `schedules` array will fall back to the default schedule.
- Legacy per-`MenuItem` happy hour fields (`happyHourEnabled`, `happyHourDiscount`, `happyHourStart`, `happyHourEnd`, `happyHourDays`) are only used by the Entertainment subsystem. They are not evaluated by `isHappyHourActive()` or `getHappyHourPrice()`.
- Happy hour pricing is evaluated at render time using the current wall clock; it is not recorded on the `OrderItem` or `Order` record as a separate field. Reports reflect the discounted price as the actual item price.
- No socket event is emitted when happy hour settings change; POS terminals re-read settings on next page load or manual refresh.
- There is no override mechanism to exempt a specific item from an `appliesTo: 'all'` rule at the POS without switching to `appliesTo: 'items'` mode.
- Minimum order value and maximum discount cap (present on `Coupon`) are not available for happy hour — the entire qualifying order is discounted uniformly.

---

## Related Docs
- **Feature doc:** `docs/features/discounts.md`
- **Feature doc:** `docs/features/auto-discounts.md`
- **Feature doc:** `docs/features/pricing-programs.md`
- **Feature doc:** `docs/features/settings.md`
- **Feature doc:** `docs/features/entertainment.md`
- **Architecture guide:** `docs/guides/CODING-STANDARDS.md`

---

*Last updated: 2026-03-03*
