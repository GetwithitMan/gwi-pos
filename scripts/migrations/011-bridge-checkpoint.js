/**
 * Migration 011: BridgeCheckpoint table
 *
 * Creates the BridgeCheckpoint table for HA bridge lease management.
 * Each NUC node registers a checkpoint with a lease expiration; the active
 * primary holds the lease and the backup monitors for lease expiry to
 * initiate failover.
 *
 * Schema matches Prisma model:
 *   - id, locationId, nodeId, role, leaseExpiresAt, lastHeartbeat
 *   - lastFulfillmentAt, fulfillmentLag
 *   - Unique constraint on (locationId, nodeId)
 */

const { tableExists } = require('../migration-helpers')

async function up(prisma) {
  const PREFIX = '[011-bridge-checkpoint]'

  try {
    const exists = await tableExists(prisma, 'BridgeCheckpoint')
    if (exists) {
      console.log(`${PREFIX}   BridgeCheckpoint table already exists -- skipping`)
      return
    }

    console.log(`${PREFIX}   Creating BridgeCheckpoint table...`)
    await prisma.$executeRawUnsafe(`
      CREATE TABLE "BridgeCheckpoint" (
        "id"                TEXT NOT NULL,
        "locationId"        TEXT NOT NULL,
        "nodeId"            TEXT NOT NULL,
        "role"              TEXT NOT NULL,
        "leaseExpiresAt"    TIMESTAMPTZ NOT NULL,
        "lastHeartbeat"     TIMESTAMPTZ NOT NULL,
        "lastFulfillmentAt" TIMESTAMPTZ,
        "fulfillmentLag"    INTEGER,
        "createdAt"         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        "updatedAt"         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        CONSTRAINT "BridgeCheckpoint_pkey" PRIMARY KEY ("id"),
        CONSTRAINT "BridgeCheckpoint_locationId_fkey"
          FOREIGN KEY ("locationId") REFERENCES "Location"("id")
          ON DELETE RESTRICT ON UPDATE CASCADE,
        CONSTRAINT "BridgeCheckpoint_locationId_nodeId_key"
          UNIQUE ("locationId", "nodeId")
      )
    `)

    console.log(`${PREFIX}   Done -- BridgeCheckpoint table created`)
  } catch (err) {
    console.error(`${PREFIX}   FAILED BridgeCheckpoint:`, err.message)
  }
}

module.exports = { up }
