// Add partial unique index on BottleServiceTier(locationId, LOWER(name))
// Prevents duplicate tier names within a location (case-insensitive)

const { indexExists } = require('../migration-helpers')

async function up(prisma) {
  // Step 1: Check for and resolve duplicates before adding unique index
  const duplicates = await prisma.$queryRawUnsafe(`
    SELECT "locationId", LOWER("name") as lower_name, COUNT(*) as cnt
    FROM "BottleServiceTier"
    WHERE "deletedAt" IS NULL
    GROUP BY "locationId", LOWER("name")
    HAVING COUNT(*) > 1
  `)

  if (duplicates.length > 0) {
    console.log('[migration-062] Found duplicate BottleServiceTier names, resolving...')
    for (const dup of duplicates) {
      const tiers = await prisma.$queryRawUnsafe(`
        SELECT id, name FROM "BottleServiceTier"
        WHERE "locationId" = $1 AND LOWER("name") = $2 AND "deletedAt" IS NULL
        ORDER BY "createdAt" ASC
      `, dup.locationId, dup.lower_name)

      // Keep first, rename rest
      for (let i = 1; i < tiers.length; i++) {
        const newName = `${tiers[i].name} (${i + 1})`
        await prisma.$executeRawUnsafe(
          `UPDATE "BottleServiceTier" SET "name" = $1 WHERE "id" = $2`,
          newName, tiers[i].id
        )
        console.log(`[migration-062] Renamed duplicate tier ${tiers[i].id} to "${newName}"`)
      }
    }
  }

  // Step 2: Create partial unique index
  const idxName = 'BottleServiceTier_locationId_name_unique'
  const exists = await indexExists(prisma, idxName)
  if (!exists) {
    await prisma.$executeRawUnsafe(`
      CREATE UNIQUE INDEX IF NOT EXISTS "${idxName}"
      ON "BottleServiceTier" ("locationId", LOWER("name"))
      WHERE "deletedAt" IS NULL
    `)
    console.log('[migration-062] Created unique index on BottleServiceTier(locationId, LOWER(name))')
  } else {
    console.log('[migration-062] Index already exists, skipping')
  }
}

module.exports = { up }
