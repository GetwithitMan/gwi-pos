# Liquor Inventory Reconciliation

## Bug Description

Spirit tier selection was disconnected from inventory tracking. When a customer ordered a premium spirit (e.g. Grey Goose), the POS correctly charged the premium price but deducted inventory from the **well bottle** (e.g. house vodka) instead of the selected premium bottle.

### Root Causes

1. **Missing `linkedBottleProductId` on modifiers** — The Android client did not always send `linkedBottleProductId` when a spirit modifier was selected. The order was placed with `spiritTier` set but no bottle link, so the deduction engine fell back to the base/well bottle.

2. **Pour multiplier not transmitted** — When a customer ordered a double or tall pour, the `pourMultiplier` field was sometimes missing from the order payload. The deduction engine defaulted to 1.0x, under-deducting inventory.

3. **No server-side validation** — Prior to the fix, the server trusted whatever the client sent. There was no backfill or correction logic to resolve the correct bottle from the modifier's canonical `linkedBottleProductId`.

### Impact

- **Inventory drift**: Well bottles showed artificially low stock; premium bottles showed artificially high stock.
- **COGS inaccuracy**: Cost-of-goods reports underestimated actual pour cost (well cost applied to premium pours).
- **Reorder triggers**: Auto-reorder thresholds fired too early for well bottles and too late for premium bottles.
- **No revenue loss**: Customers were charged correctly. The issue is purely an inventory/COGS tracking problem.

---

## Fix Summary (What Changed)

The following guardrails are now in place (deployed with the liquor-overhaul branch):

1. **`validateSpiritTier()`** — Server-side backfill in `src/lib/liquor-validation.ts`. Looks up the modifier's canonical `linkedBottleProductId` from the DB and corrects the order item if the client sent the wrong value (or none).

2. **`validatePourMultiplier()`** — Server-side backfill in `src/lib/liquor-validation.ts`. Resolves the pour multiplier from `MenuItem.pourSizes` when the client omits it.

3. **Structured audit logging** — Every correction emits a `[liquor-audit]` JSON log entry (`spirit_backfill`, `pour_multiplier_backfill`, `old_client_detected`, etc.) for post-hoc analysis.

4. **Monitoring endpoint** — `GET /api/health/liquor` returns real-time counts of `needsVerification`, `deductionFailed`, and `missingLinkedBottle` metrics.

5. **Derived stock** — `BottleProduct.currentStock` is no longer written directly. Stock is derived from `InventoryItem.currentStock / bottleSizeOz` via `getDerivedBottleStock()`.

---

## Heuristic SQL Queries

These queries estimate the historical damage. Connect to the venue's Neon database and substitute `$1` with the venue's `locationId`.

### How to Run

1. Connect to the venue's Neon database (connection string in MC or `.env`)
2. Replace `$1` with the venue's `locationId` (UUID)
3. Adjust date ranges as needed (`$2` = start date, `$3` = end date)
4. Results are estimates — the true damage requires cross-referencing with physical counts

### Query 1: Spirit Tier Damage (Premium Charged, Well Deducted)

Finds order item modifiers where a spirit tier was set but no `linkedBottleProductId` was recorded — meaning the deduction likely hit the wrong bottle.

```sql
-- Spirit tier damage: modifiers with spiritTier but no linked bottle
-- These orders charged premium prices but deducted from well inventory
SELECT
  oim.id AS modifier_id,
  oim."spiritTier",
  oim.name AS modifier_name,
  oim.price AS charged_price,
  oi.name AS item_name,
  oi."menuItemId",
  o.id AS order_id,
  o."orderNumber",
  o."createdAt"
FROM "OrderItemModifier" oim
JOIN "OrderItem" oi ON oi.id = oim."orderItemId"
JOIN "Order" o ON o.id = oi."orderId"
WHERE o."locationId" = $1
  AND oim."spiritTier" IS NOT NULL
  AND oim."linkedBottleProductId" IS NULL
  AND oim."deletedAt" IS NULL
  AND oi."deletedAt" IS NULL
  AND o."deletedAt" IS NULL
  AND o."createdAt" >= $2   -- start date, e.g. '2026-01-01'
  AND o."createdAt" < $3    -- end date, e.g. '2026-04-01'
ORDER BY o."createdAt" DESC;
```

**Interpretation**: Each row is an order where a premium spirit was selected but inventory was likely deducted from the well bottle. The `charged_price` shows what the customer paid (correct); the inventory impact is what's wrong.

### Query 2: Pour Multiplier Damage (Double/Tall Poured, Single Deducted)

Finds order items with a `pourSize` but no `pourMultiplier`, meaning the deduction used 1.0x regardless of actual pour size.

```sql
-- Pour multiplier damage: items with pourSize but no multiplier recorded
-- These pours deducted 1x inventory regardless of actual pour size
SELECT
  oi.id AS item_id,
  oi.name AS item_name,
  oi."pourSize",
  oi."pourMultiplier",
  oi.price,
  oi.quantity,
  o.id AS order_id,
  o."orderNumber",
  o."createdAt",
  CASE oi."pourSize"
    WHEN 'double' THEN 2.0
    WHEN 'tall'   THEN 1.5
    WHEN 'short'  THEN 0.75
    ELSE 1.0
  END AS expected_multiplier,
  CASE oi."pourSize"
    WHEN 'double' THEN 1.0  -- deducted 1x instead of 2x = 1.0 oz under-deducted per pour
    WHEN 'tall'   THEN 0.5  -- deducted 1x instead of 1.5x = 0.5 oz under-deducted per pour
    ELSE 0.0
  END AS under_deducted_multiplier_delta
FROM "OrderItem" oi
JOIN "Order" o ON o.id = oi."orderId"
WHERE o."locationId" = $1
  AND oi."pourSize" IS NOT NULL
  AND (oi."pourMultiplier" IS NULL OR oi."pourMultiplier" = 1.0)
  AND oi."pourSize" != 'shot'  -- shot = 1.0x, no damage
  AND oi."deletedAt" IS NULL
  AND o."deletedAt" IS NULL
  AND o."createdAt" >= $2
  AND o."createdAt" < $3
ORDER BY o."createdAt" DESC;
```

**Interpretation**: Each row is a pour where the deduction was likely under-counted. `under_deducted_multiplier_delta` shows how many extra "units" should have been deducted per pour but weren't.

### Query 3: Estimated Revenue Impact Summary

Aggregates the damage into a summary with estimated dollar impact using bottle pour costs.

```sql
-- Summary: count of affected orders and estimated cost impact
WITH spirit_damage AS (
  SELECT
    COUNT(*) AS affected_modifier_count,
    COUNT(DISTINCT o.id) AS affected_order_count
  FROM "OrderItemModifier" oim
  JOIN "OrderItem" oi ON oi.id = oim."orderItemId"
  JOIN "Order" o ON o.id = oi."orderId"
  WHERE o."locationId" = $1
    AND oim."spiritTier" IS NOT NULL
    AND oim."linkedBottleProductId" IS NULL
    AND oim."deletedAt" IS NULL
    AND oi."deletedAt" IS NULL
    AND o."deletedAt" IS NULL
    AND o."createdAt" >= $2
    AND o."createdAt" < $3
),
pour_damage AS (
  SELECT
    COUNT(*) AS affected_pour_count,
    COUNT(DISTINCT o.id) AS affected_order_count
  FROM "OrderItem" oi
  JOIN "Order" o ON o.id = oi."orderId"
  WHERE o."locationId" = $1
    AND oi."pourSize" IS NOT NULL
    AND (oi."pourMultiplier" IS NULL OR oi."pourMultiplier" = 1.0)
    AND oi."pourSize" NOT IN ('shot')
    AND oi."deletedAt" IS NULL
    AND o."deletedAt" IS NULL
    AND o."createdAt" >= $2
    AND o."createdAt" < $3
)
SELECT
  sd.affected_modifier_count AS spirit_tier_mismatches,
  sd.affected_order_count AS orders_with_spirit_damage,
  pd.affected_pour_count AS pour_multiplier_mismatches,
  pd.affected_order_count AS orders_with_pour_damage
FROM spirit_damage sd, pour_damage pd;
```

**Interpretation**: This gives a high-level picture of how many orders were affected. Multiply `spirit_tier_mismatches` by the average premium-vs-well cost delta (typically $2-8/pour) for a rough dollar estimate. Multiply `pour_multiplier_mismatches` by average pour cost for under-deduction estimate.

---

## Recommended Resolution: Option B — Clean Cutover

**Do NOT attempt to retroactively fix historical inventory transactions.** The data is too ambiguous — we can't know which specific well bottle was over-deducted or which premium bottle was under-deducted without physical evidence.

### Procedure

1. **Pick a cutover date** — ideally a slow day or start of week.

2. **Deploy the fix** — Ensure the liquor-overhaul branch is live. Verify the `/api/health/liquor` endpoint returns `missingLinkedBottleCount: 0` for new orders.

3. **Perform a physical count** — Count every bottle behind the bar and in storage. Record actual quantities.

4. **Reset inventory to physical count** — Use the inventory adjustment API or admin UI to set each `InventoryItem.currentStock` to the physically counted value.

5. **Document the variance** — Record the difference between system stock and physical count. This variance IS the accumulated damage from the bug. Keep this record for accounting/COGS reconciliation.

6. **Monitor post-fix** — Watch the `/api/health/liquor` endpoint daily for the first week. All three metrics should stay at 0 or near-0. Check `[liquor-audit]` logs for any `spirit_backfill` events — these indicate old clients still sending bad data (the server is correcting them).

### What NOT to Do

- Do not create retroactive `InventoryItemTransaction` records — they'll corrupt the audit trail
- Do not try to "undo" individual deductions — too many edge cases (partial bottles, breakage, comps)
- Do not adjust bottle costs retroactively — COGS reports should be re-interpreted, not re-written

---

## Pre-Fix vs Post-Fix Reporting

### Inventory Reports (Pre-Fix Period)

- **Well bottle stock**: Artificially LOW (extra deductions from premium orders)
- **Premium bottle stock**: Artificially HIGH (deductions went to well instead)
- **Usage reports**: Over-report well usage, under-report premium usage
- **COGS**: Under-reported (well cost < premium cost, so recorded COGS < actual COGS)
- **Pour cost %**: Under-reported for the same reason

**Action**: Flag all inventory/COGS reports from before the cutover date as "pre-correction". Do not use them for trend analysis or reorder decisions without adjustment.

### Inventory Reports (Post-Fix Period)

- All metrics should be accurate going forward
- The first post-fix period may show an apparent "jump" in premium usage and COGS — this is correct, not an anomaly
- Pour cost % will likely increase — this reflects reality, not a regression

### Revenue Reports

- Revenue reports are **unaffected** — customers were always charged correctly
- Sales mix reports are accurate (spirit tier was recorded on the order)
- Only inventory-side metrics (stock levels, COGS, pour cost) were impacted

---

## Monitoring Checklist (Post-Deployment)

| Check | How | Expected |
|-------|-----|----------|
| New orders have correct bottle links | `GET /api/health/liquor` → `missingLinkedBottleCount` | 0 |
| No deduction failures | `GET /api/health/liquor` → `deductionFailedCount` | 0 |
| No bottles needing verification | `GET /api/health/liquor` → `needsVerificationCount` | 0 (after initial cleanup) |
| Server backfilling old clients | Search logs for `[liquor-audit] spirit_backfill` | Decreasing over time as clients update |
| Pour multipliers resolving | Search logs for `[liquor-audit] pour_multiplier_backfill` | Decreasing over time |
| No out-of-range multipliers | Search logs for `pour_multiplier_out_of_range` | 0 |
| Stock not going negative | Search logs for `[inventory-audit] stock_negative` | 0 (investigate if seen) |
