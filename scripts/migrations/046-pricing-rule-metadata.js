const { columnExists } = require('../migration-helpers')

async function up(prisma) {
  // Add pricingRuleApplied JSONB column to OrderItem
  const hasPricingRule = await columnExists(prisma, 'OrderItem', 'pricingRuleApplied')
  if (!hasPricingRule) {
    await prisma.$executeRawUnsafe(`
      ALTER TABLE "OrderItem" ADD COLUMN "pricingRuleApplied" JSONB;
    `)
  }

  // Reporting index on ruleId for analytics
  await prisma.$executeRawUnsafe(`
    CREATE INDEX IF NOT EXISTS idx_orderitem_pricingrule_ruleid
      ON "OrderItem" ((("pricingRuleApplied"->>'ruleId')))
      WHERE "pricingRuleApplied" IS NOT NULL;
  `)
}

module.exports = { up }
