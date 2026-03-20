/**
 * Migration 084: Create _cron_venue_registry table in the master DB.
 *
 * This table tracks all provisioned venue databases so that Vercel cron jobs
 * can iterate over every active venue instead of only hitting the master DB.
 *
 * The table lives in the master database (gwi_pos) only — venue databases
 * do not need this table.
 */

/** @param {import('@prisma/client').PrismaClient} prisma */
module.exports.up = async function up(prisma) {
  // Only create in master DB (skip venue databases)
  const dbResult = await prisma.$queryRawUnsafe(
    `SELECT current_database() AS db_name`
  )
  const dbName = dbResult[0]?.db_name
  // Venue databases are named gwi_pos_<slug> — master is gwi_pos or neondb
  if (dbName && dbName.startsWith('gwi_pos_') && dbName !== 'gwi_pos') {
    console.log(`[084] Skipping _cron_venue_registry — not master DB (${dbName})`)
    return
  }

  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS "_cron_venue_registry" (
      "slug" TEXT PRIMARY KEY,
      "database_name" TEXT NOT NULL,
      "is_active" BOOLEAN NOT NULL DEFAULT true,
      "nuc_base_url" TEXT,
      "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
      "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `)

  await prisma.$executeRawUnsafe(`
    CREATE INDEX IF NOT EXISTS "idx_cron_venue_registry_active"
    ON "_cron_venue_registry" ("is_active")
    WHERE "is_active" = true
  `)

  console.log('[084] Created _cron_venue_registry table + active index')
}
