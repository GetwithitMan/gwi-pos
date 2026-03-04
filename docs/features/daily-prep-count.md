# Feature: Daily Prep Count

> **Before editing this feature:** Read `_CROSS-REF-MATRIX.md` → find Daily Prep Count → read every listed dependency doc.

## Summary

Daily Prep Count is a kitchen-operations workflow that lets prep staff record how many units of each prepped item they have on hand at the start of a day (or shift). The count session flows through three states: `draft` (staff enter counts) → `submitted` (sent to manager for review) → `approved` (manager confirms; `Ingredient.currentPrepStock` and `Ingredient.lastCountedAt` are updated atomically and a `DailyPrepCountTransaction` audit record is written for each item). Sessions can also be `rejected` with a reason, sending the count back for correction.

Items tracked are `Ingredient` records with `preparationType IS NOT NULL` (prep-style ingredients, e.g. "Personal Pizza Crust (8 inch)"). Each prep-style ingredient can have one or more named `PrepTrayConfig` records (e.g., "Large Dough Tray = 6 balls", "Small Dough Tray = 12 balls", "Loose") so that staff count trays rather than individual units, and the system multiplies tray count by capacity to compute `totalCounted`. The `PrepStation` model (distinct from prep counting) handles KDS routing for kitchen stations; it does not drive daily count logic.

## Status
`Active`

## Repos Involved
| Repo | Role | Coverage |
|------|------|----------|
| `gwi-pos` | API, admin UI, data model, approval workflow, inventory update | Full |
| `gwi-android-register` | N/A (no Android integration for prep counting at this time) | None |
| `gwi-cfd` | N/A | None |

---

## UI Entry Points

| Interface | Path / Screen | Who Accesses |
|-----------|--------------|--------------|
| Admin — active count session | `/inventory/daily-prep-counts` → `src/app/(admin)/inventory/daily-prep-counts/page.tsx` | Prep staff, kitchen managers |
| Admin — alias (settings tree) | `/settings/inventory/daily-prep-counts` → re-exports from the above page | Managers |
| Admin — daily counts config | `/settings/daily-counts` → `src/app/(admin)/settings/daily-counts/page.tsx` | Managers (tray config, mark items as daily count items) |

---

## Code Locations

### gwi-pos
| File / Directory | Purpose |
|-----------------|---------|
| `src/app/api/inventory/daily-counts/route.ts` | GET (list sessions) / POST (create session) |
| `src/app/api/inventory/daily-counts/[id]/route.ts` | GET (single session with items) / PUT (update draft, upsert count items) / DELETE (soft-delete draft/submitted) |
| `src/app/api/inventory/daily-counts/[id]/submit/route.ts` | POST — transitions `draft` → `submitted` |
| `src/app/api/inventory/daily-counts/[id]/approve/route.ts` | POST — transitions `submitted` → `approved` or `rejected`; runs stock update transactions |
| `src/app/api/inventory/prep/route.ts` | GET / POST PrepItem (legacy prep-item model, separate from Ingredient-based daily counts) |
| `src/app/api/inventory/prep/[id]/route.ts` | GET / PUT / DELETE single PrepItem |
| `src/app/api/inventory/prep-items/route.ts` | GET — list Ingredients with `preparationType IS NOT NULL` (prep-style) for daily count use |
| `src/app/api/inventory/prep-tray-configs/route.ts` | GET / POST / PUT PrepTrayConfig — tray sizes per prep ingredient; PUT also toggles `isDailyCountItem` on Ingredient |
| `src/app/api/inventory/prep-tray-configs/[id]/route.ts` | PUT / DELETE single tray config |
| `src/app/api/prep-stations/route.ts` | GET / POST PrepStation (KDS routing stations — not daily count items) |
| `src/app/api/prep-stations/[id]/route.ts` | PUT / DELETE single PrepStation |
| `src/app/(admin)/inventory/daily-prep-counts/page.tsx` | Main daily count UI (tray-based count entry, submit flow) |
| `src/app/(admin)/settings/daily-counts/page.tsx` | Admin config — mark ingredients as daily count items, manage tray configs |

---

## API Endpoints

| Method | Route | Auth | Description |
|--------|-------|------|-------------|
| `GET` | `/api/inventory/daily-counts` | Employee PIN | List daily count sessions; filter by `status`, `startDate`, `endDate`, `limit` |
| `POST` | `/api/inventory/daily-counts` | Employee PIN | Create new draft session; enforces one non-rejected session per calendar day |
| `GET` | `/api/inventory/daily-counts/[id]` | Employee PIN | Get single session with all `countItems` (includes ingredient tray configs) and `transactions` |
| `PUT` | `/api/inventory/daily-counts/[id]` | Employee PIN | Update `notes`; upsert `countItems` with tray breakdown and calculated totals (draft only) |
| `DELETE` | `/api/inventory/daily-counts/[id]` | Manager | Soft-delete session (draft or submitted only; approved sessions cannot be deleted) |
| `POST` | `/api/inventory/daily-counts/[id]/submit` | Employee PIN | Submit draft for approval; requires at least one count item |
| `POST` | `/api/inventory/daily-counts/[id]/approve` | Manager | Approve (updates stock) or reject (with reason) a submitted session |
| `GET` | `/api/inventory/prep-items` | Employee PIN | List prep-style Ingredients (`preparationType IS NOT NULL`) |
| `GET` | `/api/inventory/prep-tray-configs` | Employee PIN | List tray configs (all or by `prepItemId`); optional `dailyCountItemsOnly=true` filter |
| `POST` | `/api/inventory/prep-tray-configs` | Manager | Create new tray config for an ingredient |
| `PUT` | `/api/inventory/prep-tray-configs` | Manager | Toggle `isDailyCountItem` on an Ingredient |
| `PUT` | `/api/inventory/prep-tray-configs/[id]` | Manager | Update single tray config |
| `DELETE` | `/api/inventory/prep-tray-configs/[id]` | Manager | Soft-delete single tray config |
| `GET` | `/api/inventory/prep` | Manager | List PrepItems (legacy kitchen prep-recipe model) |
| `POST` | `/api/inventory/prep` | Manager | Create PrepItem with ingredient list; auto-calculates `costPerUnit` |
| `GET` | `/api/inventory/prep/[id]` | Manager | Get single PrepItem with ingredients and recipe usages |
| `PUT` | `/api/inventory/prep/[id]` | Manager | Update PrepItem; replaces ingredient list and recalculates cost |
| `DELETE` | `/api/inventory/prep/[id]` | Manager | Soft-delete PrepItem (blocked if used in menu item recipes) |
| `GET` | `/api/prep-stations` | Employee PIN | List PrepStations (KDS routing stations) |
| `POST` | `/api/prep-stations` | Manager | Create PrepStation |
| `PUT` | `/api/prep-stations/[id]` | Manager | Update PrepStation |
| `DELETE` | `/api/prep-stations/[id]` | Manager | Delete PrepStation |

---

## Data Model

```
// Tray size definition for a prep-style ingredient
PrepTrayConfig {
  id           String
  locationId   String
  prepItemId   String      // Stores Ingredient ID (despite the field name)
  ingredient   Ingredient  // The prep-style ingredient this tray belongs to

  name         String      // "Large Dough Tray", "Small Tray", "Loose"
  capacity     Decimal     // Units per full tray (e.g. 6 for 6 pizza balls)
  description  String?
  sortOrder    Int
  isActive     Boolean

  createdAt    DateTime
  updatedAt    DateTime
  deletedAt    DateTime?
  syncedAt     DateTime?

  @@unique([prepItemId, name])
}

// A daily count session (one per calendar day per location)
DailyPrepCount {
  id           String
  locationId   String
  countDate    DateTime             // Morning of prep day
  status       DailyPrepCountStatus // draft | submitted | approved | rejected

  createdById  String
  createdBy    Employee

  submittedById String?
  submittedBy   Employee?
  submittedAt   DateTime?

  approvedById  String?
  approvedBy    Employee?
  approvedAt    DateTime?

  rejectionReason String?
  notes           String?

  countItems   DailyPrepCountItem[]
  transactions DailyPrepCountTransaction[]

  createdAt    DateTime
  updatedAt    DateTime
  deletedAt    DateTime?
  syncedAt     DateTime?
}

// One line in a count session — quantity counted for a single ingredient
DailyPrepCountItem {
  id           String
  locationId   String

  dailyCountId String
  dailyCount   DailyPrepCount

  prepItemId   String         // Ingredient ID (prep-style)
  ingredient   Ingredient

  // Tray breakdown JSON: { "Large Tray": 3, "Small Tray": 2, "Loose": 4 }
  trayBreakdown    Json?

  totalCounted     Decimal    // Calculated: sum(tray_qty * tray_capacity) + loose
  expectedQuantity Decimal?   // Previous currentPrepStock (variance baseline)
  variance         Decimal?   // totalCounted - expectedQuantity
  variancePercent  Decimal?   // (variance / expectedQuantity) * 100
  costPerUnit      Decimal?   // Snapshot at approval time
  totalCost        Decimal?   // totalCounted * costPerUnit

  notes        String?

  @@unique([dailyCountId, prepItemId])
}

// Append-only audit trail written on approval
DailyPrepCountTransaction {
  id           String
  locationId   String
  dailyCountId String

  type         String         // 'prep_stock_add' | 'ingredient_deduct'

  prepItemId      String?     // Ingredient ID for prep_stock_add entries
  inventoryItemId String?     // InventoryItem ID for ingredient_deduct entries

  quantityBefore  Decimal
  quantityChange  Decimal     // Positive for prep_stock_add, negative for ingredient_deduct
  quantityAfter   Decimal
  unit            String?

  unitCost     Decimal?
  totalCost    Decimal?

  createdAt    DateTime
  updatedAt    DateTime
  deletedAt    DateTime?
  syncedAt     DateTime?
}

enum DailyPrepCountStatus {
  draft
  submitted
  approved
  rejected
}

// KDS routing station (not a daily count model — documented here for disambiguation)
PrepStation {
  id           String
  locationId   String
  name         String       // "Kitchen", "Bar", "Expo", "Grill", "Fryer"
  displayName  String?
  color        String?
  stationType  String       // kitchen | bar | expo | prep
  sortOrder    Int
  isActive     Boolean
  showAllItems Boolean      // Expo mode — show all items regardless of routing
  autoComplete Int?         // Seconds until auto-bump (non-interactive stations)

  deletedAt    DateTime?
  syncedAt     DateTime?
}

// Legacy kitchen prep-recipe model (ingredient-cost tracking, not daily counting)
PrepItem {
  id           String
  locationId   String
  name         String       // "Shredded Chicken", "Simple Syrup"
  outputUnit   String       // "oz", "each", "qt"
  batchYield   Decimal      // How much one batch makes
  batchUnit    String
  costPerUnit  Decimal?     // Auto-calculated from ingredient costs
  shelfLifeHours Int?
  storageNotes String?

  // Daily count config (mirrors Ingredient fields for PrepItem path)
  isDailyCountItem Boolean
  currentPrepStock Decimal
  lastCountedAt    DateTime?

  lowStockThreshold      Decimal?
  criticalStockThreshold Decimal?
  onlineStockThreshold   Decimal?

  ingredients  PrepItemIngredient[]
  deletedAt    DateTime?
}
```

---

## Business Logic

### Create Session Flow
1. Staff opens daily count UI and clicks "Start Today's Count".
2. POST `/api/inventory/daily-counts` with `createdById` and optional `countDate`.
3. API checks for an existing non-rejected session for the same calendar day; if found, returns `400` with the existing session ID.
4. A new `DailyPrepCount` is created in `draft` status.

### Count Entry Flow (Draft)
1. For each prep-style ingredient with `isDailyCountItem = true`, staff sees tray slots.
2. Staff enters quantities per tray type (e.g., "Large Tray: 3, Small Tray: 1, Loose: 4").
3. UI calculates `totalCounted = sum(tray_qty * tray_capacity) + loose`.
4. PUT `/api/inventory/daily-counts/[id]` upserts `DailyPrepCountItem` records for each ingredient.
5. API calculates `expectedQuantity` from `ingredient.currentPrepStock`, then `variance` and `variancePercent`.
6. Session remains `draft`; staff can freely update counts.

### Submit Flow
1. Staff clicks "Submit for Approval".
2. POST `/api/inventory/daily-counts/[id]/submit` with `submittedById`.
3. API validates: session must be `draft` and have at least one count item.
4. Status transitions to `submitted`; `submittedAt` is recorded.
5. Manager is notified (no automatic socket event — managers poll or check the approval queue).

### Approval Flow
1. Manager reviews submitted count on the daily counts UI.
2. POST `/api/inventory/daily-counts/[id]/approve` with `approvedById` and optional `{ reject: true, rejectionReason }`.
3. **Rejection path:** status → `rejected`; `rejectionReason` stored; staff must create a new session (rejected sessions are excluded from the "one per day" check).
4. **Approval path:**
   a. For each `DailyPrepCountItem`, read `ingredient.currentPrepStock` as `quantityBefore`.
   b. Set `quantityAfter = totalCounted`.
   c. Create a `DailyPrepCountTransaction` record with `type = 'prep_stock_add'`.
   d. Update `ingredient.currentPrepStock = totalCounted` and `ingredient.lastCountedAt = now()` (all in parallel via `Promise.all`).
   e. Batch-create all transaction records via `createMany`.
   f. Update `DailyPrepCount.status = 'approved'`, set `approvedAt`.
5. Response includes a `transactionsSummary` with counts of `prepItemsUpdated` and `ingredientsDeducted`.

### Variance Tracking
- `variance = totalCounted - expectedQuantity` (positive = more on hand than expected; negative = deficit).
- `variancePercent = (variance / expectedQuantity) * 100`.
- These are calculated on each PUT and stored on `DailyPrepCountItem` for manager review before approval.

---

## Cross-Feature Dependencies

> See `_CROSS-REF-MATRIX.md` for full matrix.

### This feature MODIFIES these features:
| Feature | How / Why |
|---------|-----------|
| Inventory | Approval writes `Ingredient.currentPrepStock` and `Ingredient.lastCountedAt`; creates `DailyPrepCountTransaction` audit records |
| KDS | `PrepStation` is managed under the same hardware settings area; PrepStation routing affects which KDS screen sees which items |

### These features MODIFY this feature:
| Feature | How / Why |
|---------|-----------|
| Inventory | `Ingredient.isDailyCountItem` flag controls which ingredients appear in the daily count |
| Menu | Categories and items route to `PrepStation` which determines kitchen prep flow |
| Employees | `createdById`, `submittedById`, `approvedById` references on `DailyPrepCount` |

### BEFORE CHANGING THIS FEATURE, VERIFY:
- [ ] **Inventory** — does approval logic still correctly update `currentPrepStock` and write audit transactions?
- [ ] **One-session-per-day invariant** — any change to session creation must preserve the uniqueness check (excluding rejected sessions).
- [ ] **Draft-only edits** — count items can only be updated when session is in `draft` status; approved sessions are immutable.
- [ ] **Approved sessions cannot be deleted** — enforced in DELETE handler.

---

## Permissions Required

| Action | Permission Key | Level |
|--------|---------------|-------|
| View daily counts | `INVENTORY_VIEW` | Standard |
| Create / update count session | `INVENTORY_COUNTS` | Standard |
| Submit count for approval | `INVENTORY_COUNTS` | Standard |
| Approve or reject count | `INVENTORY_MANAGE` | Manager |
| Adjust prep stock directly | `INVENTORY_ADJUST_PREP_STOCK` | Manager |
| Manage prep stations (KDS routing) | `SETTINGS_HARDWARE` | Manager |

---

## Known Constraints
- Only one non-rejected count session per calendar day per location is permitted. If a session exists for today it must be approved, rejected, or deleted before a new one can be created.
- Count items can only be updated while the session is in `draft` status — `PUT` returns `400` if the session is `submitted` or `approved`.
- Approved sessions cannot be soft-deleted — `DELETE` returns `400`.
- `DailyPrepCountTransaction` records use `prepItemId` to store an `Ingredient` ID (not a `PrepItem` ID), despite the field name. This is documented in the schema and route code but is a naming inconsistency to be aware of.
- `PrepTrayConfig.prepItemId` also stores an `Ingredient` ID, not a `PrepItem` ID — same naming inconsistency.
- Cost per unit on `DailyPrepCountItem` is set to `null` in the current implementation. The schema supports it but the approval route does not yet calculate costs from parent ingredient chains.
- `PrepStation` is documented here for completeness but is a KDS-routing model, not a daily count model. It does not affect `DailyPrepCount` logic.
- The legacy `PrepItem` model (a distinct kitchen prep-recipe table) has its own `isDailyCountItem` / `currentPrepStock` fields but the daily count approval route operates exclusively on `Ingredient` records (prep-style ingredients with `preparationType`).
- No socket event is emitted on session submission or approval. Managers must refresh the UI to see pending submissions.

---

## Related Docs
- **Feature doc:** `docs/features/inventory.md`
- **Feature doc:** `docs/features/kds.md`
- **Feature doc:** `docs/features/menu.md`
- **Domain doc:** `docs/domains/INVENTORY-DOMAIN.md`
- **Architecture guide:** `docs/guides/CODING-STANDARDS.md`

---

*Last updated: 2026-03-03*
