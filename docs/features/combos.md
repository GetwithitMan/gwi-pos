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

## Customer-Chooses-Items (Pick N of M)

> Added 2026-04-16. Plan: `~/.claude/plans/shimmering-singing-lake.md`.

Combos now support customer-chosen items: classic "burger + pick one side" AND new "bucket of 6, pick any combo of 6 from 12" with optional per-option upcharges. One combo architecture serves both — the runtime decides which flow to render based on `minSelections` / `maxSelections` on each `ComboComponent` and whether `ComboTemplate.allowUpcharges` is set.

### Config Matrix

| Combo type | Config | Example |
|---|---|---|
| Classic fixed | `min=1, max=1`, 1 default item, 0 options | "Entrée: NY Strip" |
| Classic choose-one | `min=1, max=1`, N options, `allowUpcharges=false` | "Side: fries / slaw / salad" |
| Pick-N flat | `min=N, max=N`, M options, `allowUpcharges=false` | "Bucket of 6 — $25" |
| Pick-N hybrid | `min=N, max=N`, M options, `allowUpcharges=true` | "Bucket: domestics $0 / imports +$1" |

### `ComboTemplate.allowUpcharges`

Per-combo opt-in knob. Default `false`. When `false`, the server forces `upchargeApplied = 0` on every `OrderItemComboSelection` row regardless of what the client sends. This is a server-side guard — the validator compares `option.upcharge` to the client value and rejects mismatches when `allowUpcharges=true`, and silently zeroes them when `allowUpcharges=false`.

### `OrderItemComboSelection` — Snapshot-First Selection Rows

Records what the customer *actually picked* at order time. Independent child of `OrderItem`. One row per pick.

```
OrderItemComboSelection {
  id                      String       // client-generated UUID (STABLE-ID-CONTRACT)
  locationId              String
  orderItemId             String       // HARD FK → OrderItem (CASCADE)
  comboComponentId        String?      // SOFT FK → ComboComponent (SET NULL)
  comboComponentOptionId  String?      // SOFT FK → ComboComponentOption (SET NULL)
  menuItemId              String       // snapshot: the item that was picked
  optionName              String       // snapshot: at-pick-time name
  upchargeApplied         Decimal(10,2) // snapshot; 0 when allowUpcharges=false
  sortIndex               Int          // deterministic receipt/print ordering
  createdAt / updatedAt / deletedAt / syncedAt / lastMutatedBy
}
```

Key properties:
- **Hard FK only to `OrderItem`** (cascade on delete). Template references (`comboComponentId`, `comboComponentOptionId`) are nullable soft FKs with `SET NULL`. Admin template edits (delete-or-rename options) never break history because selections never depended on template rows staying alive.
- **No `quantity` column.** "4 Bud" is 4 rows with distinct `sortIndex`.
- **`sortIndex` drives deterministic receipt, kitchen-ticket, and UI rendering.** Preserved across edit-mode rehydration when rows existed in the starting state.

### The Six Invariants

1. **One row per pick.** No `quantity` column on `OrderItemComboSelection` — "4 Bud" = 4 rows with distinct `sortIndex`. Adding a quantity field would double-multiply inventory and receipts.
2. **Line quantity is always 1 for configurable combos.** Two buckets = two OrderItem lines, each with its own `comboSelections[]`. Never set `quantity > 1` on a combo OrderItem that has `comboSelections`. Server rejects `quantity > 1` with 400 when `comboSelections` is non-empty.
3. **Edit semantics = replace-all.** Reopening the builder on an open combo item atomically soft-deletes all prior `OrderItemComboSelection` rows (`deletedAt = NOW()`), inserts the new ones, server recomputes `OrderItem.price` + `itemTotal`, and emits the standard `orders:list-changed` / `order:totals-updated` / `order:summary-updated` events.
4. **Upcharge forcing.** When `template.allowUpcharges === false`, the server forces `upchargeApplied = 0` regardless of any client payload. Server-side guard, not just a UI hint.
5. **Soft-delete authority.** `OrderItem.deletedAt` is authoritative — voided / soft-deleted parent items implicitly ignore their `comboSelections` downstream (inventory deduction, receipts, KDS). No separate child cleanup required.
6. **Missing-recipe hardening.** If a `selection.menuItemId` has no recipe or is soft-deleted at deduction time, log a structured warning (with `orderId`, `orderItemId`, `selectionId`, `menuItemId`) and skip that selection — never crash deduction.

### End-to-End Flow

1. **Admin defines template** at `/combos`: base price, compare price, `allowUpcharges`, N components each with `min/maxSelections` and a list of options (`menuItemId` + optional `upcharge` + `isAvailable`).
2. **Android receives templates** in the bootstrap payload (`comboTemplates[]`) and caches them in Room (`ComboTemplateEntity`, `ComboComponentEntity`, `ComboComponentOptionEntity`). Cache refresh is full-replace on every bootstrap until Android moves to delta sync.
3. **Customer picks** in `ComboBuilderSheet.kt`: state is `Map<componentId, Map<optionId, count>>` (so 4 Bud + 2 Modelo is representable). `maxSelections==1` renders as radio tiles; `max>1` renders as countable tile grid with +/- long-press.
4. **Confirm** builds a flat `List<ComboSelectionRequest>` — one entry per pick, each with a stable client-generated UUID and a deterministic `sortIndex = componentSortOrder × 1000 + withinComponentIndex`.
5. **Android posts** a single `OrderItemRequest` with `comboSelections[]` on ADD (`POST /api/orders/[id]/items`) or EDIT (`PUT /api/orders/[id]/items/[itemId]`).
6. **Server validates** via `validateAndBuildComboSelections` (shared helper): template exists + belongs to menuItem, each component/option pair is valid and available, per-component count satisfies `min..max`, `quantity === 1`, `upchargeApplied` matches server value iff `allowUpcharges=true` else forced to `0`. Creates `OrderItem` + its `OrderItemComboSelection[]` rows in one transaction.
7. **Server computes** final price: `ComboTemplate.basePrice + sum(upchargeApplied)`. Never trusts client-computed totals.
8. **Inventory deducts per selection on pay.** `src/lib/inventory/order-deduction.ts` reads `comboSelections[]` from the hydrated OrderItem and deducts each selection's recipe; falls back to the classic `ComboComponent.menuItemId` default only when selections are empty.
9. **Receipt + kitchen ticket** render selected options as indented child lines under the combo title, reusing the existing modifier-line formatter in `print-factory.ts`. `sortIndex` drives ordering.

### Key Files

| Concern | File |
|---|---|
| Schema | `prisma/schema.prisma` (`ComboTemplate.allowUpcharges`, `OrderItemComboSelection`) |
| Migration | `scripts/migrations/129-combo-pick-n-of-m.js` |
| Types | `src/types/index.ts` (`ComboSelection`, `allowUpcharges` on `ComboTemplate`) |
| Shared validator + include + mapper | `src/lib/domain/order-items/combo-selections.ts` (`validateAndBuildComboSelections`, `ORDER_ITEM_FULL_INCLUDE`, `mapOrderItemForWire`) |
| Combo API | `src/app/api/combos/route.ts`, `src/app/api/combos/[id]/route.ts` |
| Admin UI | `src/app/(admin)/combos/page.tsx` |
| Bootstrap server | `src/app/api/sync/bootstrap/route.ts` (`comboTemplates[]` payload) |
| Add-items route | `src/app/api/orders/[id]/items/route.ts` |
| Update-item route (replace-all, idempotency) | `src/app/api/orders/[id]/items/[itemId]/route.ts` |
| Inventory deduction | `src/lib/inventory/order-deduction.ts` |
| Print (receipts + kitchen) | `src/lib/print-factory.ts` |
| Seed | `prisma/seed.ts` — "Bucket of Domestics" |
| Android picker | `gwi-android-register/.../ui/pos/components/ComboBuilderSheet.kt` |
| Android DTO | `gwi-android-register/.../data/remote/dto/OrderDtos.kt` (`ComboSelectionRequest`) |
| Android Room cache | `gwi-android-register/.../data/local/entity/ComboTemplateEntity.kt` + siblings |
| Android bootstrap | `gwi-android-register/.../sync/BootstrapWorker.kt` |

### Known Limits / Out of Scope (v1)

- Per-minute / happy-hour pricing of combo options. (Future `priceApplied` snapshot field can land without schema break.)
- Mix-and-match across parent categories (schema supports it; no dedicated UX for v1).
- CFD live mid-pick state (snapshot model already gives the data if it's wanted later).
- **Android delta sync for combo templates** — server PUT already does stable-id updates; Android full-replace is a v1 simplification. Follow-up ticket.

---

*Last updated: 2026-04-16 — added Pick N of M section*
