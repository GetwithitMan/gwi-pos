/**
 * Migration 046: Add showAsHotButton to Modifier table
 *
 * Adds a boolean column for bar hot button display. Modifiers marked as hot buttons
 * render as quick-access buttons in the modifier modal (e.g., Neat, Rocks, Up, Dirty).
 */

const { columnExists } = require('../migration-helpers')

async function up(prisma) {
  const PREFIX = '[046-modifier-hot-button]'

  try {
    const exists = await columnExists(prisma, 'Modifier', 'showAsHotButton')
    if (exists) {
      console.log(`${PREFIX}   showAsHotButton column already exists -- skipping`)
      return
    }

    console.log(`${PREFIX}   Adding showAsHotButton column to Modifier...`)
    await prisma.$executeRawUnsafe(
      `ALTER TABLE "Modifier" ADD COLUMN "showAsHotButton" BOOLEAN NOT NULL DEFAULT false`
    )
    console.log(`${PREFIX}   Done`)
  } catch (err) {
    console.error(`${PREFIX}   FAILED:`, err.message)
    throw err
  }
}

module.exports = { up }
