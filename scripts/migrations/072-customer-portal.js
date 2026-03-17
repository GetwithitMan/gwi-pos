/**
 * Migration 072 — Customer Portal Sessions
 *
 * Creates: CustomerPortalSession (OTP-based auth for cake order customer portal)
 * Indexes: locationId, customerId, sessionToken (unique partial), otpExpiresAt
 */

const { tableExists, indexExists } = require('../migration-helpers')

module.exports.up = async function up(prisma) {
  const PREFIX = '[migration-072]'

  // ─── 1. CustomerPortalSession table ──────────────────────────────────────
  if (!(await tableExists(prisma, 'CustomerPortalSession'))) {
    await prisma.$executeRawUnsafe(`
      CREATE TABLE "CustomerPortalSession" (
        "id" TEXT NOT NULL PRIMARY KEY,
        "locationId" TEXT NOT NULL,
        "customerId" TEXT NOT NULL,
        "phone" TEXT,
        "email" TEXT,
        "otpHash" TEXT,
        "otpExpiresAt" TIMESTAMP(3),
        "sessionToken" TEXT,
        "sessionExpiresAt" TIMESTAMP(3),
        "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT "CustomerPortalSession_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE RESTRICT,
        CONSTRAINT "CustomerPortalSession_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE RESTRICT
      )
    `)
    console.log(`${PREFIX} Created CustomerPortalSession table`)
  } else {
    console.log(`${PREFIX} CustomerPortalSession already exists`)
  }

  // ─── 2. Indexes ──────────────────────────────────────────────────────────
  const indexes = [
    { name: 'CustomerPortalSession_locationId_idx', sql: `CREATE INDEX "CustomerPortalSession_locationId_idx" ON "CustomerPortalSession" ("locationId")` },
    { name: 'CustomerPortalSession_customerId_idx', sql: `CREATE INDEX "CustomerPortalSession_customerId_idx" ON "CustomerPortalSession" ("customerId")` },
    { name: 'CustomerPortalSession_sessionToken_key', sql: `CREATE UNIQUE INDEX "CustomerPortalSession_sessionToken_key" ON "CustomerPortalSession" ("sessionToken") WHERE "sessionToken" IS NOT NULL` },
    { name: 'CustomerPortalSession_otpExpiresAt_idx', sql: `CREATE INDEX "CustomerPortalSession_otpExpiresAt_idx" ON "CustomerPortalSession" ("otpExpiresAt")` },
  ]
  for (const idx of indexes) {
    if (!(await indexExists(prisma, idx.name))) {
      await prisma.$executeRawUnsafe(idx.sql)
      console.log(`${PREFIX} Created ${idx.name}`)
    }
  }

  console.log(`${PREFIX} Migration 072 complete`)
}
