/**
 * Migration 090 — Add deletedAt to 6 admin-managed config models
 *
 * Models: BergDevice, BergPluMapping, MarginEdgeProductMapping,
 *         QuickBarDefault, QuickBarPreference, EmployeePermissionOverride
 *
 * These are synced models that lacked soft-delete support. Without deletedAt,
 * the soft-delete filter in db-tenant-scope.ts couldn't apply, and downstream
 * sync had no way to propagate removal.
 *
 * Also adds @@index([locationId, deletedAt]) for each table.
 */

async function up(prisma) {
  const tables = [
    'BergDevice',
    'BergPluMapping',
    'MarginEdgeProductMapping',
    'QuickBarDefault',
    'QuickBarPreference',
    'EmployeePermissionOverride',
  ]

  for (const table of tables) {
    // Guard: check if column already exists
    const cols = await prisma.$queryRawUnsafe(
      `SELECT 1 FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = $1 AND column_name = 'deletedAt'`,
      table
    )
    if (cols.length > 0) continue

    await prisma.$executeRawUnsafe(
      `ALTER TABLE "${table}" ADD COLUMN "deletedAt" TIMESTAMPTZ`
    )

    // Add index for soft-delete filtered queries
    const indexName = `${table}_locationId_deletedAt_idx`
    await prisma.$executeRawUnsafe(
      `CREATE INDEX IF NOT EXISTS "${indexName}" ON "${table}" ("locationId", "deletedAt")`
    )
  }
}

module.exports = { up }
