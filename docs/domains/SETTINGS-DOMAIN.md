# Settings Domain

**Domain ID:** 10
**Status:** Active Development
**Created:** February 9, 2026

## Overview

The Settings domain manages system-wide configuration including location settings, tax rules, order types, feature flags, and admin preferences. It handles:
- Location settings (tax, dual pricing, price rounding, tip shares)
- Tax rule configuration (rates, inclusive/exclusive, category-based)
- Configurable order types (dine-in, bar tab, takeout, delivery, custom)
- Feature flags and system configuration
- Admin audit viewer

## Domain Trigger

```
PM Mode: Settings
```

## Layers

| Layer | Scope | Key Files |
|-------|-------|-----------|
| Location Settings | Core settings | `src/app/api/settings/` |
| Tax Rules | Tax configuration | `src/app/api/tax-rules/` |
| Order Types | Configurable order types | `src/app/api/order-types/` |
| UI | Settings pages | `src/app/(admin)/settings/` |

## Key Files

| File | Purpose |
|------|---------|
| `src/app/api/settings/route.ts` | GET/PUT location settings (tax, pricing, tips) |
| `src/lib/settings.ts` | Settings type definitions (PriceRounding, DualPricing) |
| `src/hooks/useOrderSettings.ts` | Client-side settings hook |
| `src/types/order-types.ts` | Order type definitions |
| `src/components/orders/OrderTypeSelector.tsx` | POS order type buttons & modal |
| `src/app/(admin)/settings/order-types/page.tsx` | Order types admin page |

## API Routes

| Route | Method | Purpose |
|-------|--------|---------|
| `/api/settings` | GET/PUT | Location settings |
| `/api/tax-rules` | GET/POST | Tax rule CRUD |
| `/api/tax-rules/[id]` | PUT/DELETE | Single tax rule |
| `/api/order-types` | GET/POST | Order type CRUD |
| `/api/order-types/[id]` | PUT/DELETE | Single order type |
| `/api/locations` | GET/POST | Location management |

## Related Skills

| Skill | Name | Status |
|-------|------|--------|
| 09 | Features & Config | DONE |
| 36 | Tax Calculations | DONE |
| 240 | Tax-Inclusive Pricing | DONE |
| 242 | Error Monitoring | DONE |
| 243 | Admin Audit Viewer | API Complete |

## UI Components

| Component | File | Props Added (2026-03-03) |
|-----------|------|--------------------------|
| `ToggleRow` | `src/components/admin/settings/ToggleRow.tsx` | `disabled: boolean`, `disabledNote: string?` — greyed-out toggle with explanation when a dependent setting is off |
| `ToggleSwitch` | `src/components/admin/settings/ToggleSwitch.tsx` | `disabled: boolean` — prevents interaction and shows disabled visual state |

## Changelog

### 2026-03-03 — Settings Clarity Pass (17 pages)

All 17 settings pages received UX clarity improvements:
- Plain-English descriptions added to every toggle and option
- Jargon defined on first use (e.g., "dual pricing", "pre-auth")
- Dependent toggles show disabled state with explanation when prerequisite is off
- Broken/placeholder options removed (see below)

**Pages updated:** Venue, Payments, Tips, Receipts, Security, Orders, Tabs, Order Types, Hardware (main + Printers + KDS Screens + Terminals + Routing), Integrations/SMS, Staff

**Specific removals:**
- **Security page**: Business Day section removed (was a duplicate of the Staff page). Replaced with a redirect card pointing to `/settings/staff`.
- **Tax Rules** (`/tax-rules`): "Specific Items" `appliesTo` option removed — the item picker UI was never built, so the option was non-functional.
- **Tips** (`/settings/tips`): "Custom" tip basis option removed — it was a placeholder with no backend logic.

**New setting:**
- `noTipQuickButton: boolean` added to `TipBankSettings` in `src/lib/settings.ts` (default `false`). When enabled, hides the quick-tip buttons on the tip entry screen, forcing manual entry.

## Integration Points

- **All Domains**: Location settings consumed by every API route
- **Payments Domain**: Tax rates, dual pricing, price rounding settings
- **Orders Domain**: Order type configuration
- **Reports Domain**: Settings context for report generation
