/**
 * Migration 077: Row-Versioned Conflict Handling
 *
 * Adds a syncVersion INTEGER column to all protected bidirectional models.
 * Used by the quarantine system for deterministic conflict detection
 * instead of timestamp comparison (which is subject to NTP drift).
 *
 * syncVersion starts at 0. The upstream sync worker increments it by 1
 * before each upload, so the local version is always higher than what
 * Neon has when local mutations happen.
 */

/** @param {import('@prisma/client').PrismaClient} prisma */
export async function up(prisma) {
  const models = ['Order', 'OrderItem', 'Payment', 'OrderDiscount', 'OrderCard', 'OrderItemModifier']
  for (const model of models) {
    const colExists = await prisma.$queryRawUnsafe(`
      SELECT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = '${model}' AND column_name = 'syncVersion') as exists
    `)
    if (!colExists[0]?.exists) {
      await prisma.$executeRawUnsafe(`ALTER TABLE "${model}" ADD COLUMN "syncVersion" INTEGER NOT NULL DEFAULT 0`)
      console.log(`[Migration 077] Added syncVersion to ${model}`)
    }
  }
}
