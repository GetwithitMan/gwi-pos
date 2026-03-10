const { tableExists } = require('../migration-helpers')

async function up(prisma) {
  const PREFIX = '[026-outage-queue-bigint]'

  const exists = await tableExists(prisma, 'OutageQueueEntry')
  if (!exists) {
    console.log(`${PREFIX} OutageQueueEntry table does not exist — skipping`)
    return
  }

  // Change localSeq from INTEGER to BIGINT for future safety
  try {
    await prisma.$executeRawUnsafe(`ALTER TABLE "OutageQueueEntry" ALTER COLUMN "localSeq" TYPE BIGINT`)
    console.log(`${PREFIX} localSeq changed to BIGINT`)
  } catch (err) {
    if (err.message?.includes('already')) {
      console.log(`${PREFIX} localSeq already BIGINT — skipping`)
    } else {
      console.error(`${PREFIX} FAILED:`, err.message)
    }
  }
}

module.exports = { up }
