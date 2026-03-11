/**
 * Migration 043: ModifierGroup + Modifier unique constraints + dedup
 *
 * Same pattern as 042 for MenuItem. Deduplicates then adds partial unique
 * indexes to prevent future duplication from downstream sync or dual-DB creation.
 *
 * ModifierGroup: unique on (locationId, name) WHERE deletedAt IS NULL
 * Modifier: unique on (modifierGroupId, name) WHERE deletedAt IS NULL
 */

const { tableExists, indexExists } = require('../migration-helpers')

async function up(prisma) {
  const PREFIX = '[043-modifiergroup-modifier-unique-constraint]'

  // ── ModifierGroup dedup ───────────────────────────────────────────────
  try {
    const mgExists = await tableExists(prisma, 'ModifierGroup')
    if (!mgExists) {
      console.log(`${PREFIX}   ModifierGroup table not found -- skipping`)
    } else {
      const hasMgIdx = await indexExists(prisma, 'ModifierGroup_locationId_name_active_key')
      if (hasMgIdx) {
        console.log(`${PREFIX}   ModifierGroup already has unique constraint -- skipping`)
      } else {
        const dupeCount = await prisma.$queryRawUnsafe(`
          SELECT COUNT(*) as cnt FROM (
            SELECT "locationId", "name", COUNT(*) as c
            FROM "ModifierGroup"
            WHERE "deletedAt" IS NULL
            GROUP BY "locationId", "name"
            HAVING COUNT(*) > 1
          ) sub
        `)
        const numDupeGroups = Number(dupeCount[0]?.cnt ?? 0)

        if (numDupeGroups > 0) {
          console.log(`${PREFIX}   Found ${numDupeGroups} duplicate ModifierGroup groups -- deduplicating`)

          await prisma.$executeRawUnsafe(`
            CREATE TEMP TABLE _mg_dedup AS
            WITH counted AS (
              SELECT mg.id, mg."locationId", mg.name, mg."createdAt",
                     COALESCE(mc.cnt, 0) AS mod_count
              FROM "ModifierGroup" mg
              LEFT JOIN (SELECT "modifierGroupId", COUNT(*) AS cnt FROM "Modifier" GROUP BY "modifierGroupId") mc
                ON mc."modifierGroupId" = mg.id
              WHERE mg."deletedAt" IS NULL
            ),
            ranked AS (
              SELECT id, "locationId", name,
                     ROW_NUMBER() OVER (PARTITION BY "locationId", name ORDER BY mod_count DESC, "createdAt" ASC) AS rn
              FROM counted
            )
            SELECT r.id AS dupe_id, k.id AS keeper_id
            FROM ranked r
            JOIN ranked k ON r."locationId" = k."locationId" AND r.name = k.name AND k.rn = 1
            WHERE r.rn > 1
          `)

          try {
            // Reassign OrderItemModifier refs from modifiers in dupe groups to keeper groups
            await prisma.$executeRawUnsafe(`
              UPDATE "OrderItemModifier" oim
              SET "modifierId" = km.id
              FROM "Modifier" dm
              JOIN _mg_dedup d ON dm."modifierGroupId" = d.dupe_id
              JOIN "Modifier" km ON km."modifierGroupId" = d.keeper_id AND km.name = dm.name
              WHERE oim."modifierId" = dm.id
            `)

            // Delete all modifiers belonging to dupe groups
            await prisma.$executeRawUnsafe(`
              DELETE FROM "Modifier" m USING _mg_dedup d WHERE m."modifierGroupId" = d.dupe_id
            `)

            // Delete duplicate ModifierGroups
            await prisma.$executeRawUnsafe(`
              DELETE FROM "ModifierGroup" WHERE id IN (SELECT dupe_id FROM _mg_dedup)
            `)
            console.log(`${PREFIX}   Duplicate ModifierGroups removed`)
          } finally {
            await prisma.$executeRawUnsafe(`DROP TABLE IF EXISTS _mg_dedup`)
          }
        } else {
          console.log(`${PREFIX}   No duplicate ModifierGroups found`)
        }

        // Clean up soft-deleted rows that clash with active rows
        await prisma.$executeRawUnsafe(`
          DELETE FROM "ModifierGroup" d
          WHERE d."deletedAt" IS NOT NULL
            AND EXISTS (
              SELECT 1 FROM "ModifierGroup" a
              WHERE a."deletedAt" IS NULL
                AND a."locationId" = d."locationId"
                AND a."name" = d."name"
            )
        `)

        await prisma.$executeRawUnsafe(`
          CREATE UNIQUE INDEX "ModifierGroup_locationId_name_active_key"
          ON "ModifierGroup" ("locationId", "name")
          WHERE "deletedAt" IS NULL
        `)
        console.log(`${PREFIX}   Done -- unique constraint ModifierGroup(locationId, name) added`)
      }
    }
  } catch (err) {
    console.error(`${PREFIX}   ModifierGroup FAILED:`, err.message)
  }

  // ── Modifier dedup ────────────────────────────────────────────────────
  try {
    const modExists = await tableExists(prisma, 'Modifier')
    if (!modExists) {
      console.log(`${PREFIX}   Modifier table not found -- skipping`)
    } else {
      const hasModIdx = await indexExists(prisma, 'Modifier_groupId_name_active_key')
      if (hasModIdx) {
        console.log(`${PREFIX}   Modifier already has unique constraint -- skipping`)
      } else {
        const dupeCount = await prisma.$queryRawUnsafe(`
          SELECT COUNT(*) as cnt FROM (
            SELECT "modifierGroupId", "name", COUNT(*) as c
            FROM "Modifier"
            WHERE "deletedAt" IS NULL
            GROUP BY "modifierGroupId", "name"
            HAVING COUNT(*) > 1
          ) sub
        `)
        const numDupes = Number(dupeCount[0]?.cnt ?? 0)

        if (numDupes > 0) {
          console.log(`${PREFIX}   Found ${numDupes} duplicate Modifier groups -- deduplicating`)

          await prisma.$executeRawUnsafe(`
            DELETE FROM "Modifier" WHERE id IN (
              SELECT id FROM (
                SELECT id, ROW_NUMBER() OVER (
                  PARTITION BY "modifierGroupId", name ORDER BY "createdAt" ASC
                ) AS rn
                FROM "Modifier" WHERE "deletedAt" IS NULL
              ) sub WHERE rn > 1
            )
          `)
          console.log(`${PREFIX}   Duplicate Modifiers removed`)
        } else {
          console.log(`${PREFIX}   No duplicate Modifiers found`)
        }

        // Clean up soft-deleted that clash
        await prisma.$executeRawUnsafe(`
          DELETE FROM "Modifier" d
          WHERE d."deletedAt" IS NOT NULL
            AND EXISTS (
              SELECT 1 FROM "Modifier" a
              WHERE a."deletedAt" IS NULL
                AND a."modifierGroupId" = d."modifierGroupId"
                AND a."name" = d."name"
            )
        `)

        await prisma.$executeRawUnsafe(`
          CREATE UNIQUE INDEX "Modifier_groupId_name_active_key"
          ON "Modifier" ("modifierGroupId", "name")
          WHERE "deletedAt" IS NULL
        `)
        console.log(`${PREFIX}   Done -- unique constraint Modifier(modifierGroupId, name) added`)
      }
    }
  } catch (err) {
    console.error(`${PREFIX}   Modifier FAILED:`, err.message)
  }

  // ── Reset sync HWMs for affected tables ───────────────────────────────
  // After dedup, the IDs may have changed. Reset HWMs to epoch so the
  // downstream sync does a full re-sync of these tables.
  try {
    await prisma.$executeRawUnsafe(`
      INSERT INTO "_gwi_sync_state" (table_name, high_water_mark)
      VALUES ('ModifierGroup', '1970-01-01T00:00:00Z'), ('Modifier', '1970-01-01T00:00:00Z')
      ON CONFLICT (table_name) DO UPDATE SET high_water_mark = '1970-01-01T00:00:00Z'
    `)
    console.log(`${PREFIX}   Sync HWMs reset for ModifierGroup and Modifier`)
  } catch {
    // _gwi_sync_state may not exist on cloud-only deployments
  }
}

module.exports = { up }
