/**
 * Migration 020: Add missing unique constraints to prevent sync duplication
 *
 * The Fruita Grill incident proved that models without business-logic unique
 * constraints (e.g., [locationId, name]) can accumulate duplicates when
 * NUC and Neon generate records with different CUIDs for the same entity.
 *
 * This migration deduplicates existing data, then adds @@unique constraints
 * for: Table, Section, TaxRule, PrintRoute.
 *
 * Category (008) and MenuItem (009) already have dedup migrations.
 */

const { tableExists, indexExists } = require('../migration-helpers')

async function up(prisma) {
  const PREFIX = '[020-dedup-unique-constraints]'

  // ── 1. Table: @@unique([locationId, name]) ────────────────────────────────
  await dedupAndConstrain(prisma, {
    prefix: PREFIX,
    tableName: 'Table',
    indexName: 'Table_locationId_name_key',
    uniqueCols: ['locationId', 'name'],
    // Reassign child records (orders, seats, tickets, reservations, etc.) to keeper
    preDedup: async () => {
      // Move orders from dupes to keepers
      await prisma.$executeRawUnsafe(`
        WITH keepers AS (
          SELECT DISTINCT ON ("locationId", "name") "id"
          FROM "Table"
          WHERE "deletedAt" IS NULL
          ORDER BY "locationId", "name", "updatedAt" DESC
        ),
        dupes AS (
          SELECT t."id" AS dupe_id, k."id" AS keeper_id
          FROM "Table" t
          JOIN "Table" k ON t."locationId" = k."locationId" AND t."name" = k."name"
          JOIN keepers k2 ON k2."id" = k."id"
          WHERE t."id" != k."id"
            AND t."deletedAt" IS NULL
            AND k."deletedAt" IS NULL
            AND k."id" = k2."id"
        )
        UPDATE "Order" o
        SET "tableId" = d.keeper_id
        FROM dupes d
        WHERE o."tableId" = d.dupe_id
      `)
      // Move seats
      await prisma.$executeRawUnsafe(`
        WITH keepers AS (
          SELECT DISTINCT ON ("locationId", "name") "id"
          FROM "Table"
          WHERE "deletedAt" IS NULL
          ORDER BY "locationId", "name", "updatedAt" DESC
        ),
        dupes AS (
          SELECT t."id" AS dupe_id, k."id" AS keeper_id
          FROM "Table" t
          JOIN "Table" k ON t."locationId" = k."locationId" AND t."name" = k."name"
          JOIN keepers k2 ON k2."id" = k."id"
          WHERE t."id" != k."id"
            AND t."deletedAt" IS NULL
            AND k."deletedAt" IS NULL
            AND k."id" = k2."id"
        )
        UPDATE "Seat" s
        SET "tableId" = d.keeper_id
        FROM dupes d
        WHERE s."tableId" = d.dupe_id
      `)
      // Move tickets
      await prisma.$executeRawUnsafe(`
        WITH keepers AS (
          SELECT DISTINCT ON ("locationId", "name") "id"
          FROM "Table"
          WHERE "deletedAt" IS NULL
          ORDER BY "locationId", "name", "updatedAt" DESC
        ),
        dupes AS (
          SELECT t."id" AS dupe_id, k."id" AS keeper_id
          FROM "Table" t
          JOIN "Table" k ON t."locationId" = k."locationId" AND t."name" = k."name"
          JOIN keepers k2 ON k2."id" = k."id"
          WHERE t."id" != k."id"
            AND t."deletedAt" IS NULL
            AND k."deletedAt" IS NULL
            AND k."id" = k2."id"
        )
        UPDATE "Ticket" tk
        SET "tableId" = d.keeper_id
        FROM dupes d
        WHERE tk."tableId" = d.dupe_id
      `)
    },
  })

  // ── 2. Section: @@unique([locationId, name]) ──────────────────────────────
  await dedupAndConstrain(prisma, {
    prefix: PREFIX,
    tableName: 'Section',
    indexName: 'Section_locationId_name_key',
    uniqueCols: ['locationId', 'name'],
    preDedup: async () => {
      // Move tables from dupe sections to keeper
      await prisma.$executeRawUnsafe(`
        WITH keepers AS (
          SELECT DISTINCT ON ("locationId", "name") "id"
          FROM "Section"
          WHERE "deletedAt" IS NULL
          ORDER BY "locationId", "name", "updatedAt" DESC
        ),
        dupes AS (
          SELECT s."id" AS dupe_id, k."id" AS keeper_id
          FROM "Section" s
          JOIN "Section" k ON s."locationId" = k."locationId" AND s."name" = k."name"
          JOIN keepers k2 ON k2."id" = k."id"
          WHERE s."id" != k."id"
            AND s."deletedAt" IS NULL
            AND k."deletedAt" IS NULL
            AND k."id" = k2."id"
        )
        UPDATE "Table" t
        SET "sectionId" = d.keeper_id
        FROM dupes d
        WHERE t."sectionId" = d.dupe_id
      `)
      // Move section assignments
      await prisma.$executeRawUnsafe(`
        WITH keepers AS (
          SELECT DISTINCT ON ("locationId", "name") "id"
          FROM "Section"
          WHERE "deletedAt" IS NULL
          ORDER BY "locationId", "name", "updatedAt" DESC
        ),
        dupes AS (
          SELECT s."id" AS dupe_id, k."id" AS keeper_id
          FROM "Section" s
          JOIN "Section" k ON s."locationId" = k."locationId" AND s."name" = k."name"
          JOIN keepers k2 ON k2."id" = k."id"
          WHERE s."id" != k."id"
            AND s."deletedAt" IS NULL
            AND k."deletedAt" IS NULL
            AND k."id" = k2."id"
        )
        UPDATE "SectionAssignment" sa
        SET "sectionId" = d.keeper_id
        FROM dupes d
        WHERE sa."sectionId" = d.dupe_id
      `)
    },
  })

  // ── 3. TaxRule: @@unique([locationId, name]) ──────────────────────────────
  await dedupAndConstrain(prisma, {
    prefix: PREFIX,
    tableName: 'TaxRule',
    indexName: 'TaxRule_locationId_name_key',
    uniqueCols: ['locationId', 'name'],
    // TaxRule has no child FKs — just dedup
  })

  // ── 4. PrintRoute: @@unique([locationId, name]) ───────────────────────────
  await dedupAndConstrain(prisma, {
    prefix: PREFIX,
    tableName: 'PrintRoute',
    indexName: 'PrintRoute_locationId_name_key',
    uniqueCols: ['locationId', 'name'],
    // PrintRoute has no child FKs — just dedup
  })
}

/**
 * Generic dedup + unique constraint helper.
 *
 * 1. Check if index already exists → skip if so
 * 2. Run optional preDedup callback (reassign child FKs)
 * 3. Soft-delete duplicate rows (keep most recently updated)
 * 4. Create the unique index
 */
async function dedupAndConstrain(prisma, { prefix, tableName, indexName, uniqueCols, preDedup }) {
  try {
    const exists = await tableExists(prisma, tableName)
    if (!exists) {
      console.log(`${prefix}   ${tableName} table not found -- skipping`)
      return
    }

    const hasIdx = await indexExists(prisma, indexName)
    if (hasIdx) {
      console.log(`${prefix}   ${tableName} already has ${indexName} -- skipping`)
      return
    }

    console.log(`${prefix}   Deduplicating ${tableName} by (${uniqueCols.join(', ')})...`)

    // Count dupes first
    const colList = uniqueCols.map(c => `"${c}"`).join(', ')
    const dupeCount = await prisma.$queryRawUnsafe(`
      SELECT COUNT(*) as cnt FROM (
        SELECT ${colList}, COUNT(*) as c
        FROM "${tableName}"
        WHERE "deletedAt" IS NULL
        GROUP BY ${colList}
        HAVING COUNT(*) > 1
      ) sub
    `)
    const numDupeGroups = Number(dupeCount[0]?.cnt ?? 0)

    if (numDupeGroups > 0) {
      console.log(`${prefix}   Found ${numDupeGroups} duplicate groups in ${tableName}`)

      // Run pre-dedup FK reassignment
      if (preDedup) {
        await preDedup()
      }

      // Soft-delete duplicates (keep the most recently updated)
      const orderBy = uniqueCols.map(c => `"${c}"`).join(', ')
      await prisma.$executeRawUnsafe(`
        WITH keepers AS (
          SELECT DISTINCT ON (${colList}) "id"
          FROM "${tableName}"
          WHERE "deletedAt" IS NULL
          ORDER BY ${orderBy}, "updatedAt" DESC
        )
        UPDATE "${tableName}"
        SET "deletedAt" = NOW()
        WHERE "id" NOT IN (SELECT "id" FROM keepers)
          AND "deletedAt" IS NULL
          AND EXISTS (
            SELECT 1 FROM "${tableName}" k
            WHERE k."id" IN (SELECT "id" FROM keepers)
              ${uniqueCols.map(c => `AND "${tableName}"."${c}" = k."${c}"`).join('\n              ')}
          )
      `)
    } else {
      console.log(`${prefix}   No duplicates found in ${tableName}`)
    }

    // Hard-delete soft-deleted rows that clash with active rows (same business key)
    await prisma.$executeRawUnsafe(`
      DELETE FROM "${tableName}" d
      WHERE d."deletedAt" IS NOT NULL
        AND EXISTS (
          SELECT 1 FROM "${tableName}" a
          WHERE a."deletedAt" IS NULL
            ${uniqueCols.map(c => `AND a."${c}" = d."${c}"`).join('\n            ')}
        )
    `)

    // Also dedup soft-deleted rows among themselves (keep one per business key)
    await prisma.$executeRawUnsafe(`
      DELETE FROM "${tableName}"
      WHERE "deletedAt" IS NOT NULL
        AND id NOT IN (
          SELECT DISTINCT ON (${colList}) id
          FROM "${tableName}"
          WHERE "deletedAt" IS NOT NULL
          ORDER BY ${colList}, "deletedAt" DESC
        )
    `)

    // Create full unique index (matches Prisma @@unique annotation)
    await prisma.$executeRawUnsafe(`
      CREATE UNIQUE INDEX "${indexName}"
      ON "${tableName}" (${colList})
    `)
    console.log(`${prefix}   Done -- ${tableName} unique constraint added`)
  } catch (err) {
    console.error(`${prefix}   FAILED ${tableName} dedup:`, err.message)
  }
}

module.exports = { up }
