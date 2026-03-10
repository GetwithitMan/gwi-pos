/**
 * Migration 010: FulfillmentEvent table
 *
 * Creates the FulfillmentEvent table for hardware fulfillment queue.
 * Used by the HA/cellular bridge to route print/kds/drawer events
 * to the correct NUC node.
 *
 * Schema matches Prisma model:
 *   - id, locationId, orderId, stationId, type, status, payload
 *   - claimedBy/claimedAt (NUC lease), completedAt, failedAt, retryCount
 *   - Indexes on (locationId, status) and (claimedBy, status)
 */

const { tableExists } = require('../migration-helpers')

async function up(prisma) {
  const PREFIX = '[010-fulfillment-event]'

  try {
    const exists = await tableExists(prisma, 'FulfillmentEvent')
    if (exists) {
      console.log(`${PREFIX}   FulfillmentEvent table already exists -- skipping`)
      return
    }

    console.log(`${PREFIX}   Creating FulfillmentEvent table...`)
    await prisma.$executeRawUnsafe(`
      CREATE TABLE "FulfillmentEvent" (
        "id"          TEXT NOT NULL,
        "locationId"  TEXT NOT NULL,
        "orderId"     TEXT NOT NULL,
        "stationId"   TEXT,
        "type"        TEXT NOT NULL,
        "status"      TEXT NOT NULL DEFAULT 'pending',
        "payload"     JSONB,
        "claimedBy"   TEXT,
        "claimedAt"   TIMESTAMPTZ,
        "completedAt" TIMESTAMPTZ,
        "failedAt"    TIMESTAMPTZ,
        "retryCount"  INTEGER NOT NULL DEFAULT 0,
        "createdAt"   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        "updatedAt"   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        CONSTRAINT "FulfillmentEvent_pkey" PRIMARY KEY ("id"),
        CONSTRAINT "FulfillmentEvent_locationId_fkey"
          FOREIGN KEY ("locationId") REFERENCES "Location"("id")
          ON DELETE RESTRICT ON UPDATE CASCADE
      )
    `)

    await prisma.$executeRawUnsafe(
      `CREATE INDEX "FulfillmentEvent_locationId_status_idx" ON "FulfillmentEvent" ("locationId", "status")`
    )
    await prisma.$executeRawUnsafe(
      `CREATE INDEX "FulfillmentEvent_claimedBy_status_idx" ON "FulfillmentEvent" ("claimedBy", "status")`
    )

    console.log(`${PREFIX}   Done -- FulfillmentEvent table + indexes created`)
  } catch (err) {
    console.error(`${PREFIX}   FAILED FulfillmentEvent:`, err.message)
  }
}

module.exports = { up }
