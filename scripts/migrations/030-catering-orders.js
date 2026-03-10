/**
 * Migration 030: Catering Orders
 *
 * Creates:
 * - CateringOrder — dedicated catering order management with status pipeline,
 *   volume pricing, deposits, delivery logistics, and service fee tracking.
 * - CateringOrderItem — line items on a catering order with volume discount tiers
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
  // ── CateringOrder table ──────────────────────────────────────────────────
  if (!(await tableExists(prisma, 'CateringOrder'))) {
    await prisma.$executeRawUnsafe(`
      CREATE TABLE "CateringOrder" (
        "id"              TEXT NOT NULL DEFAULT gen_random_uuid()::text,
        "locationId"      TEXT NOT NULL,

        -- Customer info
        "customerName"    TEXT NOT NULL,
        "customerPhone"   TEXT,
        "customerEmail"   TEXT,
        "customerId"      TEXT,

        -- Event details
        "eventDate"       DATE NOT NULL,
        "eventTime"       TEXT,
        "guestCount"      INT NOT NULL DEFAULT 1,
        "deliveryAddress" TEXT,
        "notes"           TEXT,

        -- Status pipeline: inquiry -> quoted -> confirmed -> in_preparation -> delivered -> completed -> cancelled
        "status"          TEXT NOT NULL DEFAULT 'inquiry',

        -- Financials
        "subtotal"        DECIMAL(10,2) NOT NULL DEFAULT 0,
        "volumeDiscount"  DECIMAL(10,2) NOT NULL DEFAULT 0,
        "serviceFee"      DECIMAL(10,2) NOT NULL DEFAULT 0,
        "deliveryFee"     DECIMAL(10,2) NOT NULL DEFAULT 0,
        "taxTotal"        DECIMAL(10,2) NOT NULL DEFAULT 0,
        "total"           DECIMAL(10,2) NOT NULL DEFAULT 0,

        -- Deposit tracking
        "depositRequired"    DECIMAL(10,2) NOT NULL DEFAULT 0,
        "depositPaid"        DECIMAL(10,2) NOT NULL DEFAULT 0,
        "depositPaidAt"      TIMESTAMP(3),
        "depositPaymentId"   TEXT,

        -- Linked POS order (created when confirmed, for payment pipeline)
        "orderId"         TEXT,

        -- Attribution
        "createdBy"       TEXT,
        "assignedTo"      TEXT,

        -- Timestamps
        "quotedAt"        TIMESTAMP(3),
        "confirmedAt"     TIMESTAMP(3),
        "prepStartedAt"   TIMESTAMP(3),
        "deliveredAt"     TIMESTAMP(3),
        "completedAt"     TIMESTAMP(3),
        "cancelledAt"     TIMESTAMP(3),
        "cancelReason"    TEXT,

        "createdAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updatedAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "deletedAt"       TIMESTAMP(3),
        "syncedAt"        TIMESTAMP(3),

        CONSTRAINT "CateringOrder_pkey" PRIMARY KEY ("id"),
        CONSTRAINT "CateringOrder_locationId_fkey"
          FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE RESTRICT
      )
    `)
    await prisma.$executeRawUnsafe(`CREATE INDEX "CateringOrder_locationId_idx" ON "CateringOrder" ("locationId")`)
    await prisma.$executeRawUnsafe(`CREATE INDEX "CateringOrder_status_idx" ON "CateringOrder" ("status")`)
    await prisma.$executeRawUnsafe(`CREATE INDEX "CateringOrder_eventDate_idx" ON "CateringOrder" ("eventDate")`)
    await prisma.$executeRawUnsafe(`CREATE INDEX "CateringOrder_locationId_status_idx" ON "CateringOrder" ("locationId", "status")`)
    await prisma.$executeRawUnsafe(`CREATE INDEX "CateringOrder_locationId_eventDate_idx" ON "CateringOrder" ("locationId", "eventDate")`)
    await prisma.$executeRawUnsafe(`CREATE INDEX "CateringOrder_orderId_idx" ON "CateringOrder" ("orderId")`)
    console.log('[030] Created CateringOrder table')
  }

  // ── CateringOrderItem table ─────────────────────────────────────────────
  if (!(await tableExists(prisma, 'CateringOrderItem'))) {
    await prisma.$executeRawUnsafe(`
      CREATE TABLE "CateringOrderItem" (
        "id"                  TEXT NOT NULL DEFAULT gen_random_uuid()::text,
        "cateringOrderId"     TEXT NOT NULL,
        "menuItemId"          TEXT,

        -- Item details
        "name"                TEXT NOT NULL,
        "quantity"            INT NOT NULL DEFAULT 1,
        "unitPrice"           DECIMAL(10,2) NOT NULL DEFAULT 0,
        "lineTotal"           DECIMAL(10,2) NOT NULL DEFAULT 0,
        "volumeDiscountPct"   DECIMAL(5,2) NOT NULL DEFAULT 0,
        "discountedLineTotal" DECIMAL(10,2) NOT NULL DEFAULT 0,
        "specialInstructions" TEXT,

        "createdAt"           TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updatedAt"           TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "deletedAt"           TIMESTAMP(3),

        CONSTRAINT "CateringOrderItem_pkey" PRIMARY KEY ("id"),
        CONSTRAINT "CateringOrderItem_cateringOrderId_fkey"
          FOREIGN KEY ("cateringOrderId") REFERENCES "CateringOrder"("id") ON DELETE CASCADE
      )
    `)
    await prisma.$executeRawUnsafe(`CREATE INDEX "CateringOrderItem_cateringOrderId_idx" ON "CateringOrderItem" ("cateringOrderId")`)
    console.log('[030] Created CateringOrderItem table')
  }
}
