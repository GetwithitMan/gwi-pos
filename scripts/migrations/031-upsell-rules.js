/**
 * Migration 031: Upsell Rules & Events
 *
 * Creates:
 * - UpsellRule — configurable upsell prompt rules (triggers + suggestions)
 * - UpsellEvent — tracks each time an upsell prompt was shown/accepted/dismissed
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
  // ── UpsellRule table ───────────────────────────────────────────────────
  if (!(await tableExists(prisma, 'UpsellRule'))) {
    await prisma.$executeRawUnsafe(`
      CREATE TABLE "UpsellRule" (
        "id"                  TEXT NOT NULL DEFAULT gen_random_uuid()::text,
        "locationId"          TEXT NOT NULL,

        -- Rule identity
        "name"                TEXT NOT NULL,

        -- Trigger configuration
        -- Types: 'item_added', 'category_match', 'order_total', 'time_of_day', 'no_drink'
        "triggerType"         TEXT NOT NULL,
        "triggerItemId"       TEXT,
        "triggerCategoryId"   TEXT,
        "triggerMinTotal"     DECIMAL(10,2),
        "triggerTimeStart"    TEXT,
        "triggerTimeEnd"      TEXT,
        "triggerDaysOfWeek"   INT[],

        -- Suggestion
        "suggestItemId"       TEXT,
        "suggestCategoryId"   TEXT,
        "message"             TEXT NOT NULL DEFAULT '',

        -- Priority and status
        "priority"            INT NOT NULL DEFAULT 0,
        "isActive"            BOOLEAN NOT NULL DEFAULT true,

        -- Timestamps
        "createdAt"           TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updatedAt"           TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "deletedAt"           TIMESTAMP(3),
        "syncedAt"            TIMESTAMP(3),

        CONSTRAINT "UpsellRule_pkey" PRIMARY KEY ("id"),
        CONSTRAINT "UpsellRule_locationId_fkey"
          FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE RESTRICT
      )
    `)
    await prisma.$executeRawUnsafe(`CREATE INDEX "UpsellRule_locationId_idx" ON "UpsellRule" ("locationId")`)
    await prisma.$executeRawUnsafe(`CREATE INDEX "UpsellRule_locationId_isActive_idx" ON "UpsellRule" ("locationId", "isActive")`)
    await prisma.$executeRawUnsafe(`CREATE INDEX "UpsellRule_triggerType_idx" ON "UpsellRule" ("triggerType")`)
    console.log('[031] Created UpsellRule table')
  }

  // ── UpsellEvent table ──────────────────────────────────────────────────
  if (!(await tableExists(prisma, 'UpsellEvent'))) {
    await prisma.$executeRawUnsafe(`
      CREATE TABLE "UpsellEvent" (
        "id"                TEXT NOT NULL DEFAULT gen_random_uuid()::text,
        "locationId"        TEXT NOT NULL,
        "upsellRuleId"      TEXT NOT NULL,
        "orderId"           TEXT NOT NULL,
        "employeeId"        TEXT,

        -- What was suggested
        "suggestedItemId"   TEXT,
        "suggestedItemName" TEXT,
        "suggestedItemPrice" DECIMAL(10,2),

        -- Outcome: 'shown', 'accepted', 'dismissed'
        "action"            TEXT NOT NULL DEFAULT 'shown',

        -- Revenue impact (filled on accept)
        "addedAmount"       DECIMAL(10,2),

        -- Timestamps
        "createdAt"         TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updatedAt"         TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "deletedAt"         TIMESTAMP(3),
        "syncedAt"          TIMESTAMP(3),

        CONSTRAINT "UpsellEvent_pkey" PRIMARY KEY ("id"),
        CONSTRAINT "UpsellEvent_locationId_fkey"
          FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE RESTRICT,
        CONSTRAINT "UpsellEvent_upsellRuleId_fkey"
          FOREIGN KEY ("upsellRuleId") REFERENCES "UpsellRule"("id") ON DELETE CASCADE
      )
    `)
    await prisma.$executeRawUnsafe(`CREATE INDEX "UpsellEvent_locationId_idx" ON "UpsellEvent" ("locationId")`)
    await prisma.$executeRawUnsafe(`CREATE INDEX "UpsellEvent_upsellRuleId_idx" ON "UpsellEvent" ("upsellRuleId")`)
    await prisma.$executeRawUnsafe(`CREATE INDEX "UpsellEvent_orderId_idx" ON "UpsellEvent" ("orderId")`)
    await prisma.$executeRawUnsafe(`CREATE INDEX "UpsellEvent_action_idx" ON "UpsellEvent" ("action")`)
    await prisma.$executeRawUnsafe(`CREATE INDEX "UpsellEvent_createdAt_idx" ON "UpsellEvent" ("createdAt")`)
    console.log('[031] Created UpsellEvent table')
  }
}
