/**
 * Customer & Loyalty Effects
 *
 * - Customer stats update (totalSpent, totalOrders, averageTicket, lastVisit)
 * - Loyalty accrual (LoyaltyTransaction creation)
 * - Tier promotion check
 */
import crypto from 'crypto'
import { db } from '@/lib/db'
import { toNumber } from '@/lib/pricing'

// ─── 6. Customer & Loyalty Updates ───────────────────────────────────────────

export function updateCustomerAndLoyalty(
  order: any,
  orderId: string,
  orderIsPaid: boolean,
  shouldUpdateCustomerStats: boolean,
  pointsEarned: number,
  newAverageTicket: number | null,
  loyaltyEarningBase: number,
  loyaltyTierMultiplier: number,
  employeeId: string | null,
): void {
  if (!(orderIsPaid && shouldUpdateCustomerStats && order.customer)) return

  void db.customer.update({
    where: { id: order.customer.id },
    data: {
      ...(pointsEarned > 0 ? { loyaltyPoints: { increment: pointsEarned }, lifetimePoints: { increment: pointsEarned } } : {}),
      totalSpent: { increment: toNumber(order.total ?? 0) },
      totalOrders: { increment: 1 },
      lastVisit: new Date(),
      averageTicket: newAverageTicket!,
      lastMutatedBy: process.env.VERCEL ? 'cloud' : 'local',
    },
  }).catch(err => console.error('Post-ingestion customer/loyalty update failed:', err))

  // Create LoyaltyTransaction record + check tier promotion (fire-and-forget)
  if (pointsEarned > 0) {
    void (async () => {
      try {
        const custId = order.customer!.id
        const currentPoints = Number((order.customer as any).loyaltyPoints ?? 0)
        const currentLifetime = Number((order.customer as any).lifetimePoints ?? 0)
        const txnId = crypto.randomUUID()
        const balAfter = currentPoints + pointsEarned
        const loyaltyDesc = `Earned ${pointsEarned} points on order #${order.orderNumber}${loyaltyTierMultiplier > 1 ? ` (${loyaltyTierMultiplier}x tier)` : ''}`
        const loyaltyEmpId = employeeId || null
        await db.$executeRaw`
          INSERT INTO "LoyaltyTransaction" (
            "id", "customerId", "locationId", "orderId", "type", "points",
            "balanceBefore", "balanceAfter", "description", "employeeId", "createdAt"
          ) VALUES (${txnId}, ${custId}, ${order.locationId}, ${orderId}, 'earn', ${pointsEarned},
          ${currentPoints}, ${balAfter},
          ${loyaltyDesc},
          ${loyaltyEmpId}, NOW())
        `
        // Check tier promotion
        const newLifetime = currentLifetime + pointsEarned
        const custProgramId = (order.customer as any).loyaltyProgramId
        if (custProgramId) {
          const tiers = await db.$queryRaw<Array<{ id: string; name: string; minimumPoints: number }>>`
            SELECT "id", "name", "minimumPoints" FROM "LoyaltyTier"
             WHERE "programId" = ${custProgramId} AND "deletedAt" IS NULL ORDER BY "minimumPoints" DESC
          `
          const currentTierId = (order.customer as any).loyaltyTierId
          for (const tier of tiers) {
            if (newLifetime >= Number(tier.minimumPoints)) {
              if (tier.id !== currentTierId) {
                await db.$executeRaw`
                  UPDATE "Customer" SET "loyaltyTierId" = ${tier.id}, "updatedAt" = NOW() WHERE "id" = ${custId}
                `
              }
              break
            }
          }
        }
      } catch (caughtErr) {
        console.error('Post-ingestion loyalty transaction/tier check failed:', caughtErr)
      }
    })()
  }
}
