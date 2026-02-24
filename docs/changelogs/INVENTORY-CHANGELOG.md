# INVENTORY Domain Changelog

## 2026-02-24 — Combo Inventory & Void Expansion (`743e618`)

### Combo Inventory Expansion
- Deduction engine walks `ComboTemplate` -> `components` -> `MenuItems` for full ingredient deduction
- `isCombo` guard prevents double-counting when combo and its components share ingredients

### Void/Waste Combo Expansion
- Void and waste paths expanded to reverse combo component deductions

### pourMultiplier on Voids
- `pourMultiplier` applied during void deduction to reverse the correct quantity

### Spirit Substitution
- `modifier.linkedBottleProduct` used to identify spirit substitutions for accurate inventory reversal

---

## 2026-02-20 — Sprint Sessions 8-14: Pour Multipliers, Prep Explosion, UOM Warnings, Seed Data

### T-006 — Pour Size Multiplier in Deduction Engine
- `pourSize`/`pourMultiplier` on `OrderItem` is now applied during ingredient deduction for both the `MenuItemRecipe` path and the liquor `RecipeIngredient` path in `inventory-calculations.ts`.
- `npx prisma db push` required to apply schema field additions.

### T-002 — Prep Item Explosion in Modifier Deductions (Path B)
- `explodePrepItem()` is now called when `modifier.ingredient` resolves to a `PrepItem` in the Path B modifier deduction flow.
- `ORDER_INVENTORY_INCLUDE` updated to include the prep item sub-ingredients needed for explosion.

### T-004 — Unit Mismatch Warnings on Ingredient Linking
- `POST /api/inventory/link` returns a `warning` field when the linked ingredient and menu item UOM belong to different measurement categories (e.g., volume vs. weight).
- `useModifierEditor` displays an 8-second `toast.warning` on detection.
- `console.warn` with full context emitted when a unit conversion resolves to `null`.

### T-001 — Ranch Ingredient Seed Data
- `inv-ranch-dressing-001` upserted in seed/migration script.
- Linked to ingredient variants: `ing-ranch`, `ing-ranch-dressing`, `ing-ranch-side`, `ing-ranch-drizzle`.

---

## Sessions

_No sessions logged yet. This changelog was created during the 2026-02-09 codebase audit._
