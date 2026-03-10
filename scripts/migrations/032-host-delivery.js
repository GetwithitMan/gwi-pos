/**
 * Migration 032: Host Management + Delivery Management
 *
 * Creates:
 * - DeliveryOrder — tracks in-house delivery orders with status pipeline
 * - ServerRotationState — tracks round-robin seating assignment per server
 */

const { tableExists, columnExists, indexExists } = require('../migration-helpers')

module.exports.up = async function up(prisma) {
  const PREFIX = '[032-host-delivery]'

  // ─── DeliveryOrder table ────────────────────────────────────────────────────
  if (!(await tableExists(prisma, 'DeliveryOrder'))) {
    await prisma.$executeRawUnsafe(`
      CREATE TABLE "DeliveryOrder" (
        "id"                TEXT NOT NULL DEFAULT gen_random_uuid()::text,
        "locationId"        TEXT NOT NULL,
        "orderId"           TEXT,
        "employeeId"        TEXT,
        "driverId"          TEXT,
        "customerName"      TEXT NOT NULL,
        "phone"             TEXT,
        "address"           TEXT,
        "addressLine2"      TEXT,
        "city"              TEXT,
        "state"             TEXT,
        "zipCode"           TEXT,
        "notes"             TEXT,
        "status"            TEXT NOT NULL DEFAULT 'pending',
        "deliveryFee"       DECIMAL(10,2) NOT NULL DEFAULT 0,
        "estimatedMinutes"  INTEGER NOT NULL DEFAULT 45,
        "scheduledFor"      TIMESTAMP(3),
        "preparedAt"        TIMESTAMP(3),
        "readyAt"           TIMESTAMP(3),
        "dispatchedAt"      TIMESTAMP(3),
        "deliveredAt"       TIMESTAMP(3),
        "cancelledAt"       TIMESTAMP(3),
        "cancelReason"      TEXT,
        "createdAt"         TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updatedAt"         TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT "DeliveryOrder_pkey" PRIMARY KEY ("id")
      )
    `)
    await prisma.$executeRawUnsafe(`CREATE INDEX "DeliveryOrder_locationId_status_idx" ON "DeliveryOrder" ("locationId", "status")`)
    await prisma.$executeRawUnsafe(`CREATE INDEX "DeliveryOrder_driverId_idx" ON "DeliveryOrder" ("driverId")`)
    await prisma.$executeRawUnsafe(`CREATE INDEX "DeliveryOrder_orderId_idx" ON "DeliveryOrder" ("orderId")`)
    await prisma.$executeRawUnsafe(`CREATE INDEX "DeliveryOrder_locationId_createdAt_idx" ON "DeliveryOrder" ("locationId", "createdAt" DESC)`)
    console.log(`${PREFIX} Created DeliveryOrder table + indexes`)
  } else {
    console.log(`${PREFIX} DeliveryOrder table already exists`)
  }

  // ─── ServerRotationState table ──────────────────────────────────────────────
  if (!(await tableExists(prisma, 'ServerRotationState'))) {
    await prisma.$executeRawUnsafe(`
      CREATE TABLE "ServerRotationState" (
        "id"            TEXT NOT NULL DEFAULT gen_random_uuid()::text,
        "locationId"    TEXT NOT NULL,
        "employeeId"    TEXT NOT NULL,
        "sectionId"     TEXT,
        "tableCount"    INTEGER NOT NULL DEFAULT 0,
        "lastSeatedAt"  TIMESTAMP(3),
        "isOnFloor"     BOOLEAN NOT NULL DEFAULT true,
        "createdAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updatedAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT "ServerRotationState_pkey" PRIMARY KEY ("id"),
        CONSTRAINT "ServerRotationState_locationId_employeeId_key" UNIQUE ("locationId", "employeeId")
      )
    `)
    await prisma.$executeRawUnsafe(`CREATE INDEX "ServerRotationState_locationId_idx" ON "ServerRotationState" ("locationId")`)
    await prisma.$executeRawUnsafe(`CREATE INDEX "ServerRotationState_sectionId_idx" ON "ServerRotationState" ("sectionId")`)
    console.log(`${PREFIX} Created ServerRotationState table + indexes`)
  } else {
    console.log(`${PREFIX} ServerRotationState table already exists`)
  }

  console.log(`${PREFIX} Migration complete`)
}
