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

## Integration Points

- **All Domains**: Location settings consumed by every API route
- **Payments Domain**: Tax rates, dual pricing, price rounding settings
- **Orders Domain**: Order type configuration
- **Reports Domain**: Settings context for report generation
