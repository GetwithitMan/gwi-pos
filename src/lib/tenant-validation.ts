/**
 * Tenant Validation — Model Set Definitions
 *
 * Central source of truth for which Prisma models are tenant-scoped
 * and which lack soft-delete. Validated at boot against the actual
 * Prisma schema to catch stale entries.
 */

// ── Tenant-scoped models ─────────────────────────────────────────────────────
// Models that have a locationId column and should be automatically filtered
// by the current request's location.

export const TENANT_SCOPED_MODELS = new Set([
  'BottleProduct', 'SpiritCategory', 'SpiritModifierGroup', 'RecipeIngredient',
  'SpiritUpsellEvent', 'BottleServiceTier', 'MenuItem', 'Category',
  'Modifier', 'ModifierGroup', 'Order', 'OrderItem',
  'InventoryItem', 'InventoryItemTransaction', 'Employee',
])

// ── Models without soft-delete ───────────────────────────────────────────────
// Models that do NOT have a `deletedAt` column — skip soft-delete filtering.

export const NO_SOFT_DELETE_MODELS = new Set([
  'Organization', 'Location', 'SyncAuditEntry', 'HardwareCommand',
  // Tables without deletedAt column — must skip soft-delete filter or queries crash
  'BergDevice', 'BergPluMapping', 'BergDispenseEvent',
  'QuickBarPreference', 'QuickBarDefault',
  'DeductionRun', 'PendingDeduction', 'IngredientCostHistory',
  'InventoryCountEntry', 'MarginEdgeProductMapping',
  'PmsChargeAttempt', 'SevenShiftsDailySalesPush', 'WasteLog',
  'ReasonAccess',
  'OutageQueueEntry', 'FulfillmentEvent', 'BridgeCheckpoint',
])

// ── Boot-time validation ─────────────────────────────────────────────────────

/**
 * Validate that all model names in our sets actually exist in the database.
 * Call at boot. Logs warnings for stale entries (model removed from schema
 * but still listed here).
 *
 * @param options.failOnStale — When true (production/staging), throws if any
 *   stale entries are found. When false (dev), logs a warning only.
 */
export async function validateTenantModelSets(
  db: { $queryRawUnsafe: <T = unknown>(query: string, ...values: unknown[]) => Promise<T> },
  options: { failOnStale?: boolean } = {}
): Promise<void> {
  try {
    const tables = await db.$queryRawUnsafe<Array<{ table_name: string }>>(
      `SELECT table_name FROM information_schema.tables
       WHERE table_schema = 'public' AND table_type = 'BASE TABLE'`
    )
    const tableNames = new Set(tables.map(t => t.table_name))

    const stale: string[] = []

    for (const model of TENANT_SCOPED_MODELS) {
      if (!tableNames.has(model)) {
        stale.push(`TENANT_SCOPED_MODELS: ${model}`)
      }
    }

    for (const model of NO_SOFT_DELETE_MODELS) {
      if (!tableNames.has(model)) {
        stale.push(`NO_SOFT_DELETE_MODELS: ${model}`)
      }
    }

    if (stale.length > 0) {
      const msg =
        `[tenant-validation] ${stale.length} stale model(s) in validation sets — ` +
        `remove from tenant-validation.ts:\n  ${stale.join('\n  ')}`

      if (options.failOnStale) {
        throw new Error(msg)
      }

      console.warn(msg)
    } else {
      console.log(
        `[tenant-validation] ✓ All model sets valid (${TENANT_SCOPED_MODELS.size} tenant-scoped, ${NO_SOFT_DELETE_MODELS.size} no-soft-delete)`
      )
    }
  } catch (err) {
    // Re-throw stale-entry errors so the caller (server.ts) can halt boot
    if (options.failOnStale) {
      throw err
    }
    console.warn('[tenant-validation] Validation failed:', err instanceof Error ? err.message : err)
  }
}
