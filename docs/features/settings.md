# Feature: Settings

> **Before editing this feature:** Read `_CROSS-REF-MATRIX.md` → find this feature → read every listed dependency doc.

## Summary
Settings manages all system-wide configuration for a location. Configuration is stored as a JSON blob in `Location.settings` and consumed by every API route via `getSettings()` or `withVenue()`. Settings changes take effect immediately — no restart required. The admin settings hub provides 70+ configuration pages covering venue info, payments, tips, receipts, security, orders, tabs, order types, hardware, integrations, staff, tax rules, monitoring, and feature-specific configuration.

## Status
`Active`

## Repos Involved
| Repo | Role | Coverage |
|------|------|----------|
| `gwi-pos` | API, admin settings UI, settings types | Full |
| `gwi-android-register` | Consumes settings via API sync | Partial |
| `gwi-cfd` | Consumes CFD settings (tipMode, tipOptions, signatureThreshold) | Partial |
| `gwi-backoffice` | Reads settings for report context | Partial |
| `gwi-mission-control` | Pushes settings to NUCs fleet-wide | Partial |

---

## UI Entry Points

| Interface | Path / Screen | Who Accesses |
|-----------|--------------|--------------|
| Admin | `/settings` | Managers |
| Admin | `/settings/venue` | Managers |
| Admin | `/settings/payments` | Managers |
| Admin | `/settings/tips` | Managers |
| Admin | `/settings/receipts` | Managers |
| Admin | `/settings/security` | Managers |
| Admin | `/settings/orders` | Managers |
| Admin | `/settings/tabs` | Managers |
| Admin | `/settings/order-types` | Managers |
| Admin | `/settings/staff` | Managers |
| Admin | `/settings/tax-rules` | Managers |
| Admin | `/settings/hardware` | Managers |
| Admin | `/settings/hardware/printers` | Managers |
| Admin | `/settings/hardware/kds-screens` | Managers |
| Admin | `/settings/hardware/terminals` | Managers |
| Admin | `/settings/hardware/routing` | Managers |
| Admin | `/settings/hardware/payment-readers` | Managers |
| Admin | `/settings/hardware/cfd` | Managers |
| Admin | `/settings/hardware/scales` | Managers |
| Admin | `/settings/hardware/prep-stations` | Managers |
| Admin | `/settings/hardware/health` | Managers |
| Admin | `/settings/hardware/cellular` | Managers |
| Admin | `/settings/hardware/limits` | Managers |
| Admin | `/settings/integrations/sms` | Managers |
| Admin | `/settings/integrations/slack` | Managers |
| Admin | `/settings/integrations/email` | Managers |
| Admin | `/settings/monitoring` | Managers |
| Admin | `/settings/happy-hour` | Managers |
| Admin | `/settings/floor-plan` | Managers |
| Admin | `/settings/entertainment` | Managers |
| Admin | `/settings/online-ordering` | Managers |
| Admin | `/settings/sections` | Managers (server-to-section assignment) |
| Admin | `/settings/reports/*` | Managers |

---

## Code Locations

### gwi-pos
| File / Directory | Purpose |
|-----------------|---------|
| `src/app/api/settings/route.ts` | GET/PUT location settings |
| `src/app/api/settings/tips/route.ts` | Tip-specific settings |
| `src/app/api/settings/online-ordering/route.ts` | Online ordering settings |
| `src/app/api/tax-rules/route.ts` | Tax rule CRUD |
| `src/app/api/tax-rules/[id]/route.ts` | Single tax rule |
| `src/app/api/order-types/route.ts` | Order type CRUD |
| `src/app/api/order-types/[id]/route.ts` | Single order type |
| `src/app/api/locations/route.ts` | Location management |
| `src/lib/settings.ts` | Settings types (PricingProgram, DualPricing, etc.) |
| `src/hooks/useOrderSettings.ts` | Client-side settings hook |
| `src/types/order-types.ts` | Order type definitions |
| `src/components/orders/OrderTypeSelector.tsx` | POS order type buttons & modal |
| `src/components/admin/settings/ToggleRow.tsx` | Toggle with disabled/disabledNote support |
| `src/components/admin/settings/ToggleSwitch.tsx` | Toggle switch with disabled state |
| `src/app/(admin)/settings/page.tsx` | Settings hub index |
| `src/app/(admin)/settings/layout.tsx` | Settings layout |
| `src/app/(admin)/settings/venue/page.tsx` | Venue info |
| `src/app/(admin)/settings/payments/page.tsx` | Payment settings |
| `src/app/(admin)/settings/tips/page.tsx` | Tip settings |
| `src/app/(admin)/settings/receipts/page.tsx` | Receipt settings |
| `src/app/(admin)/settings/security/page.tsx` | Security settings |
| `src/app/(admin)/settings/orders/page.tsx` | Order settings |
| `src/app/(admin)/settings/tabs/page.tsx` | Tab settings |
| `src/app/(admin)/settings/order-types/page.tsx` | Order type config |
| `src/app/(admin)/settings/staff/page.tsx` | Staff settings (business day, etc.) |
| `src/app/(admin)/settings/tax-rules/page.tsx` | Tax rule config |

---

## API Endpoints

| Method | Route | Auth | Description |
|--------|-------|------|-------------|
| `GET/PUT` | `/api/settings` | Manager | Location settings JSON blob |
| `GET/PUT` | `/api/settings/tips` | Manager | Tip-specific settings |
| `GET/PUT` | `/api/settings/online-ordering` | Manager | Online ordering config |
| `GET/POST` | `/api/tax-rules` | Manager | Tax rule CRUD |
| `PUT/DELETE` | `/api/tax-rules/[id]` | Manager | Single tax rule |
| `GET/POST` | `/api/order-types` | Manager | Order type CRUD |
| `PUT/DELETE` | `/api/order-types/[id]` | Manager | Single order type |
| `GET/POST` | `/api/locations` | Manager | Location management |

---

## Socket Events

### Emitted (POS → Clients)
| Event | Payload | Trigger |
|-------|---------|---------|
| `settings:updated` | `{ action, entityId }` | Any settings change via cache-invalidate |

### Received (Clients → POS)
| Event | Source | Purpose |
|-------|--------|---------|
| None | | |

---

## Data Model

```
Location {
  id, organizationId, name, slug
  address, phone, timezone
  settings (Json)   // ← ALL location config lives here
  isActive
}

TaxRule {
  id, locationId, name, rate (Decimal)
  appliesTo (all/category/item)
  categoryIds (Json), itemIds (Json)
  isInclusive (Boolean)
  isActive, sortOrder
}

OrderType {
  id, locationId, name, slug, description
  color, icon, sortOrder
  isActive, isSystem
  requiredFields (Json), customFields (Json)
  options (Json) — per-type behavior config
}
```

### Location.settings JSON Structure (key fields)
```
{
  // Pricing
  pricingProgram: { model, enabled, cashDiscountPercent, ... }
  dualPricing: { enabled, cashDiscountPercent, ... } // legacy
  priceRounding: { enabled, strategy }

  // Tips
  tipBankSettings: { enabled, noTipQuickButton, ... }
  tipBasis: 'subtotal' | 'total'
  autoGratuity: { enabled, threshold, percent }

  // Orders
  businessDayStartHour: number
  requireTableForDineIn: boolean
  autoSendToKitchen: boolean

  // Receipts
  globalReceiptSettings: { ... }

  // Security
  requireManagerApprovalForVoids: boolean
  voidThresholdCents: number

  // Tabs
  tabPreAuthEnabled: boolean
  tabPreAuthAmountCents: number
  tabIncrementalAuthThreshold: number

  // Hardware Limits (HardwareLimitsSettings)
  hardwareLimits: {
    // Device count limits (subscription-gated, MC syncs tier defaults)
    maxPOSTerminals: number        // default 20, 0 = unlimited
    maxHandhelds: number           // default 4
    maxCellularDevices: number     // default 2
    maxKDSScreens: number          // default 4
    maxPrinters: number            // default 6
    // Transaction limits
    maxSingleTransactionAmount: number  // default $9999.99
    maxCashPaymentAmount: number        // default $500
    maxOpenTabAmount: number            // default $1000
    maxDiscountDollarAmount: number     // 0 = unlimited
    // Handheld behavior limits
    handheldMaxPaymentAmount: number    // default $500
    handheldAllowVoids: boolean
    handheldAllowComps: boolean
    handheldAllowDiscounts: boolean
    handheldAllowRefunds: boolean
    handheldAllowCashPayments: boolean
    handheldAllowTabClose: boolean
    // Cellular behavior limits
    cellularMaxOrderAmount: number      // default $200
    cellularAllowVoids: boolean         // default false
    cellularAllowComps: boolean         // default false
    // Volume guards
    maxOrdersPerHour: number       // 0 = unlimited
    maxVoidsPerShift: number       // 0 = unlimited
    maxCompsPerShift: number       // 0 = unlimited
  }
}
```

---

## Business Logic

### Settings Read Flow
1. Every API route calls `withVenue()` which calls `getSettings()`
2. `getSettings()` reads `Location.settings` JSON from local PG
3. Settings merged with defaults — missing keys get default values
4. Settings returned as typed `LocationSettings` object

### Settings Update Flow
1. Manager changes a toggle on a settings page
2. PUT `/api/settings` with partial update
3. Server merges partial update into existing JSON blob
4. Server emits `settings:updated` via cache-invalidate route
5. All terminals receive socket event and refetch settings on next API call

### Dependent Settings
- Some settings depend on a parent setting being enabled
- Example: "Pre-auth amount" is disabled when "Tab pre-auth" is off
- UI shows disabled state with explanation via `ToggleRow` `disabledNote` prop

### Edge Cases & Business Rules
- Settings changes are **immediate** — no restart required
- `Location.settings` is a JSON blob — schema changes are additive (never remove keys)
- System order types (`isSystem: true`) cannot be deleted (dine_in, bar_tab, takeout)
- Tax rules support inclusive pricing (price already includes tax)
- Business day boundary configured in staff settings (e.g., 4:00 AM)

---

## Cross-Feature Dependencies

> See `_CROSS-REF-MATRIX.md` for full matrix.

### This feature MODIFIES these features:
| Feature | How / Why |
|---------|-----------|
| **Every feature** | Every API route reads settings — changing a setting affects all behavior |

### These features MODIFY this feature:
| Feature | How / Why |
|---------|-----------|
| Location model | Settings stored per-location in `Location.settings` |

### BEFORE CHANGING THIS FEATURE, VERIFY:
- [ ] **All features** — any settings change can ripple across the entire system
- [ ] **Defaults** — new settings MUST have defaults (backward-compatible)
- [ ] **Android** — Android caches settings; changes must be picked up on next sync
- [ ] **Offline** — settings are read from local PG, not cloud

---

## Permissions Required

| Action | Permission Key | Level |
|--------|---------------|-------|
| View settings | `SETTINGS_VIEW` | High |
| Edit settings | `SETTINGS_EDIT` | Critical |
| Manage tax rules | `TAX_RULES_MANAGE` | Critical |
| Manage order types | `ORDER_TYPES_MANAGE` | High |

---

## Known Constraints & Limits
- `Location.settings` is a JSON blob — no Prisma-level field validation
- New settings MUST always have defaults in `getSettings()` merge logic
- System order types (dine_in, bar_tab, takeout) cannot be deleted
- Tax-inclusive pricing changes affect ALL existing menu item prices
- 70+ settings pages — changes on one page may affect behavior visible on another
- Settings clarity pass (2026-03-03): removed broken options (Security business day duplicate, Tax Rules "Specific Items", Tips "Custom" basis)

---

## Android-Specific Notes
- Android fetches settings via sync API and caches locally
- Settings changes propagate to Android on next sync cycle
- Some settings affect Android behavior (order types, tab config, tip options)

---

## Related Docs
- **Domain doc:** `docs/domains/SETTINGS-DOMAIN.md`
- **Architecture guide:** `docs/guides/ARCHITECTURE-RULES.md`, `docs/guides/CODING-STANDARDS.md`
- **Skills:** Skill 09 (Features & Config), Skill 36 (Tax Calculations), Skill 240 (Tax-Inclusive Pricing), Skill 242 (Error Monitoring), Skill 243 (Admin Audit Viewer)
- **Changelog:** `docs/changelogs/SETTINGS-CHANGELOG.md`

---

*Last updated: 2026-03-10*
