# Feature: Combo Meals

> **Before editing this feature:** Read `_CROSS-REF-MATRIX.md` → find this feature → read every listed dependency doc.

## Summary
Bundled menu items at a set price with component choices, modifier overrides, and savings display. Combo price is composite (NOT sum of parts). Components can have per-modifier price overrides. Uses stepped modal flow in POS. Combos are menu items with `itemType: 'combo'`.

## Status
`Active` (core CRUD + ordering complete; analytics endpoints planned)

## Repos Involved
| Repo | Role | Coverage |
|------|------|----------|
| `gwi-pos` | API, admin UI, POS ordering, inventory integration | Full |
| `gwi-android-register` | Combo builder (planned) | Planned |
| `gwi-cfd` | N/A | None |
| `gwi-backoffice` | N/A | None |
| `gwi-mission-control` | N/A | None |

---

## UI Entry Points

| Interface | Path / Screen | Who Accesses |
|-----------|--------------|--------------|
| Admin | `/combos` | Managers |
| POS Web | ComboStepFlow modal (opens when tapping combo item) | All staff |

---

## Code Locations

### gwi-pos
| File / Directory | Purpose |
|-----------------|---------|
| `src/app/api/combos/route.ts` | GET list, POST create |
| `src/app/api/combos/[id]/route.ts` | GET detail, PUT update, DELETE soft-delete |
| `src/app/(admin)/combos/page.tsx` | Admin combo management (745 lines) |
| `src/components/modifiers/ComboStepFlow.tsx` | POS multi-step combo builder (384 lines) |
| `src/hooks/useComboBuilder.ts` | Combo state management hook |
| `src/app/(pos)/orders/hooks/useOrderHandlers.ts` | Combo detection + add-to-order (lines 890, 1128-1190) |
| `src/app/api/orders/[id]/items/route.ts` | Combo component availability validation (lines 329-389) |
| `src/lib/inventory/void-waste.ts` | Combo expansion on void (lines 368-516) |

---

## API Endpoints

| Method | Route | Auth | Description |
|--------|-------|------|-------------|
| `GET` | `/api/combos` | Employee PIN | List all combos with templates + components |
| `POST` | `/api/combos` | Manager | Create combo (MenuItem + ComboTemplate + Components) |
| `GET` | `/api/combos/[id]` | Employee PIN | Get combo template for menu item |
| `PUT` | `/api/combos/[id]` | Manager | Update combo metadata + rebuild components |
| `DELETE` | `/api/combos/[id]` | Manager | Soft-delete combo + cascade |

---

## Socket Events

### Emitted (POS → Clients)
| Event | Payload | Trigger |
|-------|---------|---------|
| `menu:updated` | — | Combo created/updated/deleted |

---

## Data Model

```
ComboTemplate {
  id              String
  locationId      String
  menuItemId      String            // unique — links to MenuItem (itemType="combo")
  basePrice       Decimal           // combo price
  comparePrice    Decimal?          // a la carte total for savings display
  components      ComboComponent[]
}

ComboComponent {
  id                      String
  comboTemplateId         String
  slotName                String    // "entree", "side", "drink"
  displayName             String    // "Choose Your Side"
  sortOrder               Int
  isRequired              Boolean
  minSelections           Int
  maxSelections           Int
  menuItemId              String?   // single item for this slot
  itemPriceOverride       Decimal?  // override item's base price
  modifierPriceOverrides  Json?     // { "modifierId": priceInCents }
  options                 ComboComponentOption[]  // legacy
}

ComboComponentOption {
  id                      String
  comboComponentId        String
  menuItemId              String
  upcharge                Decimal   // default 0
  sortOrder               Int
  isAvailable             Boolean
}
```

---

## Business Logic

### Combo Ordering Flow
1. Server taps combo item on menu → `itemType === 'combo'` detected
2. Fetch combo template: `GET /api/combos/[id]`
3. ComboStepFlow modal opens with horizontal stepper
4. For each component: show modifier groups from component's menuItem
5. User selects required modifiers (price overrides applied)
6. Upcharges calculated: `total = basePrice + sum(modifierPriceOverrides[modifierId])`
7. On confirm: flatten selections into modifier array for order display
8. Create OrderItem with `basePrice` + modifiers showing component selections

### Pricing Formula
```
ComboTotal = basePrice + sum(selectedModifierUpcharges)

Where:
  upcharge = modifierPriceOverrides[modifierId] ?? 0
  savings = comparePrice - ComboTotal (displayed to user)
```

### Inventory on Void
When voiding a combo, the system expands to components:
1. Find combo template for the menu item
2. For each component with a `menuItemId`: process recipe deductions as waste
3. Prevents bundling logic from hiding waste tracking

### Tax Treatment
- Combos treated as `food` category type for tax purposes
- Applied alongside 'food' and 'pizza' in `isItemTaxInclusive()` check

### Edge Cases & Business Rules
- Combo price is composite — NOT sum of parts
- Component substitutions track price delta via `modifierPriceOverrides`
- Cannot order combo if any required component's menuItem is 86'd or inactive
- All required components must have selections before confirming
- Per-component `min/maxSelections` enforced per modifier group
- Dual pricing support (cash/card) on base price + overrides
- Kitchen tickets group combo items under `*** COMBO ***` banner

---

## Cross-Feature Dependencies

### This feature MODIFIES these features:
| Feature | How / Why |
|---------|-----------|
| Orders | Combo adds multiple items as modifier tree |
| Payments | Combo pricing affects payment total |
| Inventory | Void expands combo to components for waste tracking |

### These features MODIFY this feature:
| Feature | How / Why |
|---------|-----------|
| Menu | Combo components are menu items |
| Modifiers | Component modifier groups used for selections |

### BEFORE CHANGING THIS FEATURE, VERIFY:
- [ ] **Menu** — combo components reference active menu items
- [ ] **Inventory** — void/waste expansion for combo components
- [ ] **Orders** — combo item validation (86'd check)
- [ ] **Tax** — combo category type for tax calculation

---

## Permissions Required

| Action | Permission Key | Level |
|--------|---------------|-------|
| View combos | Employee PIN | Standard |
| Create/Edit/Delete combos | Manager role | High |

---

## Known Constraints & Limits
- `menuItemId` on ComboTemplate is unique (one template per item)
- Legacy `ComboComponentOption` still supported alongside new modifier-based flow
- Analytics endpoints not yet implemented (GET /api/combos/analytics)
- Time-based availability not yet implemented
- Android native integration not yet built

---

## Android-Specific Notes
- Combo builder planned but not yet implemented for Android native
- Will use stepped flow similar to web POS

---

## Related Docs
- **Spec:** `docs/skills/SPEC-59-COMBO-MEALS.md`
- **Cross-ref:** `docs/features/_CROSS-REF-MATRIX.md` → Combo Meals row
- **Menu domain:** `docs/domains/MENU-DOMAIN.md`

---

*Last updated: 2026-03-03*
