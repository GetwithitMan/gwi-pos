// Make Terminal name uniqueness soft-delete-safe.
// Drops the hard @@unique([locationId, name]) constraint and replaces it
// with a partial unique index WHERE "deletedAt" IS NULL.
// This allows deleted terminal names to be reused.

const { indexExists } = require('../migration-helpers')

async function up(prisma) {
  // Step 1: Deduplicate — soft-delete older active duplicates (keep most recent)
  const duplicates = await prisma.$queryRawUnsafe(`
    SELECT "locationId", "name", COUNT(*) as cnt
    FROM "Terminal"
    WHERE "deletedAt" IS NULL
    GROUP BY "locationId", "name"
    HAVING COUNT(*) > 1
  `)

  if (duplicates.length > 0) {
    console.log(`[migration-128] Found ${duplicates.length} duplicate active terminal name(s), resolving...`)
    for (const dup of duplicates) {
      // Keep the one with the most recent lastSeenAt (or createdAt fallback)
      const terminals = await prisma.$queryRawUnsafe(`
        SELECT id, name, "lastSeenAt", "createdAt" FROM "Terminal"
        WHERE "locationId" = $1 AND "name" = $2 AND "deletedAt" IS NULL
        ORDER BY COALESCE("lastSeenAt", "createdAt") DESC
      `, dup.locationId, dup.name)

      // Soft-delete all except the first (most recent)
      for (let i = 1; i < terminals.length; i++) {
        await prisma.$executeRawUnsafe(
          `UPDATE "Terminal" SET "deletedAt" = NOW(), "isActive" = false, "isPaired" = false, "deviceToken" = NULL WHERE "id" = $1`,
          terminals[i].id
        )
        console.log(`[migration-128] Soft-deleted duplicate terminal ${terminals[i].id} ("${terminals[i].name}")`)
      }
    }
  }

  // Step 2: Drop the Prisma-generated hard unique constraint
  // The constraint name is Terminal_locationId_name_key (from prisma/schema.sql)
  // Use pg_constraint lookup as fallback in case name differs
  const constraintRows = await prisma.$queryRawUnsafe(`
    SELECT conname FROM pg_constraint
    WHERE conrelid = '"Terminal"'::regclass
      AND contype = 'u'
      AND conname LIKE '%locationId_name%'
  `)

  for (const row of constraintRows) {
    await prisma.$executeRawUnsafe(
      `ALTER TABLE "Terminal" DROP CONSTRAINT IF EXISTS "${row.conname}"`
    )
    console.log(`[migration-128] Dropped constraint: ${row.conname}`)
  }

  // Also drop any old unique index with the same name pattern
  const oldIndexRows = await prisma.$queryRawUnsafe(`
    SELECT indexname FROM pg_indexes
    WHERE tablename = 'Terminal'
      AND indexname LIKE '%locationId_name%'
      AND indexdef LIKE '%UNIQUE%'
  `)
  for (const row of oldIndexRows) {
    await prisma.$executeRawUnsafe(`DROP INDEX IF EXISTS "${row.indexname}"`)
    console.log(`[migration-128] Dropped old unique index: ${row.indexname}`)
  }

  // Step 3: Create partial unique index (active terminals only)
  const partialIdxName = 'Terminal_locationId_name_active_key'
  if (!(await indexExists(prisma, partialIdxName))) {
    await prisma.$executeRawUnsafe(`
      CREATE UNIQUE INDEX "${partialIdxName}"
      ON "Terminal" ("locationId", "name")
      WHERE "deletedAt" IS NULL
    `)
    console.log('[migration-128] Created partial unique index: Terminal_locationId_name_active_key')
  }

  // Step 4: Create non-unique performance index for all rows
  const perfIdxName = 'Terminal_locationId_name_idx'
  if (!(await indexExists(prisma, perfIdxName))) {
    await prisma.$executeRawUnsafe(`
      CREATE INDEX "${perfIdxName}"
      ON "Terminal" ("locationId", "name")
    `)
    console.log('[migration-128] Created performance index: Terminal_locationId_name_idx')
  }
}

module.exports = { up }
