/**
 * Migration 012: OutageQueueEntry table
 *
 * Creates the OutageQueueEntry table for offline mutation queueing.
 * When the NUC loses connectivity to Neon, mutations are written to this
 * local queue and replayed in order when connectivity returns.
 *
 * Schema matches Prisma model:
 *   - id, locationId, tableName, recordId, operation, payload
 *   - localSeq (monotonic), idempotencyKey (unique), status, replayedAt
 *   - Index on (locationId, status)
 */

const { tableExists } = require('../migration-helpers')

async function up(prisma) {
  const PREFIX = '[012-outage-queue]'

  try {
    const exists = await tableExists(prisma, 'OutageQueueEntry')
    if (exists) {
      console.log(`${PREFIX}   OutageQueueEntry table already exists -- skipping`)
      return
    }

    console.log(`${PREFIX}   Creating OutageQueueEntry table...`)
    await prisma.$executeRawUnsafe(`
      CREATE TABLE "OutageQueueEntry" (
        "id"             TEXT NOT NULL,
        "locationId"     TEXT NOT NULL,
        "tableName"      TEXT NOT NULL,
        "recordId"       TEXT NOT NULL,
        "operation"      TEXT NOT NULL,
        "payload"        JSONB NOT NULL,
        "localSeq"       INTEGER NOT NULL,
        "idempotencyKey" TEXT NOT NULL,
        "status"         TEXT NOT NULL DEFAULT 'pending',
        "createdAt"      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        "replayedAt"     TIMESTAMPTZ,
        CONSTRAINT "OutageQueueEntry_pkey" PRIMARY KEY ("id"),
        CONSTRAINT "OutageQueueEntry_idempotencyKey_key" UNIQUE ("idempotencyKey"),
        CONSTRAINT "OutageQueueEntry_locationId_fkey"
          FOREIGN KEY ("locationId") REFERENCES "Location"("id")
          ON DELETE RESTRICT ON UPDATE CASCADE
      )
    `)

    await prisma.$executeRawUnsafe(
      `CREATE INDEX "OutageQueueEntry_locationId_status_idx" ON "OutageQueueEntry" ("locationId", "status")`
    )

    console.log(`${PREFIX}   Done -- OutageQueueEntry table + indexes created`)
  } catch (err) {
    console.error(`${PREFIX}   FAILED OutageQueueEntry:`, err.message)
  }
}

module.exports = { up }
