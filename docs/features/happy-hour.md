# Feature: Pricing Rules (Multi-Rule Pricing Engine)

> **Before editing this feature:** Read `_CROSS-REF-MATRIX.md` → find Pricing Rules → read every listed dependency doc.

## Summary

Pricing Rules replaces the legacy single happy-hour system with a multi-rule pricing engine. Managers define any number of named rules — each with its own schedule, adjustment type, scope, priority, and display preferences. When the current time falls inside an active rule's window, items matching that rule's scope receive automatic price adjustments at both POS rendering (menu item display) and order creation (server-side price application). All configuration lives in `LocationSettings.pricingRules` (a JSON array stored in `Location.settings`). The engine auto-migrates legacy `happyHour` settings on first read.

## Status
`Active`

## Repos Involved
| Repo | Role | Coverage |
|------|------|----------|
| `gwi-pos` | Settings storage, pricing engine, admin UI, POS integration, order wiring | Full |
| `gwi-android-register` | Reads bootstrap settings; pricing rules evaluated client-side | Partial |
| `gwi-cfd` | N/A | None |

---

## UI Entry Points

| Interface | Path / Screen | Who Accesses |
|-----------|--------------|--------------|
| Admin | `/settings/happy-hour` → `src/app/(admin)/settings/happy-hour/page.tsx` | Managers |
| POS Web | HappyHourBanner (top of orders page) — active rule countdown | All staff |
| POS Web | FloorPlanMenuItem — colored border, badge, adjusted price | All staff |

---

## Behavioral Contract

### One Winner Per Item
For any given item at any point in time, at most one pricing rule applies. Rules never stack.

### Winner Selection
1. **Priority** (descending) — highest priority number wins
2. **Scope specificity** (tie-breaker) — `items` > `categories` > `all`
3. **Lexical ID** (final tie-breaker) — smallest `id` string wins

### Engine Idempotency
`getBestPricingRuleForItem()` is a pure function. Given the same inputs (rules array, itemId, categoryId, originalPrice, timestamp), it always returns the same `PricingAdjustment`. Safe to call from render loops, memos, and server-side code.

---

## Time Semantics

### Schedule Types
| Type | Fields Used | Description |
|------|------------|-------------|
| `recurring` | `schedules[]` (dayOfWeek, startTime, endTime) | Weekly recurring windows |
| `one-time` | `startDate`, `endDate`, `startTime`, `endTime` | Fixed date range |
| `yearly-recurring` | `startDate` (MM-DD), `endDate` (MM-DD), `startTime`, `endTime` | Annual events |

### Time Rules
- **Start inclusive, end exclusive:** A rule active 16:00–18:00 applies at 16:00:00, not at 18:00:00
- **Cross-midnight:** endTime < startTime means the rule spans midnight (e.g., 22:00–02:00)
- **Multiple schedules:** Recurring rules support multiple schedule windows (e.g., lunch 11–13 + evening 16–18)

---

## Price Math

### 5 Adjustment Types
| Type | Formula | Example |
|------|---------|---------|
| `percent-off` | `price * (1 - value/100)` | 20% off $10 = $8.00 |
| `percent-increase` | `price * (1 + value/100)` | 10% increase on $10 = $11.00 |
| `fixed-off` | `price - value` | $2 off $10 = $8.00 |
| `fixed-increase` | `price + value` | $1 increase on $10 = $11.00 |
| `override-price` | `value` | Override to $5.00 |

### Constraints
- Adjusted price is clamped to >= $0.00 (`Math.max(0, ...)`)
- Rounded to 2 decimal places (`Math.round(x * 100) / 100`)
- **Modifiers are unaffected** — pricing rules only adjust the base item price
- **Manual/open price items skip rules** — items with `pricingOptionId`, `soldByWeight`, `blockTimeMinutes`, or `pizzaConfig` bypass the engine

---

## Scope Rules

| `appliesTo` | Matches |
|-------------|---------|
| `all` | Every menu item |
| `categories` | Items whose `categoryId` is in `rule.categoryIds[]` |
| `items` | Items whose `id` is in `rule.itemIds[]` |

---

## Data Model

### PricingRule Interface
```typescript
interface PricingRule {
  id: string                    // crypto.randomUUID()
  name: string                  // 1-50 chars
  description?: string          // optional notes, max 200 chars
  enabled: boolean
  color: string                 // hex "#XXXXXX"
  type: 'recurring' | 'one-time' | 'yearly-recurring'
  schedules: PricingRuleSchedule[]  // for recurring type
  startDate?: string            // "YYYY-MM-DD" (one-time) or "MM-DD" (yearly)
  endDate?: string
  startTime?: string            // "HH:MM" for date-based rules
  endTime?: string
  adjustmentType: 'percent-off' | 'percent-increase' | 'fixed-off' | 'fixed-increase' | 'override-price'
  adjustmentValue: number
  appliesTo: 'all' | 'categories' | 'items'
  categoryIds: string[]
  itemIds: string[]
  priority: number
  showBadge: boolean
  showOriginalPrice: boolean
  badgeText?: string            // max 20 chars
  autoDelete: boolean           // one-time events only
  createdAt: string             // ISO date
}
```

### PricingAdjustment Interface (Engine Output)
```typescript
interface PricingAdjustment {
  version: 1
  ruleId: string
  ruleName: string
  adjustmentType: PricingRule['adjustmentType']
  adjustmentValue: number
  originalPrice: number
  adjustedPrice: number
  color: string
  showBadge: boolean
  showOriginalPrice: boolean
  badgeText?: string
}
```

### OrderItem Column
`pricingRuleApplied JSONB` — stores the full `PricingAdjustment` snapshot at time of order creation. Migration: `046-pricing-rule-metadata.js`. Indexed on `ruleId` for analytics.

---

## Banner Display Logic

The `HappyHourBanner` component (kept as export name for backward compat) displays at the top of the POS:

1. Fetches `pricingRules` from `/api/settings`
2. Calls `getActivePricingRules()` to get currently active rules
3. **Banner selection:**
   - Prefer highest-priority active rule with `appliesTo: 'all'` (global banner)
   - If none: show highest-priority scoped rule with scope hint (e.g., "- 3 categories")
   - If only single-item-specific rules (`appliesTo: 'items'` with 1 item): suppress banner entirely
4. Shows rule name, scope hint, "+N more" count, and countdown timer
5. Uses `rule.color` as background; amber when <= 15 minutes remaining
6. Refreshes every 60 seconds + immediately on `settings:updated` socket event

---

## POS Menu Item Visual Indicators

When `pricingAdjustment` is provided to `FloorPlanMenuItem`:
- **Colored border:** 2px solid in `pricingAdjustment.color` (fallback `#10b981`)
- **Badge:** Small pill in top-right corner with `badgeText` (truncated 20 chars), colored background
- **Price display:** Adjusted price in rule color; original price struck through if `showOriginalPrice`
- Items with no active pricing rule render unchanged

---

## Migration from Legacy happyHour

The `mergeWithDefaults()` function in `settings.ts` auto-migrates:
- If `pricingRules` exists and is a non-empty array → use it (ignore legacy)
- If `pricingRules` is empty/missing but `happyHour.enabled` is true with valid schedules → create a single migrated rule with `id: 'migrated-happy-hour'`
- Legacy `happyHour` settings object is preserved for backward compatibility but not consulted when `pricingRules` is populated

Legacy per-`MenuItem` happy hour fields (`happyHourEnabled`, `happyHourDiscount`, etc.) are only used by the Entertainment subsystem and are unaffected.

---

## Overlap Detection

`checkPricingRuleOverlaps(rules)` analyzes all enabled rules for time + scope overlaps:
- **Info:** Same time, different scope (no conflict)
- **Warning:** Same time, overlapping scope (priority resolves it)
- **Error:** Same time, same scope, same priority (ambiguous winner)

The admin UI displays overlap warnings before save.

---

## autoDelete Behavior

One-time rules with `autoDelete: true` are automatically removed after their end date passes. This cleanup happens during the next settings save or can be triggered by a scheduled job.

---

## Code Locations

### gwi-pos
| File / Directory | Purpose |
|-----------------|---------|
| `src/lib/settings.ts` | `PricingRule`, `PricingAdjustment` types, engine functions (`isPricingRuleActive`, `getActivePricingRules`, `getBestPricingRuleForItem`, `getAdjustedPrice`, `getPricingRuleEndTime`, `checkPricingRuleOverlaps`, `validatePricingRule`), legacy migration in `mergeWithDefaults()` |
| `src/app/(admin)/settings/happy-hour/page.tsx` | Admin UI — rule CRUD, schedule builder, scope picker, overlap warnings |
| `src/components/pos/HappyHourBanner.tsx` | POS banner — active rule display with countdown |
| `src/components/floor-plan/FloorPlanMenuItem.tsx` | Menu item pricing indicators (border, badge, price) |
| `src/components/floor-plan/FloorPlanHome.tsx` | Computes `pricingAdjustmentMap` from active rules, passes to menu items |
| `src/app/api/settings/route.ts` | GET/PUT — pricingRules full-array replacement in PUT handler |
| `src/lib/domain/order-items/item-operations.ts` | `createOrderItem` applies `getBestPricingRuleForItem` for catalog-priced items |
| `src/lib/domain/order-items/types.ts` | `MenuItemInfo.categoryId` added for pricing rule scope matching |
| `src/app/api/orders/[id]/items/route.ts` | Passes `pricingRules` to `createOrderItem` |
| `scripts/migrations/046-pricing-rule-metadata.js` | `pricingRuleApplied` JSONB column + ruleId index on OrderItem |

---

## API Endpoints

| Method | Route | Auth | Description |
|--------|-------|------|-------------|
| `GET` | `/api/settings` | Employee PIN | Fetch location settings (includes `pricingRules` array) |
| `PUT` | `/api/settings` | Manager (`SETTINGS_EDIT`) | Save pricing rules (full-array replacement) |

No dedicated `/api/pricing-rules` route. All persistence goes through `/api/settings`.

---

## Cross-Feature Dependencies

### This feature MODIFIES these features:
| Feature | How / Why |
|---------|-----------|
| Menu | Adjusted prices displayed on POS item grid (FloorPlanMenuItem) |
| Orders | Item prices on new order items adjusted by active rules; `pricingRuleApplied` stored on OrderItem |
| Reports | OrderItem price reflects adjusted price; `pricingRuleApplied` JSONB available for rule-specific reporting |

### These features MODIFY this feature:
| Feature | How / Why |
|---------|-----------|
| Settings | Config lives in `Location.settings` JSON; settings API saves/loads |
| Menu | Category/item IDs referenced by `categoryIds` / `itemIds` must exist |

### BEFORE CHANGING THIS FEATURE, VERIFY:
- [ ] **Settings** — does your change affect how `mergeWithDefaults()` handles the `pricingRules` array?
- [ ] **Orders** — pricing rules apply at order item creation only, not retroactively
- [ ] **Entertainment** — legacy MenuItem fields use a different code path; don't conflate
- [ ] **Android** — settings sync: does the Android bootstrap pick up updated pricingRules?
- [ ] **Dual Pricing** — `cardPrice` is recalculated from the adjusted price, not the original

---

## Permissions Required

| Action | Permission Key | Level |
|--------|---------------|-------|
| View pricing rules settings | `SETTINGS_VIEW` | Standard |
| Save pricing rules settings | `SETTINGS_EDIT` | Manager |

---

## Known Constraints

- **Concurrency:** Settings updates are last-write-wins with no merge. Two managers editing rules simultaneously → last save wins.
- **No per-item exemption:** There is no override to exempt a specific item from an `appliesTo: 'all'` rule without switching to `appliesTo: 'items'` mode.
- **No stacking:** Only one rule can apply per item. If multiple rules match, priority + tie-breakers determine the winner.
- **Modifiers unaffected:** Pricing rules only adjust base item price; modifier prices are unchanged.
- **Render-time evaluation:** POS display uses real-time evaluation. Order creation snapshots the adjustment at insert time via `pricingRuleApplied`.
- **Price locks at creation:** Once an item is added to an order at a rule-adjusted price, that price persists even if the rule expires or is disabled before payment.
- **No minimum order value:** Unlike coupons, pricing rules have no minimum spend requirement.
- **Legacy `happyHour` preserved:** The old settings object remains in `LocationSettings` for backward compatibility. Auto-migrated to a pricing rule on first read if pricingRules is undefined (never set). Explicit empty array `[]` is respected (no re-migration).
- **Price increases hidden from customers:** For `percent-increase`, `fixed-increase`, and `override-price` (where adjusted > original), the engine forces `showBadge: false`, `showOriginalPrice: false`, and suppresses CFD countdown. Customers never see the lower base price.
- **Tips on adjusted prices:** Tip suggestions use the order subtotal which reflects rule-adjusted prices. The `tipGuide.basis: 'pre_discount'` setting only applies to manual OrderDiscounts, not pricing rule adjustments.

## Security & Hardening

- **Server-side validation:** Settings PUT route validates pricingRules array (max 500 rules, HTML tag stripping, `isFinite()` guards on numeric fields).
- **Null guards:** Engine functions guard against null `schedules`, `categoryIds`, `itemIds` arrays (prevents TypeError if DB data is corrupted).
- **Scope bypass prevention:** Empty/null categoryId and itemId never match scope rules. `Array.isArray()` checks on all array operations.
- **XSS prevention:** Rule name, badgeText, and description are stripped of HTML tags on save. `validatePricingRule()` rejects names containing HTML.
- **Price manipulation:** Existing `hasOpenPricedItems` check requires `MGR_OPEN_ITEMS` permission for client-sent price deviations. Pricing rule adjustment is server-side only.

## CFD Integration

- **Per-rule CFD countdown:** Each rule has a `showCfdCountdown` toggle. When enabled and the rule is a discount (not an increase), the CFD idle screen and order display show a countdown banner with the rule name, color, and remaining time.
- **Component:** `src/components/cfd/CFDPricingCountdown.tsx` — fetches settings on mount, refreshes every 5 minutes, recomputes active rules every 60 seconds.

## Split & Transfer Behavior

- **Splits:** `pricingRuleApplied` JSONB is copied to split child order items. Price and itemTotal are also copied (already adjusted).
- **Transfers:** Items move via `orderId` update only — all fields including `pricingRuleApplied` are preserved intact.

---

## Related Docs
- **Feature doc:** `docs/features/discounts.md`
- **Feature doc:** `docs/features/pricing-programs.md`
- **Feature doc:** `docs/features/settings.md`
- **Feature doc:** `docs/features/entertainment.md` (separate pricing system — not Pricing Rules)
- **Architecture guide:** `docs/guides/CODING-STANDARDS.md`
- **Deprecated spec:** `docs/skills/SPEC-16-HAPPY-HOUR.md` (superseded by this feature)

---

*Last updated: 2026-03-14*
