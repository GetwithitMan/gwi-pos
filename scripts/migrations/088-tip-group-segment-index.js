const { indexExists } = require('../migration-helpers')

async function up(prisma) {
  if (!(await indexExists(prisma, 'idx_tip_group_segment_group_started'))) {
    await prisma.$executeRawUnsafe(`
      CREATE INDEX "idx_tip_group_segment_group_started"
      ON "TipGroupSegment" ("groupId", "startedAt" DESC)
      WHERE "deletedAt" IS NULL
    `)
  }
}

module.exports = { up }
