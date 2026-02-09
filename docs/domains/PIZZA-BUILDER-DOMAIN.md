# Pizza Builder Domain

**Domain ID:** 18
**Status:** Active Development
**Created:** February 9, 2026

## Overview

The Pizza Builder domain manages pizza-specific product configuration, ordering, and kitchen ticket printing. It handles:
- Pizza configuration (sizes, crusts, sauces, cheeses, toppings, specialties)
- Visual pizza builder with sectional topping placement (whole, half, quarter, sixth)
- Pizza-specific pricing (size-based, topping tiers, specialty overrides)
- Specialized kitchen ticket printing with sectional layout and red ribbon support
- Pizza print settings with live preview

## Domain Trigger

```
PM Mode: Pizza Builder
```

## Layers

| Layer | Scope | Key Files |
|-------|-------|-----------|
| Config | Pizza sizes, crusts, sauces, cheeses, toppings | `src/app/api/pizza/` |
| Builder UI | Visual pizza builder for ordering | `src/components/pizza/` |
| Pricing | Size-based pricing and topping tier calculations | `src/lib/pizza-helpers.ts` |
| Print | Pizza-specific kitchen ticket formatting | `src/types/pizza-print-settings.ts` |
| Admin | Pizza settings admin page | `src/app/(admin)/pizza/page.tsx` |

## Key Files

| File | Purpose |
|------|---------|
| `src/app/(admin)/pizza/page.tsx` | Pizza settings admin page |
| `src/components/pizza/PizzaBuilder.tsx` | Visual pizza builder |
| `src/lib/pizza-helpers.ts` | Pizza pricing and calculation helpers |
| `src/types/pizza-print-settings.ts` | Pizza print settings types |
| `src/components/hardware/PizzaPrintSettingsEditor.tsx` | Pizza print settings with live preview |

## API Routes

| Route | Method | Purpose |
|-------|--------|---------|
| `/api/pizza/config` | GET/PUT | Pizza configuration (all settings) |
| `/api/pizza/sizes` | GET/POST | Pizza size management |
| `/api/pizza/crusts` | GET/POST | Crust options |
| `/api/pizza/sauces` | GET/POST | Sauce options |
| `/api/pizza/cheeses` | GET/POST | Cheese options |
| `/api/pizza/toppings` | GET/POST | Topping management |
| `/api/pizza/specialties` | GET/POST | Specialty pizza templates |

## Related Skills

| Skill | Name | Status |
|-------|------|--------|
| 109 | Visual Pizza Builder | DONE |
| 103 | Print Routing (pizza station) | DONE |

## Integration Points

- **Menu Domain**: Pizza items are menu items with category type "food" + pizza config
- **Orders Domain**: Pizza orders flow through standard order pipeline with `OrderItemPizza` data
- **Hardware Domain**: Pizza print settings and station routing
- **KDS Domain**: Pizza tickets with sectional topping display
