# Feature: Pizza Builder

> **Before editing this feature:** Read `_CROSS-REF-MATRIX.md` → find this feature → read every listed dependency doc.

## Summary
Specialized pizza ordering UI with two builder modes (Quick and Visual), half-and-half topping support, fractional/flat/hybrid pricing, free topping tiers, specialty pizza templates, and comprehensive kitchen print formatting. Pizza items are standard MenuItems with `categoryType: 'pizza'` — underlying data uses PizzaConfig + pizza-specific models, not the standard modifier system.

## Status
`Active`

## Repos Involved
| Repo | Role | Coverage |
|------|------|----------|
| `gwi-pos` | API (14 route files), admin builder, POS builder modal, print formatting, bootstrap toppingCategory enrichment | Full |
| `gwi-android-register` | Native pizza builder — multi-sauce/cheese, partition modes, topping category tabs (Room v51) | Full |
| `gwi-pax-a6650` | Native pizza builder adapted for 5.5" screen — static canvas header, division pills (Room v50) | Full |
| `gwi-cfd` | N/A | None |
| `gwi-backoffice` | N/A | None |
| `gwi-mission-control` | N/A | None |

---

## Admin UI

### Admin Page (7 Tabs)

The pizza admin page at `/pizza` is the **single source of truth** for all pizza management:

| Tab | Purpose |
|-----|---------|
| **Items** | All pizza menu items — inline edit name/price, active/86 toggle, commission, tax, category management, specialty config |
| **Sizes** | Pizza sizes (Small/Medium/Large/XL) with base price + multipliers |
| **Crusts** | Crust options with upcharge pricing |
| **Sauces** | Sauce options with light/extra + inventory links |
| **Cheeses** | Cheese options (same as sauces) |
| **Toppings** | Topping library by category with inventory links |
| **Settings** | Printer routing, kitchen ticket design, section config, free topping rules |

The Items tab is the primary hub. Pizza items are created and managed here — the Menu page shows pizza items as read-only with a "Edit in Pizza Builder →" banner.

---

## UI Entry Points

| Interface | Path / Screen | Who Accesses |
|-----------|--------------|--------------|
| Admin | `/pizza` (7-tab builder: items, sizes, crusts, sauces, cheeses, toppings, settings) | Managers |
| Admin | `/settings/pizza` (config) | Managers |
| POS Web | PizzaBuilderModal (opens when tapping pizza item) | All staff |

---

## Code Locations

### gwi-pos
| File / Directory | Purpose |
|-----------------|---------|
| `src/app/api/pizza/route.ts` | GET all pizza data at once (sizes, crusts, sauces, cheeses, toppings, config) |
| `src/app/api/pizza/config/route.ts` | GET/PATCH pizza config |
| `src/app/api/pizza/sizes/route.ts` | GET/POST sizes |
| `src/app/api/pizza/sizes/[id]/route.ts` | PATCH/DELETE size |
| `src/app/api/pizza/crusts/route.ts` | GET/POST crusts |
| `src/app/api/pizza/sauces/route.ts` | GET/POST sauces |
| `src/app/api/pizza/cheeses/route.ts` | GET/POST cheeses |
| `src/app/api/pizza/toppings/route.ts` | GET/POST toppings |
| `src/app/api/pizza/specialties/route.ts` | GET/POST specialties |
| `src/components/pizza/PizzaBuilderModal.tsx` | Mode switcher (Quick vs Visual) |
| `src/components/pizza/PizzaQuickBuilder.tsx` | Single-screen fast ordering (26 KB) |
| `src/components/pizza/PizzaVisualBuilder.tsx` | 3-column layout with interactive SVG (47 KB) |
| `src/components/pizza/use-pizza-order.ts` | State management hook (13 KB) |
| `src/lib/pizza-helpers.ts` | Pricing validation and calculation |
| `src/lib/pizza-order-utils.ts` | Modifier building + section box logic |
| `src/types/print/pizza-print-settings.ts` | Kitchen print config (372 lines) |
| `src/app/(admin)/pizza/page.tsx` | Admin pizza menu builder |

---

## API Endpoints

| Method | Route | Auth | Description |
|--------|-------|------|-------------|
| `GET` | `/api/pizza` | Employee PIN | All pizza data at once |
| `GET/PATCH` | `/api/pizza/config` | Manager (PATCH) | Pizza configuration |
| `GET/POST` | `/api/pizza/sizes` | Manager (POST) | Size management |
| `PATCH/DELETE` | `/api/pizza/sizes/[id]` | Manager | Size update/delete |
| `GET/POST` | `/api/pizza/crusts` | Manager (POST) | Crust management |
| `GET/POST` | `/api/pizza/sauces` | Manager (POST) | Sauce management |
| `GET/POST` | `/api/pizza/cheeses` | Manager (POST) | Cheese management |
| `GET/POST` | `/api/pizza/toppings` | Manager (POST) | Topping management |
| `GET/POST` | `/api/pizza/specialties` | Manager (POST) | Specialty templates |

---

## Data Model

```
PizzaConfig {
  locationId          String            // unique — one config per location
  maxSections         Int               // 8 (up to octants)
  defaultSections     Int               // 2 (halves default)
  pricingMode         String            // fractional | flat | hybrid
  hybridPricing       Json?             // custom percentages per coverage
  freeToppingsEnabled Boolean
  freeToppingsCount   Int
  freeToppingsMode    String            // per_pizza | per_size
  builderMode         String            // quick | visual | both
  defaultBuilderMode  String
  allowModeSwitch     Boolean
  printerIds          Json?
  printSettings       Json?             // PizzaPrintSettings
}

PizzaSize {
  id                  String
  name                String
  inches              Int?
  slices              Int               // default 8
  basePrice           Decimal
  toppingMultiplier   Decimal           // multiplier for topping prices
  freeToppings        Int?              // per-size free topping count
  inventoryMultiplier Decimal?          // ingredient scaling (Skill 115)
}

PizzaTopping {
  id                  String
  name                String
  category            String            // meat | veggie | premium | cheese | seafood | standard
  price               Decimal           // base for whole pizza
  extraPrice          Decimal?          // 2x amount price
  color               String?           // hex for visual builder
  inventoryItemId     String?           // inventory deduction link
}

PizzaSpecialty {
  menuItemId          String            // unique — links to MenuItem
  defaultCrustId      String?
  defaultSauceId      String?
  defaultCheeseId     String?
  toppings            Json              // [{ toppingId, name, sections, amount }]
  allowSizeChange     Boolean
  allowCrustChange    Boolean
  allowToppingMods    Boolean
}

OrderItemPizza {
  orderItemId         String            // unique — links to OrderItem
  sizeId              String
  crustId             String
  sauceId             String?
  cheeseId            String?
  toppingsData        Json              // full topping configuration
  cookingInstructions String?
  cutStyle            String?
  sizePrice           Decimal           // snapshot
  toppingsPrice       Decimal           // snapshot
  totalPrice          Decimal           // snapshot
  freeToppingsUsed    Int?
}
```

---

## Business Logic

### Builder Modes
| Mode | Description | Tap Count |
|------|-------------|-----------|
| Quick | Single-screen, optimized for speed | 3-5 taps |
| Visual | 3-column with interactive SVG pizza canvas | 5-11 taps |

### Half-and-Half Logic
- Max sections: 24 (internal), configurable display: 1, 2, 4, 6, 8
- Left half: sections 12-23; Right half: sections 0-11
- User toggles "Half & Half" checkbox → "Left"/"Right" buttons appear
- Topping added to active half only; "Whole" adds to all sections
- Coverage calculated: `sections.length / totalSections`

### Pricing Models
| Mode | Formula | Example (half, $2 topping, 1.25x size) |
|------|---------|----------------------------------------|
| Fractional | `price × coverage × sizeMultiplier` | $2 × 0.5 × 1.25 = $1.25 |
| Flat | `price × sizeMultiplier` (any coverage = full price) | $2 × 1.25 = $2.50 |
| Hybrid | Custom % per coverage level | Configurable |

### Free Toppings
- `freeToppingsMode: 'per_pizza'` — same count for all sizes
- `freeToppingsMode: 'per_size'` — different count per PizzaSize
- Applied highest-price-first (most expensive toppings free first)
- `extraToppingPrice` — optional override for toppings after free ones

### Section Box System (for kitchen tickets)
Named coverage regions for print formatting:
- WHOLE (all 24 sections), LEFT HALF, RIGHT HALF (12 each)
- TOP LEFT, TOP RIGHT, BOTTOM LEFT, BOTTOM RIGHT (6 each)
- Sixths (1/6-1 through 1/6-6), Eighths (1/8-1 through 1/8-8)

### Edge Cases & Business Rules
- Pizza items have `categoryType: 'pizza'` — triggers PizzaBuilderModal instead of ModifierModal
- Specialty pizzas are templates with modification flags (allowSizeChange, allowToppingMods, etc.)
- `inventoryMultiplier` on PizzaSize scales ingredient usage (e.g., Large 1.3x)
- Kitchen print settings support red ribbon (two-color), multiple paper widths, 4 presets

---

## Cross-Feature Dependencies

### This feature MODIFIES these features:
| Feature | How / Why |
|---------|-----------|
| Orders | Pizza items with complex section/topping data |
| KDS | Pizza-specific kitchen ticket formatting (multi-sauce rendering) |
| Bootstrap / Sync | toppingCategory enrichment on modifiers for Android categorization |

### These features MODIFY this feature:
| Feature | How / Why |
|---------|-----------|
| Menu | Pizza items are menu items with `categoryType: 'pizza'` |
| Inventory | Topping/crust/sauce ingredient deductions (Skill 115) |
| Orders | Pizza added to order as OrderItem + OrderItemPizza |
| Stable ID Contract | lineItemId on all pizza items (dedup across server + client) |

### BEFORE CHANGING THIS FEATURE, VERIFY:
- [ ] **Menu** — `categoryType: 'pizza'` routing in order flow
- [ ] **KDS/Print** — kitchen ticket formatting with pizza print settings (multi-sauce normalization)
- [ ] **Inventory** — ingredient multipliers and deduction calculations
- [ ] **Orders** — OrderItemPizza snapshot data integrity
- [ ] **Bootstrap** — toppingCategory enrichment for Android modifier entities
- [ ] **Stable ID** — lineItemId contract on all pizza item requests

---

## Permissions Required

| Action | Permission Key | Level |
|--------|---------------|-------|
| View pizza builder | Employee PIN | Standard |
| Configure pizza settings | Manager role | High |

---

## Known Constraints & Limits
- One PizzaConfig per location (unique on locationId)
- Max sections: 8 for UI, 24 internally for precision
- `printerIds` JSON array — no FK constraint enforcement
- Specialty pizza `menuItemId` is unique (one template per menu item)

---

## Android-Specific Notes (2026-03-17)

### Native Pizza Builder — Register + PAX
Both Android register and PAX A6650 now have full native pizza builders.

**Multi-Sauce/Cheese with Partition Modes:**
- Partition modes: whole, halves, thirds (configurable per condiment)
- Multiple sauces and cheeses supported simultaneously
- New `pizzaConfig` format: `sauces[]` and `cheeses[]` arrays alongside legacy single `sauceId`/`cheeseId` for backward compatibility

**Topping Category Tabs:**
- Categories: meat, veggie, premium, seafood, cheese, specialty
- `toppingCategory` field enriched on ModifierEntity via bootstrap (sourced from PizzaTopping records)
- Tab-based UI filters toppings by category for faster selection

**Shared Code:**
- `CondimentHelpers.kt` — shared helper for condiment selection logic (used by both Register and PAX)
- `buildPizzaConfig()` — builds both legacy single-sauce and new multi-sauce format for server compatibility

**PAX-Specific Adaptations:**
- Pizza canvas + division pills pinned as static header (doesn't scroll with topping list)
- Optimized for 5.5" screen real estate

**Room Migrations:**
- Register: Room v51 — `toppingCategory` column on modifier entities
- PAX: Room v50 — `toppingCategory` column on modifier entities

**Bootstrap Integration:**
- NUC bootstrap (`/api/sync/bootstrap`) enriches modifier data with `toppingCategory` from PizzaTopping records
- Enables Android to categorize toppings without a separate PizzaTopping API call

**Kitchen Ticket Support:**
- Multi-sauce pizza items rendered correctly on kitchen tickets
- `microSections` field normalized for consistent formatting across single-sauce and multi-sauce orders

---

## Related Docs
- **Domain doc:** `docs/domains/PIZZA-BUILDER-DOMAIN.md`
- **Design spec:** `docs/features/PIZZA_BUILDER_DESIGN.md` (1136 lines)
- **Cross-ref:** `docs/features/_CROSS-REF-MATRIX.md` → Pizza Builder row
- **Skills:** Skill 103 (Pizza Printing), Skill 109 (Visual Builder), Skill 115 (Inventory)

---

*Last updated: 2026-03-17 (Android native builder on Register + PAX, multi-sauce/cheese, toppingCategory bootstrap)*
