/**
 * Migration 002: ModifierTemplate locationId + deletedAt
 *
 * Adds locationId to ModifierTemplate, backfills from parent ModifierGroupTemplate,
 * sets NOT NULL. Also adds nullable deletedAt column.
 */

const { columnExists, tableExists } = require('../migration-helpers')

async function up(prisma) {
  const PREFIX = '[002-modifier-template-locationid]'

  // --- ModifierTemplate.locationId ---
  try {
    const mtExists = await tableExists(prisma, 'ModifierTemplate')
    if (!mtExists) {
      console.log(`${PREFIX}   ModifierTemplate table not found -- skipping`)
      return
    }
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
      console.log(`${PREFIX}   Done -- ModifierTemplate.locationId backfilled`)
    }
  } catch (err) {
    console.error(`${PREFIX}   FAILED ModifierTemplate.locationId:`, err.message)
  }

  // --- ModifierTemplate.deletedAt (nullable, just needs to exist) ---
  try {
    const exists = await columnExists(prisma, 'ModifierTemplate', 'deletedAt')
    if (!exists) {
      console.log(`${PREFIX}   Adding deletedAt to ModifierTemplate...`)
      await prisma.$executeRawUnsafe(
        'ALTER TABLE "ModifierTemplate" ADD COLUMN "deletedAt" TIMESTAMPTZ'
      )
      console.log(`${PREFIX}   Done -- ModifierTemplate.deletedAt added`)
    }
  } catch (err) {
    console.error(`${PREFIX}   FAILED ModifierTemplate.deletedAt:`, err.message)
  }
}

module.exports = { up }
