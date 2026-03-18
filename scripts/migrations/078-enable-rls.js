/**
 * Migration 078: Enable Row-Level Security (RLS) on Tenant-Scoped Models
 *
 * Adds PostgreSQL RLS policies to all tenant-scoped models. Each policy
 * enforces that rows can only be read/written when the `app.current_tenant`
 * GUC matches the row's `locationId`.
 *
 * The GUC is set via `SELECT set_config('app.current_tenant', $1, true)`
 * at the start of each Prisma $transaction block. The `true` parameter
 * in `current_setting('app.current_tenant', true)` means "missing_ok" —
 * if the GUC is not set, it returns NULL, and the USING clause evaluates
 * to FALSE. This is fail-closed: queries without SET LOCAL see NO rows.
 *
 * FORCE ROW LEVEL SECURITY ensures the policy applies to the table owner
 * role too (critical for Neon where the app connects as the owner).
 */

/** @param {import('@prisma/client').PrismaClient} prisma */
export async function up(prisma) {
  // Must match TENANT_SCOPED_MODELS in src/lib/tenant-validation.ts
  const tenantModels = [
    'BottleProduct', 'SpiritCategory', 'SpiritModifierGroup', 'RecipeIngredient',
    'SpiritUpsellEvent', 'BottleServiceTier', 'MenuItem', 'Category',
    'Modifier', 'ModifierGroup', 'Order', 'OrderItem',
    'InventoryItem', 'InventoryItemTransaction', 'Employee',
  ]

  for (const model of tenantModels) {
    // Guard: check if table exists
    const tableExists = await prisma.$queryRawUnsafe(`
      SELECT EXISTS (
        SELECT 1 FROM information_schema.tables
        WHERE table_schema = 'public' AND table_name = '${model}'
      ) as exists
    `)
    if (!tableExists[0]?.exists) {
      console.log(`[Migration 078] Table ${model} does not exist, skipping`)
      continue
    }

    // Check if RLS is already enabled
    const rlsCheck = await prisma.$queryRawUnsafe(`
      SELECT relrowsecurity FROM pg_class WHERE relname = '${model}'
    `)
    if (rlsCheck[0]?.relrowsecurity) {
      console.log(`[Migration 078] RLS already enabled on ${model}`)
      continue
    }

    // Enable RLS
    await prisma.$executeRawUnsafe(`ALTER TABLE "${model}" ENABLE ROW LEVEL SECURITY`)

    // FORCE ensures policy applies to table owner too (critical for Neon)
    await prisma.$executeRawUnsafe(`ALTER TABLE "${model}" FORCE ROW LEVEL SECURITY`)

    // Create tenant isolation policy:
    //   USING  — controls which rows are visible (SELECT/UPDATE/DELETE)
    //   WITH CHECK — controls which rows can be inserted/updated
    //   current_setting('app.current_tenant', true) returns NULL when not set,
    //   causing the comparison to fail → fail-closed by default
    await prisma.$executeRawUnsafe(`
      CREATE POLICY tenant_isolation_${model.toLowerCase()} ON "${model}"
        USING ("locationId" = current_setting('app.current_tenant', true)::text)
        WITH CHECK ("locationId" = current_setting('app.current_tenant', true)::text)
    `)

    console.log(`[Migration 078] Enabled RLS + tenant isolation policy on ${model}`)
  }
}
