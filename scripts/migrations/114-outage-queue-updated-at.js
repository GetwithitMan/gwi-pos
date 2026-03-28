const { columnExists } = require('../migration-helpers')

module.exports.up = async function up(prisma) {
  if (!(await columnExists(prisma, 'OutageQueueEntry', 'updatedAt'))) {
    await prisma.$executeRawUnsafe(`
      ALTER TABLE "OutageQueueEntry"
      ADD COLUMN "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
    `)
    console.log('[114] Added OutageQueueEntry.updatedAt')
  } else {
    console.log('[114] OutageQueueEntry.updatedAt already exists')
  }
}
