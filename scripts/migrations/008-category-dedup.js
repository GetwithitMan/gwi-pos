/**
 * Migration 008: Category deduplication
 *
 * Deduplicates Category rows by (locationId, name), reassigns MenuItems
 * from duplicate categories to the keeper (most recently updated),
 * then adds a unique constraint.
 */

const { tableExists } = require('../migration-helpers')

async function up(prisma) {
  const PREFIX = '[008-category-dedup]'

  try {
    const catExists = await tableExists(prisma, 'Category')
    if (!catExists) {
      console.log(`${PREFIX}   Category table not found -- skipping`)
      return
    }

    const hasIdx = await prisma.$queryRawUnsafe(`
      SELECT 1 FROM pg_indexes
      WHERE tablename = 'Category'
        AND indexname = 'Category_locationId_name_key'
      LIMIT 1
    `)
    if (hasIdx.length === 0) {
      console.log(`${PREFIX}   Deduplicating Category rows by (locationId, name)...`)
      // Reassign menu items from duplicate categories to the keeper (most recently updated)
      await prisma.$executeRawUnsafe(`
        WITH keepers AS (
          SELECT DISTINCT ON ("locationId", "name") "id"
          FROM "Category"
          WHERE "deletedAt" IS NULL
          ORDER BY "locationId", "name", "updatedAt" DESC
        ),
        dupes AS (
          SELECT c."id" AS dupe_id, k."id" AS keeper_id
          FROM "Category" c
          JOIN "Category" k ON c."locationId" = k."locationId" AND c."name" = k."name"
          JOIN keepers k2 ON k2."id" = k."id"
          WHERE c."id" != k."id"
            AND c."deletedAt" IS NULL
            AND k."deletedAt" IS NULL
            AND k."id" = k2."id"
        )
        UPDATE "MenuItem" mi
        SET "categoryId" = d.keeper_id
        FROM dupes d
        WHERE mi."categoryId" = d.dupe_id
      `)
      // Delete the duplicate category rows
      await prisma.$executeRawUnsafe(`
        WITH keepers AS (
          SELECT DISTINCT ON ("locationId", "name") "id"
          FROM "Category"
          WHERE "deletedAt" IS NULL
          ORDER BY "locationId", "name", "updatedAt" DESC
        )
        DELETE FROM "Category"
        WHERE "id" NOT IN (SELECT "id" FROM keepers)
          AND "deletedAt" IS NULL
      `)
      // Now add the unique constraint
      await prisma.$executeRawUnsafe(`
        CREATE UNIQUE INDEX "Category_locationId_name_key"
        ON "Category" ("locationId", "name")
      `)
      console.log(`${PREFIX}   Done -- Category deduped + unique constraint added`)
    }
  } catch (err) {
    console.error(`${PREFIX}   FAILED Category dedup:`, err.message)
  }
}

module.exports = { up }
