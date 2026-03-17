/**
 * Migration 073 — Loyalty Rewards
 *
 * Creates: LoyaltyReward (configurable reward catalog per location)
 *          LoyaltyRedemption (tracks customer redemptions against orders/cake orders)
 * CHECK constraints on rewardType, pointCost, status
 * Indexes for all FK columns + query-hot columns
 */

const { tableExists, indexExists } = require('../migration-helpers')

module.exports.up = async function up(prisma) {
  const PREFIX = '[migration-073]'

  // ─── 1. LoyaltyReward table ─────────────────────────────────────────────
  if (!(await tableExists(prisma, 'LoyaltyReward'))) {
    await prisma.$executeRawUnsafe(`
      CREATE TABLE "LoyaltyReward" (
        "id" TEXT NOT NULL PRIMARY KEY,
        "locationId" TEXT NOT NULL,
        "name" TEXT NOT NULL,
        "description" TEXT,
        "imageUrl" TEXT,
        "pointCost" INTEGER NOT NULL,
        "rewardType" TEXT NOT NULL DEFAULT 'custom',
        "rewardValue" JSONB DEFAULT '{}',
        "applicableTo" JSONB DEFAULT '["pos","cake"]',
        "maxRedemptionsPerCustomer" INTEGER DEFAULT 0,
        "totalAvailable" INTEGER DEFAULT 0,
        "totalRedeemed" INTEGER DEFAULT 0,
        "startsAt" TIMESTAMP(3),
        "expiresAt" TIMESTAMP(3),
        "isActive" BOOLEAN DEFAULT true,
        "sortOrder" INTEGER DEFAULT 0,
        "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "deletedAt" TIMESTAMP(3),
        CONSTRAINT "LoyaltyReward_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE RESTRICT
      )
    `)
    console.log(`${PREFIX} Created LoyaltyReward table`)
  } else {
    console.log(`${PREFIX} LoyaltyReward table already exists`)
  }

  // ─── 2. LoyaltyReward CHECK constraints ─────────────────────────────────
  try {
    await prisma.$executeRawUnsafe(`
      ALTER TABLE "LoyaltyReward" ADD CONSTRAINT "LoyaltyReward_rewardType_check"
      CHECK ("rewardType" IN ('free_item','discount_percent','discount_fixed','free_delivery','custom'))
    `)
    console.log(`${PREFIX} Added LoyaltyReward_rewardType_check`)
  } catch {
    console.log(`${PREFIX} LoyaltyReward_rewardType_check already exists`)
  }

  try {
    await prisma.$executeRawUnsafe(`
      ALTER TABLE "LoyaltyReward" ADD CONSTRAINT "LoyaltyReward_pointCost_check"
      CHECK ("pointCost" > 0)
    `)
    console.log(`${PREFIX} Added LoyaltyReward_pointCost_check`)
  } catch {
    console.log(`${PREFIX} LoyaltyReward_pointCost_check already exists`)
  }

  // ─── 3. LoyaltyReward indexes ───────────────────────────────────────────
  if (!(await indexExists(prisma, 'LoyaltyReward_locationId_idx'))) {
    await prisma.$executeRawUnsafe(`CREATE INDEX "LoyaltyReward_locationId_idx" ON "LoyaltyReward" ("locationId")`)
    console.log(`${PREFIX} Created LoyaltyReward_locationId_idx`)
  }

  if (!(await indexExists(prisma, 'LoyaltyReward_isActive_idx'))) {
    await prisma.$executeRawUnsafe(`CREATE INDEX "LoyaltyReward_isActive_idx" ON "LoyaltyReward" ("isActive") WHERE "isActive" = true`)
    console.log(`${PREFIX} Created LoyaltyReward_isActive_idx`)
  }

  if (!(await indexExists(prisma, 'LoyaltyReward_sortOrder_idx'))) {
    await prisma.$executeRawUnsafe(`CREATE INDEX "LoyaltyReward_sortOrder_idx" ON "LoyaltyReward" ("sortOrder")`)
    console.log(`${PREFIX} Created LoyaltyReward_sortOrder_idx`)
  }

  // ─── 4. LoyaltyRedemption table ─────────────────────────────────────────
  if (!(await tableExists(prisma, 'LoyaltyRedemption'))) {
    await prisma.$executeRawUnsafe(`
      CREATE TABLE "LoyaltyRedemption" (
        "id" TEXT NOT NULL PRIMARY KEY,
        "locationId" TEXT NOT NULL,
        "customerId" TEXT NOT NULL,
        "rewardId" TEXT NOT NULL,
        "pointsSpent" INTEGER NOT NULL,
        "orderId" TEXT,
        "cakeOrderId" TEXT,
        "status" TEXT DEFAULT 'pending',
        "redemptionCode" TEXT NOT NULL,
        "redeemedAt" TIMESTAMP(3),
        "appliedAt" TIMESTAMP(3),
        "expiresAt" TIMESTAMP(3),
        "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT "LoyaltyRedemption_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE RESTRICT,
        CONSTRAINT "LoyaltyRedemption_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE RESTRICT,
        CONSTRAINT "LoyaltyRedemption_rewardId_fkey" FOREIGN KEY ("rewardId") REFERENCES "LoyaltyReward"("id") ON DELETE RESTRICT,
        CONSTRAINT "LoyaltyRedemption_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE SET NULL,
        CONSTRAINT "LoyaltyRedemption_cakeOrderId_fkey" FOREIGN KEY ("cakeOrderId") REFERENCES "CakeOrder"("id") ON DELETE SET NULL
      )
    `)
    console.log(`${PREFIX} Created LoyaltyRedemption table`)
  } else {
    console.log(`${PREFIX} LoyaltyRedemption table already exists`)
  }

  // ─── 5. LoyaltyRedemption CHECK constraint ──────────────────────────────
  try {
    await prisma.$executeRawUnsafe(`
      ALTER TABLE "LoyaltyRedemption" ADD CONSTRAINT "LoyaltyRedemption_status_check"
      CHECK ("status" IN ('pending','applied','expired','cancelled'))
    `)
    console.log(`${PREFIX} Added LoyaltyRedemption_status_check`)
  } catch {
    console.log(`${PREFIX} LoyaltyRedemption_status_check already exists`)
  }

  // ─── 6. LoyaltyRedemption UNIQUE constraint ─────────────────────────────
  if (!(await indexExists(prisma, 'LoyaltyRedemption_redemptionCode_key'))) {
    await prisma.$executeRawUnsafe(`CREATE UNIQUE INDEX "LoyaltyRedemption_redemptionCode_key" ON "LoyaltyRedemption" ("redemptionCode")`)
    console.log(`${PREFIX} Created LoyaltyRedemption_redemptionCode_key`)
  }

  // ─── 7. LoyaltyRedemption indexes ───────────────────────────────────────
  if (!(await indexExists(prisma, 'LoyaltyRedemption_locationId_idx'))) {
    await prisma.$executeRawUnsafe(`CREATE INDEX "LoyaltyRedemption_locationId_idx" ON "LoyaltyRedemption" ("locationId")`)
    console.log(`${PREFIX} Created LoyaltyRedemption_locationId_idx`)
  }

  if (!(await indexExists(prisma, 'LoyaltyRedemption_customerId_idx'))) {
    await prisma.$executeRawUnsafe(`CREATE INDEX "LoyaltyRedemption_customerId_idx" ON "LoyaltyRedemption" ("customerId")`)
    console.log(`${PREFIX} Created LoyaltyRedemption_customerId_idx`)
  }

  if (!(await indexExists(prisma, 'LoyaltyRedemption_rewardId_idx'))) {
    await prisma.$executeRawUnsafe(`CREATE INDEX "LoyaltyRedemption_rewardId_idx" ON "LoyaltyRedemption" ("rewardId")`)
    console.log(`${PREFIX} Created LoyaltyRedemption_rewardId_idx`)
  }

  if (!(await indexExists(prisma, 'LoyaltyRedemption_status_idx'))) {
    await prisma.$executeRawUnsafe(`CREATE INDEX "LoyaltyRedemption_status_idx" ON "LoyaltyRedemption" ("status")`)
    console.log(`${PREFIX} Created LoyaltyRedemption_status_idx`)
  }

  if (!(await indexExists(prisma, 'LoyaltyRedemption_expiresAt_idx'))) {
    await prisma.$executeRawUnsafe(`CREATE INDEX "LoyaltyRedemption_expiresAt_idx" ON "LoyaltyRedemption" ("expiresAt")`)
    console.log(`${PREFIX} Created LoyaltyRedemption_expiresAt_idx`)
  }

  console.log(`${PREFIX} Migration 073 complete`)
}
