#!/usr/bin/env node
/**
 * NUC Pre-Migrate Script
 *
 * Runs pre-push SQL migrations on the local NUC database before `prisma db push`.
 * Mirrors the logic in vercel-build.js but uses @prisma/client (available on NUC)
 * instead of @neondatabase/serverless.
 *
 * Usage: node scripts/nuc-pre-migrate.js
 * Requires: DATABASE_URL in environment (loaded from /opt/gwi-pos/.env by systemd)
 */
const { PrismaClient } = require('@prisma/client')

const PREFIX = '[nuc-pre-migrate]'

async function getLocationId(prisma) {
  // Prefer LOCATION_ID env var (every NUC has this set)
  if (process.env.LOCATION_ID) {
    return process.env.LOCATION_ID
  }
  // Fallback: first location in the database
  const rows = await prisma.$queryRawUnsafe(
    'SELECT id FROM "Location" LIMIT 1'
  )
  if (rows.length > 0) {
    return rows[0].id
  }
  return null
}

async function columnExists(prisma, tableName, columnName) {
  const rows = await prisma.$queryRawUnsafe(
    `SELECT column_name FROM information_schema.columns WHERE table_name = $1 AND column_name = $2`,
    tableName,
    columnName
  )
  return rows.length > 0
}

async function runPrePushMigrations() {
  const prisma = new PrismaClient()

  try {
    console.log(`${PREFIX} Running pre-push migrations...`)

    const locationId = await getLocationId(prisma)
    if (!locationId) {
      console.warn(`${PREFIX} WARNING: No locationId found (no LOCATION_ID env, no Location rows). Backfills may leave NULLs.`)
    }

    // --- Case 1: cloud_event_queue.locationId ---
    try {
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
        console.log(`${PREFIX}   Done — cloud_event_queue.locationId backfilled`)
      }
    } catch (err) {
      console.error(`${PREFIX}   FAILED cloud_event_queue.locationId:`, err.message)
    }

    // --- Case 2: OrderOwnershipEntry.locationId ---
    try {
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
        console.log(`${PREFIX}   Done — OrderOwnershipEntry.locationId backfilled`)
      }
    } catch (err) {
      console.error(`${PREFIX}   FAILED OrderOwnershipEntry.locationId:`, err.message)
    }

    // --- Case 3: OrderOwnershipEntry.deletedAt (nullable, just needs to exist) ---
    try {
      const exists = await columnExists(prisma, 'OrderOwnershipEntry', 'deletedAt')
      if (!exists) {
        console.log(`${PREFIX}   Adding deletedAt to OrderOwnershipEntry...`)
        await prisma.$executeRawUnsafe(
          'ALTER TABLE "OrderOwnershipEntry" ADD COLUMN "deletedAt" TIMESTAMPTZ'
        )
        console.log(`${PREFIX}   Done — OrderOwnershipEntry.deletedAt added`)
      }
    } catch (err) {
      console.error(`${PREFIX}   FAILED OrderOwnershipEntry.deletedAt:`, err.message)
    }

    // --- Case 4: ModifierTemplate.locationId ---
    try {
      const exists = await columnExists(prisma, 'ModifierTemplate', 'locationId')
      if (!exists) {
        console.log(`${PREFIX}   Adding locationId to ModifierTemplate...`)
        await prisma.$executeRawUnsafe(
          'ALTER TABLE "ModifierTemplate" ADD COLUMN "locationId" TEXT'
        )
        // Backfill from parent ModifierGroupTemplate
        await prisma.$executeRawUnsafe(
          `UPDATE "ModifierTemplate" mt SET "locationId" = mgt."locationId" FROM "ModifierGroupTemplate" mgt WHERE mt."templateId" = mgt.id AND mt."locationId" IS NULL`
        )
        // Fallback: any remaining nulls get first location
        await prisma.$executeRawUnsafe(
          `UPDATE "ModifierTemplate" SET "locationId" = (SELECT id FROM "Location" LIMIT 1) WHERE "locationId" IS NULL`
        )
        await prisma.$executeRawUnsafe(
          'ALTER TABLE "ModifierTemplate" ALTER COLUMN "locationId" SET NOT NULL'
        )
        console.log(`${PREFIX}   Done — ModifierTemplate.locationId backfilled`)
      }
    } catch (err) {
      console.error(`${PREFIX}   FAILED ModifierTemplate.locationId:`, err.message)
    }

    // --- Case 5: ModifierTemplate.deletedAt (nullable, just needs to exist) ---
    try {
      const exists = await columnExists(prisma, 'ModifierTemplate', 'deletedAt')
      if (!exists) {
        console.log(`${PREFIX}   Adding deletedAt to ModifierTemplate...`)
        await prisma.$executeRawUnsafe(
          'ALTER TABLE "ModifierTemplate" ADD COLUMN "deletedAt" TIMESTAMPTZ'
        )
        console.log(`${PREFIX}   Done — ModifierTemplate.deletedAt added`)
      }
    } catch (err) {
      console.error(`${PREFIX}   FAILED ModifierTemplate.deletedAt:`, err.message)
    }

    console.log(`${PREFIX} Pre-push migrations complete`)
  } finally {
    await prisma.$disconnect()
  }
}

runPrePushMigrations().catch((err) => {
  console.error(`${PREFIX} Fatal error:`, err.message)
  process.exit(1)
})
