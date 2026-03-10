/**
 * Migration 021: Add unique constraints to Modifier, DiscountRule,
 *                PricingOptionGroup, and PricingOption
 *
 * Same pattern as 020: dedup existing data, reassign child FKs where needed,
 * then create unique indexes matching Prisma @@unique annotations.
 *
 * Prevents sync duplication where NUC and Neon create the same logical entity
 * with different CUIDs.
 */

const { tableExists, indexExists } = require('../migration-helpers')

async function up(prisma) {
  const PREFIX = '[021-dedup-modifier-pricing-discount]'

  // ── 1. Modifier: @@unique([modifierGroupId, name]) ──────────────────────────
  await dedupAndConstrain(prisma, {
    prefix: PREFIX,
    tableName: 'Modifier',
    indexName: 'Modifier_modifierGroupId_name_key',
    uniqueCols: ['modifierGroupId', 'name'],
    preDedup: async () => {
      // Reassign OrderItemModifier references from dupes to keepers
      await prisma.$executeRawUnsafe(`
        WITH keepers AS (
          SELECT DISTINCT ON ("modifierGroupId", "name") "id"
          FROM "Modifier"
          WHERE "deletedAt" IS NULL
          ORDER BY "modifierGroupId", "name", "updatedAt" DESC
        ),
        dupes AS (
          SELECT m."id" AS dupe_id, k."id" AS keeper_id
          FROM "Modifier" m
          JOIN "Modifier" k ON m."modifierGroupId" = k."modifierGroupId" AND m."name" = k."name"
          JOIN keepers k2 ON k2."id" = k."id"
          WHERE m."id" != k."id"
            AND m."deletedAt" IS NULL
            AND k."deletedAt" IS NULL
            AND k."id" = k2."id"
        )
        UPDATE "OrderItemModifier" oim
        SET "modifierId" = d.keeper_id
        FROM dupes d
        WHERE oim."modifierId" = d.dupe_id
      `)
    },
  })

  // ── 2. DiscountRule: @@unique([locationId, name]) ───────────────────────────
  await dedupAndConstrain(prisma, {
    prefix: PREFIX,
    tableName: 'DiscountRule',
    indexName: 'DiscountRule_locationId_name_key',
    uniqueCols: ['locationId', 'name'],
    preDedup: async () => {
      // Reassign OrderDiscount references from dupes to keepers
      await prisma.$executeRawUnsafe(`
        WITH keepers AS (
          SELECT DISTINCT ON ("locationId", "name") "id"
          FROM "DiscountRule"
          WHERE "deletedAt" IS NULL
          ORDER BY "locationId", "name", "updatedAt" DESC
        ),
        dupes AS (
          SELECT d."id" AS dupe_id, k."id" AS keeper_id
          FROM "DiscountRule" d
          JOIN "DiscountRule" k ON d."locationId" = k."locationId" AND d."name" = k."name"
          JOIN keepers k2 ON k2."id" = k."id"
          WHERE d."id" != k."id"
            AND d."deletedAt" IS NULL
            AND k."deletedAt" IS NULL
            AND k."id" = k2."id"
        )
        UPDATE "OrderDiscount" od
        SET "discountRuleId" = dupes.keeper_id
        FROM dupes
        WHERE od."discountRuleId" = dupes.dupe_id
      `)
      // Also reassign OrderItemDiscount
      await prisma.$executeRawUnsafe(`
        WITH keepers AS (
          SELECT DISTINCT ON ("locationId", "name") "id"
          FROM "DiscountRule"
          WHERE "deletedAt" IS NULL
          ORDER BY "locationId", "name", "updatedAt" DESC
        ),
        dupes AS (
          SELECT d."id" AS dupe_id, k."id" AS keeper_id
          FROM "DiscountRule" d
          JOIN "DiscountRule" k ON d."locationId" = k."locationId" AND d."name" = k."name"
          JOIN keepers k2 ON k2."id" = k."id"
          WHERE d."id" != k."id"
            AND d."deletedAt" IS NULL
            AND k."deletedAt" IS NULL
            AND k."id" = k2."id"
        )
        UPDATE "OrderItemDiscount" oid
        SET "discountRuleId" = dupes.keeper_id
        FROM dupes
        WHERE oid."discountRuleId" = dupes.dupe_id
      `)
    },
  })

  // ── 3. PricingOptionGroup: @@unique([menuItemId, name]) ─────────────────────
  await dedupAndConstrain(prisma, {
    prefix: PREFIX,
    tableName: 'PricingOptionGroup',
    indexName: 'PricingOptionGroup_menuItemId_name_key',
    uniqueCols: ['menuItemId', 'name'],
    preDedup: async () => {
      // Reassign PricingOption children from dupe groups to keeper groups
      await prisma.$executeRawUnsafe(`
        WITH keepers AS (
          SELECT DISTINCT ON ("menuItemId", "name") "id"
          FROM "PricingOptionGroup"
          WHERE "deletedAt" IS NULL
          ORDER BY "menuItemId", "name", "updatedAt" DESC
        ),
        dupes AS (
          SELECT g."id" AS dupe_id, k."id" AS keeper_id
          FROM "PricingOptionGroup" g
          JOIN "PricingOptionGroup" k ON g."menuItemId" = k."menuItemId" AND g."name" = k."name"
          JOIN keepers k2 ON k2."id" = k."id"
          WHERE g."id" != k."id"
            AND g."deletedAt" IS NULL
            AND k."deletedAt" IS NULL
            AND k."id" = k2."id"
        )
        UPDATE "PricingOption" po
        SET "groupId" = dupes.keeper_id
        FROM dupes
        WHERE po."groupId" = dupes.dupe_id
      `)
    },
  })

  // ── 4. PricingOption: @@unique([groupId, label]) ────────────────────────────
  await dedupAndConstrain(prisma, {
    prefix: PREFIX,
    tableName: 'PricingOption',
    indexName: 'PricingOption_groupId_label_key',
    uniqueCols: ['groupId', 'label'],
    preDedup: async () => {
      // Reassign OrderItem.pricingOptionId from dupe options to keeper options
      await prisma.$executeRawUnsafe(`
        WITH keepers AS (
          SELECT DISTINCT ON ("groupId", "label") "id"
          FROM "PricingOption"
          WHERE "deletedAt" IS NULL
          ORDER BY "groupId", "label", "updatedAt" DESC
        ),
        dupes AS (
          SELECT o."id" AS dupe_id, k."id" AS keeper_id
          FROM "PricingOption" o
          JOIN "PricingOption" k ON o."groupId" = k."groupId" AND o."label" = k."label"
          JOIN keepers k2 ON k2."id" = k."id"
          WHERE o."id" != k."id"
            AND o."deletedAt" IS NULL
            AND k."deletedAt" IS NULL
            AND k."id" = k2."id"
        )
        UPDATE "OrderItem" oi
        SET "pricingOptionId" = dupes.keeper_id
        FROM dupes
        WHERE oi."pricingOptionId" = dupes.dupe_id
      `)
      // Also reassign PricingOptionInventoryLink
      await prisma.$executeRawUnsafe(`
        WITH keepers AS (
          SELECT DISTINCT ON ("groupId", "label") "id"
          FROM "PricingOption"
          WHERE "deletedAt" IS NULL
          ORDER BY "groupId", "label", "updatedAt" DESC
        ),
        dupes AS (
          SELECT o."id" AS dupe_id, k."id" AS keeper_id
          FROM "PricingOption" o
          JOIN "PricingOption" k ON o."groupId" = k."groupId" AND o."label" = k."label"
          JOIN keepers k2 ON k2."id" = k."id"
          WHERE o."id" != k."id"
            AND o."deletedAt" IS NULL
            AND k."deletedAt" IS NULL
            AND k."id" = k2."id"
        )
        UPDATE "PricingOptionInventoryLink" pol
        SET "pricingOptionId" = dupes.keeper_id
        FROM dupes
        WHERE pol."pricingOptionId" = dupes.dupe_id
      `)
      // Also reassign MenuItemIngredient.pricingOptionId
      await prisma.$executeRawUnsafe(`
        WITH keepers AS (
          SELECT DISTINCT ON ("groupId", "label") "id"
          FROM "PricingOption"
          WHERE "deletedAt" IS NULL
          ORDER BY "groupId", "label", "updatedAt" DESC
        ),
        dupes AS (
          SELECT o."id" AS dupe_id, k."id" AS keeper_id
          FROM "PricingOption" o
          JOIN "PricingOption" k ON o."groupId" = k."groupId" AND o."label" = k."label"
          JOIN keepers k2 ON k2."id" = k."id"
          WHERE o."id" != k."id"
            AND o."deletedAt" IS NULL
            AND k."deletedAt" IS NULL
            AND k."id" = k2."id"
        )
        UPDATE "MenuItemIngredient" mii
        SET "pricingOptionId" = dupes.keeper_id
        FROM dupes
        WHERE mii."pricingOptionId" = dupes.dupe_id
      `)
    },
  })
}

/**
 * Generic dedup + unique constraint helper (same pattern as migration 020).
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
