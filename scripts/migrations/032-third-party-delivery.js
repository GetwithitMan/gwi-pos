/**
 * Migration 032: Third-Party Delivery Orders
 *
 * Creates:
 * - ThirdPartyOrder — tracks orders received from DoorDash, UberEats, Grubhub
 *   with lifecycle status, platform metadata, and optional link to POS Order
 */

async function tableExists(prisma, table) {
  const rows = await prisma.$queryRawUnsafe(`
    SELECT 1 FROM information_schema.tables
    WHERE table_name = $1
    LIMIT 1
  `, table)
  return rows.length > 0
}

module.exports.up = async function up(prisma) {
  if (!(await tableExists(prisma, 'ThirdPartyOrder'))) {
    await prisma.$executeRawUnsafe(`
      CREATE TABLE "ThirdPartyOrder" (
        "id"                    TEXT NOT NULL DEFAULT gen_random_uuid()::text,
        "locationId"            TEXT NOT NULL,

        -- Platform identity
        "platform"              TEXT NOT NULL,
        "externalOrderId"       TEXT NOT NULL,
        "externalCustomerName"  TEXT,
        "externalCustomerPhone" TEXT,

        -- Lifecycle status
        "status"                TEXT NOT NULL DEFAULT 'received',

        -- Link to POS order (nullable — linked after acceptance)
        "orderId"               TEXT,

        -- Order data
        "items"                 JSONB NOT NULL DEFAULT '[]'::jsonb,
        "subtotal"              DECIMAL(10,2) NOT NULL DEFAULT 0,
        "tax"                   DECIMAL(10,2) NOT NULL DEFAULT 0,
        "deliveryFee"           DECIMAL(10,2) NOT NULL DEFAULT 0,
        "tip"                   DECIMAL(10,2) NOT NULL DEFAULT 0,
        "total"                 DECIMAL(10,2) NOT NULL DEFAULT 0,

        -- Additional info
        "specialInstructions"   TEXT,
        "estimatedPickupAt"     TIMESTAMP(3),
        "actualPickupAt"        TIMESTAMP(3),

        -- Raw webhook payload for debugging
        "rawPayload"            JSONB,

        -- Timestamps
        "createdAt"             TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updatedAt"             TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "deletedAt"             TIMESTAMP(3),
        "syncedAt"              TIMESTAMP(3),

        CONSTRAINT "ThirdPartyOrder_pkey" PRIMARY KEY ("id"),
        CONSTRAINT "ThirdPartyOrder_locationId_fkey"
          FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE RESTRICT
      )
    `)

    // Unique index on locationId + platform + externalOrderId (prevent duplicate imports)
    await prisma.$executeRawUnsafe(`
      CREATE UNIQUE INDEX "ThirdPartyOrder_loc_platform_extId_key"
      ON "ThirdPartyOrder" ("locationId", "platform", "externalOrderId")
    `)

    // Query indexes
    await prisma.$executeRawUnsafe(`CREATE INDEX "ThirdPartyOrder_locationId_idx" ON "ThirdPartyOrder" ("locationId")`)
    await prisma.$executeRawUnsafe(`CREATE INDEX "ThirdPartyOrder_status_idx" ON "ThirdPartyOrder" ("status")`)
    await prisma.$executeRawUnsafe(`CREATE INDEX "ThirdPartyOrder_platform_idx" ON "ThirdPartyOrder" ("platform")`)
    await prisma.$executeRawUnsafe(`CREATE INDEX "ThirdPartyOrder_orderId_idx" ON "ThirdPartyOrder" ("orderId")`)
    await prisma.$executeRawUnsafe(`CREATE INDEX "ThirdPartyOrder_createdAt_idx" ON "ThirdPartyOrder" ("createdAt")`)

    console.log('[032] Created ThirdPartyOrder table')
  }
}
