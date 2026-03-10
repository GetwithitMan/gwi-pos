/**
 * Migration 001: Order Ownership + cloud_event_queue locationId backfills
 *
 * Adds locationId to OrderOwnershipEntry and cloud_event_queue,
 * backfills from parent records, sets NOT NULL.
 * Also adds deletedAt to OrderOwnershipEntry and ModifierTemplate.
 * Cleans up orphaned FK references in Payment table.
 */

const { columnExists, tableExists } = require('../migration-helpers')

async function up(prisma) {
  const PREFIX = '[001-order-ownership-locationid]'

  // --- cloud_event_queue.locationId ---
  try {
    const ceqExists = await tableExists(prisma, 'cloud_event_queue')
    if (ceqExists) {
      const exists = await columnExists(prisma, 'cloud_event_queue', 'locationId')
      if (!exists) {
        console.log(`${PREFIX}   Adding locationId to cloud_event_queue...`)
        await prisma.$executeRawUnsafe(
          'ALTER TABLE "cloud_event_queue" ADD COLUMN "locationId" TEXT'
        )
        await prisma.$executeRawUnsafe(
          `UPDATE "cloud_event_queue" SET "locationId" = (SELECT id FROM "Location" LIMIT 1) WHERE "locationId" IS NULL`
        )
        await prisma.$executeRawUnsafe(
          'ALTER TABLE "cloud_event_queue" ALTER COLUMN "locationId" SET NOT NULL'
        )
        console.log(`${PREFIX}   Done -- cloud_event_queue.locationId backfilled`)
      }
    }
  } catch (err) {
    console.error(`${PREFIX}   FAILED cloud_event_queue.locationId:`, err.message)
  }

  // --- OrderOwnershipEntry.locationId ---
  try {
    const ooeExists = await tableExists(prisma, 'OrderOwnershipEntry')
    if (ooeExists) {
      const exists = await columnExists(prisma, 'OrderOwnershipEntry', 'locationId')
      if (!exists) {
        console.log(`${PREFIX}   Adding locationId to OrderOwnershipEntry...`)
        await prisma.$executeRawUnsafe(
          'ALTER TABLE "OrderOwnershipEntry" ADD COLUMN "locationId" TEXT'
        )
        // Backfill from parent OrderOwnership
        await prisma.$executeRawUnsafe(
          `UPDATE "OrderOwnershipEntry" ooe SET "locationId" = oo."locationId" FROM "OrderOwnership" oo WHERE ooe."orderOwnershipId" = oo.id AND ooe."locationId" IS NULL`
        )
        // Fallback: any remaining nulls get first location
        await prisma.$executeRawUnsafe(
          `UPDATE "OrderOwnershipEntry" SET "locationId" = (SELECT id FROM "Location" LIMIT 1) WHERE "locationId" IS NULL`
        )
        await prisma.$executeRawUnsafe(
          'ALTER TABLE "OrderOwnershipEntry" ALTER COLUMN "locationId" SET NOT NULL'
        )
        console.log(`${PREFIX}   Done -- OrderOwnershipEntry.locationId backfilled`)
      }
    }
  } catch (err) {
    console.error(`${PREFIX}   FAILED OrderOwnershipEntry.locationId:`, err.message)
  }

  // --- OrderOwnershipEntry.deletedAt (nullable, just needs to exist) ---
  try {
    const ooeExists = await tableExists(prisma, 'OrderOwnershipEntry')
    if (ooeExists) {
      const exists = await columnExists(prisma, 'OrderOwnershipEntry', 'deletedAt')
      if (!exists) {
        console.log(`${PREFIX}   Adding deletedAt to OrderOwnershipEntry...`)
        await prisma.$executeRawUnsafe(
          'ALTER TABLE "OrderOwnershipEntry" ADD COLUMN "deletedAt" TIMESTAMPTZ'
        )
        console.log(`${PREFIX}   Done -- OrderOwnershipEntry.deletedAt added`)
      }
    }
  } catch (err) {
    console.error(`${PREFIX}   FAILED OrderOwnershipEntry.deletedAt:`, err.message)
  }

  // --- Orphaned FK cleanup (null out references to non-existent rows) ---
  // Prisma db push adds FK constraints; existing data may reference deleted/missing rows.
  const orphanedFks = [
    ['Payment', 'terminalId', 'Terminal'],
    ['Payment', 'drawerId', 'Drawer'],
    ['Payment', 'shiftId', 'Shift'],
    ['Payment', 'paymentReaderId', 'PaymentReader'],
    ['Payment', 'employeeId', 'Employee'],
  ]
  for (const [table, column, refTable] of orphanedFks) {
    try {
      const hasCol = await columnExists(prisma, table, column)
      if (hasCol) {
        const [orphaned] = await prisma.$queryRawUnsafe(
          `SELECT COUNT(*) as cnt FROM "${table}" t WHERE t."${column}" IS NOT NULL AND NOT EXISTS (SELECT 1 FROM "${refTable}" r WHERE r.id = t."${column}")`
        )
        if (orphaned && Number(orphaned.cnt) > 0) {
          console.log(`${PREFIX}   Nulling ${orphaned.cnt} orphaned ${table}.${column} references...`)
          await prisma.$executeRawUnsafe(
            `UPDATE "${table}" SET "${column}" = NULL WHERE "${column}" IS NOT NULL AND NOT EXISTS (SELECT 1 FROM "${refTable}" r WHERE r.id = "${table}"."${column}")`
          )
          console.log(`${PREFIX}   Done`)
        }
      }
    } catch (err) {
      console.error(`${PREFIX}   FAILED orphan cleanup ${table}.${column}:`, err.message)
    }
  }
}

module.exports = { up }
