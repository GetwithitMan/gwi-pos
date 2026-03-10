const { columnExists } = require('../migration-helpers')

async function up(prisma) {
  const PREFIX = '[022-outage-queue-metadata]'

  const hasCol = await columnExists(prisma, 'OutageQueueEntry', 'metadata')
  if (hasCol) {
    console.log(`${PREFIX} metadata column already exists — skipping`)
    return
  }

  await prisma.$executeRawUnsafe(`
    ALTER TABLE "OutageQueueEntry" ADD COLUMN "metadata" JSONB
  `)
  console.log(`${PREFIX} Added metadata column to OutageQueueEntry`)
}

module.exports = { up }
