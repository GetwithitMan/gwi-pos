/**
 * Migration 098 — Loyalty System (Program, Tiers, Transactions)
 *
 * Creates:
 *   LoyaltyProgram — per-location program configuration
 *   LoyaltyTier — tiered rewards within a program
 *   LoyaltyTransaction — full audit trail of point changes
 *
 * Alters Customer:
 *   + loyaltyTierId (FK → LoyaltyTier, nullable)
 *   + lifetimePoints (INT, default 0)
 *   + loyaltyEnrolledAt (TIMESTAMP, nullable)
 *   + loyaltyProgramId (FK → LoyaltyProgram, nullable)
 */

const { tableExists, columnExists, indexExists } = require('../migration-helpers')

module.exports.up = async function up(prisma) {
  const PREFIX = '[098]'

  // ─── 1. LoyaltyProgram table ──────────────────────────────────────────────
  if (!(await tableExists(prisma, 'LoyaltyProgram'))) {
    await prisma.$executeRawUnsafe(`
      CREATE TABLE "LoyaltyProgram" (
        "id" TEXT NOT NULL PRIMARY KEY,
        "locationId" TEXT NOT NULL,
        "name" TEXT NOT NULL DEFAULT 'Loyalty Program',
        "isActive" BOOLEAN NOT NULL DEFAULT true,
        "pointsPerDollar" INTEGER NOT NULL DEFAULT 1,
        "pointValueCents" INTEGER NOT NULL DEFAULT 1,
        "minimumRedeemPoints" INTEGER NOT NULL DEFAULT 100,
        "roundingMode" TEXT NOT NULL DEFAULT 'floor',
        "excludedCategoryIds" TEXT[] DEFAULT '{}',
        "excludedItemTypes" TEXT[] DEFAULT '{}',
        "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "deletedAt" TIMESTAMP(3),
        CONSTRAINT "LoyaltyProgram_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE RESTRICT
      )
    `)
    console.log(`${PREFIX} Created LoyaltyProgram table`)
  } else {
    console.log(`${PREFIX} LoyaltyProgram table already exists`)
  }

  // LoyaltyProgram CHECK constraints
  try {
    await prisma.$executeRawUnsafe(`
      ALTER TABLE "LoyaltyProgram" ADD CONSTRAINT "LoyaltyProgram_roundingMode_check"
      CHECK ("roundingMode" IN ('floor', 'round', 'ceil'))
    `)
    console.log(`${PREFIX} Added LoyaltyProgram_roundingMode_check`)
  } catch {
    console.log(`${PREFIX} LoyaltyProgram_roundingMode_check already exists`)
  }

  try {
    await prisma.$executeRawUnsafe(`
      ALTER TABLE "LoyaltyProgram" ADD CONSTRAINT "LoyaltyProgram_pointsPerDollar_check"
      CHECK ("pointsPerDollar" > 0)
    `)
    console.log(`${PREFIX} Added LoyaltyProgram_pointsPerDollar_check`)
  } catch {
    console.log(`${PREFIX} LoyaltyProgram_pointsPerDollar_check already exists`)
  }

  // LoyaltyProgram indexes
  if (!(await indexExists(prisma, 'LoyaltyProgram_locationId_idx'))) {
    await prisma.$executeRawUnsafe(`CREATE INDEX "LoyaltyProgram_locationId_idx" ON "LoyaltyProgram" ("locationId")`)
    console.log(`${PREFIX} Created LoyaltyProgram_locationId_idx`)
  }

  if (!(await indexExists(prisma, 'LoyaltyProgram_locationId_isActive_idx'))) {
    await prisma.$executeRawUnsafe(`CREATE INDEX "LoyaltyProgram_locationId_isActive_idx" ON "LoyaltyProgram" ("locationId", "isActive") WHERE "isActive" = true`)
    console.log(`${PREFIX} Created LoyaltyProgram_locationId_isActive_idx`)
  }

  // ─── 2. LoyaltyTier table ────────────────────────────────────────────────
  if (!(await tableExists(prisma, 'LoyaltyTier'))) {
    await prisma.$executeRawUnsafe(`
      CREATE TABLE "LoyaltyTier" (
        "id" TEXT NOT NULL PRIMARY KEY,
        "programId" TEXT NOT NULL,
        "name" TEXT NOT NULL,
        "minimumPoints" INTEGER NOT NULL DEFAULT 0,
        "pointsMultiplier" DECIMAL(6,2) NOT NULL DEFAULT 1.0,
        "perks" JSONB DEFAULT '{}',
        "color" TEXT NOT NULL DEFAULT '#6366f1',
        "sortOrder" INTEGER NOT NULL DEFAULT 0,
        "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "deletedAt" TIMESTAMP(3),
        CONSTRAINT "LoyaltyTier_programId_fkey" FOREIGN KEY ("programId") REFERENCES "LoyaltyProgram"("id") ON DELETE CASCADE
      )
    `)
    console.log(`${PREFIX} Created LoyaltyTier table`)
  } else {
    console.log(`${PREFIX} LoyaltyTier table already exists`)
  }

  // LoyaltyTier indexes
  if (!(await indexExists(prisma, 'LoyaltyTier_programId_idx'))) {
    await prisma.$executeRawUnsafe(`CREATE INDEX "LoyaltyTier_programId_idx" ON "LoyaltyTier" ("programId")`)
    console.log(`${PREFIX} Created LoyaltyTier_programId_idx`)
  }

  if (!(await indexExists(prisma, 'LoyaltyTier_programId_sortOrder_idx'))) {
    await prisma.$executeRawUnsafe(`CREATE INDEX "LoyaltyTier_programId_sortOrder_idx" ON "LoyaltyTier" ("programId", "sortOrder")`)
    console.log(`${PREFIX} Created LoyaltyTier_programId_sortOrder_idx`)
  }

  // ─── 3. LoyaltyTransaction table ─────────────────────────────────────────
  if (!(await tableExists(prisma, 'LoyaltyTransaction'))) {
    await prisma.$executeRawUnsafe(`
      CREATE TABLE "LoyaltyTransaction" (
        "id" TEXT NOT NULL PRIMARY KEY,
        "customerId" TEXT NOT NULL,
        "locationId" TEXT NOT NULL,
        "orderId" TEXT,
        "type" TEXT NOT NULL,
        "points" INTEGER NOT NULL,
        "balanceBefore" INTEGER NOT NULL DEFAULT 0,
        "balanceAfter" INTEGER NOT NULL DEFAULT 0,
        "description" TEXT NOT NULL DEFAULT '',
        "employeeId" TEXT,
        "metadata" JSONB,
        "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT "LoyaltyTransaction_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE RESTRICT,
        CONSTRAINT "LoyaltyTransaction_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE RESTRICT,
        CONSTRAINT "LoyaltyTransaction_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE SET NULL
      )
    `)
    console.log(`${PREFIX} Created LoyaltyTransaction table`)
  } else {
    console.log(`${PREFIX} LoyaltyTransaction table already exists`)
  }

  // LoyaltyTransaction CHECK constraint
  try {
    await prisma.$executeRawUnsafe(`
      ALTER TABLE "LoyaltyTransaction" ADD CONSTRAINT "LoyaltyTransaction_type_check"
      CHECK ("type" IN ('earn', 'redeem', 'adjust', 'expire', 'tier_bonus', 'welcome'))
    `)
    console.log(`${PREFIX} Added LoyaltyTransaction_type_check`)
  } catch {
    console.log(`${PREFIX} LoyaltyTransaction_type_check already exists`)
  }

  // LoyaltyTransaction indexes
  if (!(await indexExists(prisma, 'LoyaltyTransaction_customerId_idx'))) {
    await prisma.$executeRawUnsafe(`CREATE INDEX "LoyaltyTransaction_customerId_idx" ON "LoyaltyTransaction" ("customerId")`)
    console.log(`${PREFIX} Created LoyaltyTransaction_customerId_idx`)
  }

  if (!(await indexExists(prisma, 'LoyaltyTransaction_locationId_idx'))) {
    await prisma.$executeRawUnsafe(`CREATE INDEX "LoyaltyTransaction_locationId_idx" ON "LoyaltyTransaction" ("locationId")`)
    console.log(`${PREFIX} Created LoyaltyTransaction_locationId_idx`)
  }

  if (!(await indexExists(prisma, 'LoyaltyTransaction_orderId_idx'))) {
    await prisma.$executeRawUnsafe(`CREATE INDEX "LoyaltyTransaction_orderId_idx" ON "LoyaltyTransaction" ("orderId") WHERE "orderId" IS NOT NULL`)
    console.log(`${PREFIX} Created LoyaltyTransaction_orderId_idx`)
  }

  if (!(await indexExists(prisma, 'LoyaltyTransaction_type_idx'))) {
    await prisma.$executeRawUnsafe(`CREATE INDEX "LoyaltyTransaction_type_idx" ON "LoyaltyTransaction" ("type")`)
    console.log(`${PREFIX} Created LoyaltyTransaction_type_idx`)
  }

  if (!(await indexExists(prisma, 'LoyaltyTransaction_createdAt_idx'))) {
    await prisma.$executeRawUnsafe(`CREATE INDEX "LoyaltyTransaction_createdAt_idx" ON "LoyaltyTransaction" ("createdAt")`)
    console.log(`${PREFIX} Created LoyaltyTransaction_createdAt_idx`)
  }

  if (!(await indexExists(prisma, 'LoyaltyTransaction_customerId_createdAt_idx'))) {
    await prisma.$executeRawUnsafe(`CREATE INDEX "LoyaltyTransaction_customerId_createdAt_idx" ON "LoyaltyTransaction" ("customerId", "createdAt" DESC)`)
    console.log(`${PREFIX} Created LoyaltyTransaction_customerId_createdAt_idx`)
  }

  // ─── 4. Customer — add loyalty fields ─────────────────────────────────────
  if (!(await columnExists(prisma, 'Customer', 'loyaltyTierId'))) {
    await prisma.$executeRawUnsafe(`ALTER TABLE "Customer" ADD COLUMN "loyaltyTierId" TEXT`)
    console.log(`${PREFIX} Added Customer.loyaltyTierId`)
  }

  if (!(await columnExists(prisma, 'Customer', 'lifetimePoints'))) {
    await prisma.$executeRawUnsafe(`ALTER TABLE "Customer" ADD COLUMN "lifetimePoints" INTEGER NOT NULL DEFAULT 0`)
    console.log(`${PREFIX} Added Customer.lifetimePoints`)
  }

  if (!(await columnExists(prisma, 'Customer', 'loyaltyEnrolledAt'))) {
    await prisma.$executeRawUnsafe(`ALTER TABLE "Customer" ADD COLUMN "loyaltyEnrolledAt" TIMESTAMP(3)`)
    console.log(`${PREFIX} Added Customer.loyaltyEnrolledAt`)
  }

  if (!(await columnExists(prisma, 'Customer', 'loyaltyProgramId'))) {
    await prisma.$executeRawUnsafe(`ALTER TABLE "Customer" ADD COLUMN "loyaltyProgramId" TEXT`)
    console.log(`${PREFIX} Added Customer.loyaltyProgramId`)
  }

  // FK constraints for Customer loyalty fields
  try {
    await prisma.$executeRawUnsafe(`
      ALTER TABLE "Customer" ADD CONSTRAINT "Customer_loyaltyTierId_fkey"
      FOREIGN KEY ("loyaltyTierId") REFERENCES "LoyaltyTier"("id") ON DELETE SET NULL
    `)
    console.log(`${PREFIX} Added Customer_loyaltyTierId_fkey`)
  } catch {
    console.log(`${PREFIX} Customer_loyaltyTierId_fkey already exists`)
  }

  try {
    await prisma.$executeRawUnsafe(`
      ALTER TABLE "Customer" ADD CONSTRAINT "Customer_loyaltyProgramId_fkey"
      FOREIGN KEY ("loyaltyProgramId") REFERENCES "LoyaltyProgram"("id") ON DELETE SET NULL
    `)
    console.log(`${PREFIX} Added Customer_loyaltyProgramId_fkey`)
  } catch {
    console.log(`${PREFIX} Customer_loyaltyProgramId_fkey already exists`)
  }

  // Customer loyalty indexes
  if (!(await indexExists(prisma, 'Customer_loyaltyProgramId_idx'))) {
    await prisma.$executeRawUnsafe(`CREATE INDEX "Customer_loyaltyProgramId_idx" ON "Customer" ("loyaltyProgramId") WHERE "loyaltyProgramId" IS NOT NULL`)
    console.log(`${PREFIX} Created Customer_loyaltyProgramId_idx`)
  }

  if (!(await indexExists(prisma, 'Customer_loyaltyTierId_idx'))) {
    await prisma.$executeRawUnsafe(`CREATE INDEX "Customer_loyaltyTierId_idx" ON "Customer" ("loyaltyTierId") WHERE "loyaltyTierId" IS NOT NULL`)
    console.log(`${PREFIX} Created Customer_loyaltyTierId_idx`)
  }

  console.log(`${PREFIX} Migration 098 complete`)
}
