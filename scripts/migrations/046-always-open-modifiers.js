/**
 * Migration 046: Add alwaysOpenModifiers column to MenuItem
 *
 * Per-item option to force the modifier modal open on tap,
 * even when no required modifiers exist.
 */

const { columnExists } = require('../migration-helpers')

async function up(prisma) {
  const PREFIX = '[046-always-open-modifiers]'

  const exists = await columnExists(prisma, 'MenuItem', 'alwaysOpenModifiers')
  if (exists) {
    console.log(`${PREFIX}   alwaysOpenModifiers column already exists -- skipping`)
    return
  }

  console.log(`${PREFIX}   Adding alwaysOpenModifiers column to MenuItem...`)
  await prisma.$executeRawUnsafe(
    `ALTER TABLE "MenuItem" ADD COLUMN "alwaysOpenModifiers" BOOLEAN NOT NULL DEFAULT false`
  )
  console.log(`${PREFIX}   Done.`)
}

module.exports = { up }
