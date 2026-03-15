// Add version field to InventoryItem for optimistic concurrency control
// Used by liquor inventory deduction to prevent race conditions

const { columnExists } = require('../migration-helpers')

async function up(prisma) {
  const hasVersion = await columnExists(prisma, 'InventoryItem', 'version')
  if (!hasVersion) {
    await prisma.$executeRawUnsafe(
      `ALTER TABLE "InventoryItem" ADD COLUMN "version" INTEGER NOT NULL DEFAULT 0`
    )
    console.log('[migration-061] Added version column to InventoryItem')
  } else {
    console.log('[migration-061] InventoryItem.version already exists, skipping')
  }
}

module.exports = { up }
