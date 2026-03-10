/**
 * Migration 031: Marketing Campaigns
 *
 * Creates:
 * - MarketingCampaign — email/SMS campaign management with scheduling, segmentation,
 *   and delivery statistics.
 * - MarketingRecipient — per-recipient delivery tracking for each campaign.
 */

const { tableExists, indexExists } = require('../migration-helpers')

module.exports.up = async function up(prisma) {
  // ── MarketingCampaign table ──────────────────────────────────────────────
  if (!(await tableExists(prisma, 'MarketingCampaign'))) {
    await prisma.$executeRawUnsafe(`
      CREATE TABLE "MarketingCampaign" (
        "id"               TEXT NOT NULL DEFAULT gen_random_uuid()::text,
        "locationId"       TEXT NOT NULL,

        -- Campaign definition
        "name"             TEXT NOT NULL,
        "type"             TEXT NOT NULL DEFAULT 'email',
        "subject"          TEXT,
        "body"             TEXT NOT NULL DEFAULT '',
        "segment"          TEXT NOT NULL DEFAULT 'all',

        -- Status pipeline: draft -> scheduled -> sending -> sent -> cancelled
        "status"           TEXT NOT NULL DEFAULT 'draft',
        "scheduledFor"     TIMESTAMPTZ,
        "sentAt"           TIMESTAMPTZ,
        "createdBy"        TEXT,

        -- Delivery stats (denormalized for fast reads)
        "recipientCount"   INT NOT NULL DEFAULT 0,
        "deliveredCount"   INT NOT NULL DEFAULT 0,
        "openCount"        INT NOT NULL DEFAULT 0,
        "clickCount"       INT NOT NULL DEFAULT 0,
        "unsubscribeCount" INT NOT NULL DEFAULT 0,

        -- Timestamps
        "createdAt"        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        "updatedAt"        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        "deletedAt"        TIMESTAMPTZ,

        CONSTRAINT "MarketingCampaign_pkey" PRIMARY KEY ("id")
      )
    `)

    // Index for listing campaigns by location
    await prisma.$executeRawUnsafe(`
      CREATE INDEX "MarketingCampaign_locationId_status_idx"
      ON "MarketingCampaign" ("locationId", "status")
    `)

    console.log('[Migration 031] Created MarketingCampaign table')
  }

  // ── MarketingRecipient table ─────────────────────────────────────────────
  if (!(await tableExists(prisma, 'MarketingRecipient'))) {
    await prisma.$executeRawUnsafe(`
      CREATE TABLE "MarketingRecipient" (
        "id"           TEXT NOT NULL DEFAULT gen_random_uuid()::text,
        "campaignId"   TEXT NOT NULL,
        "customerId"   TEXT NOT NULL,
        "channel"      TEXT NOT NULL DEFAULT 'email',
        "address"      TEXT NOT NULL DEFAULT '',

        -- Status pipeline: pending -> sent -> delivered -> opened -> clicked -> bounced -> unsubscribed
        "status"       TEXT NOT NULL DEFAULT 'pending',
        "sentAt"       TIMESTAMPTZ,
        "deliveredAt"  TIMESTAMPTZ,
        "openedAt"     TIMESTAMPTZ,

        -- Error tracking
        "errorMessage" TEXT,

        -- Timestamps
        "createdAt"    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        "updatedAt"    TIMESTAMPTZ NOT NULL DEFAULT NOW(),

        CONSTRAINT "MarketingRecipient_pkey" PRIMARY KEY ("id"),
        CONSTRAINT "MarketingRecipient_campaignId_fkey"
          FOREIGN KEY ("campaignId") REFERENCES "MarketingCampaign"("id") ON DELETE CASCADE
      )
    `)

    // Primary query index: campaign recipients by status
    await prisma.$executeRawUnsafe(`
      CREATE INDEX "MarketingRecipient_campaignId_status_idx"
      ON "MarketingRecipient" ("campaignId", "status")
    `)

    // Index for customer unsubscribe lookups
    await prisma.$executeRawUnsafe(`
      CREATE INDEX "MarketingRecipient_customerId_idx"
      ON "MarketingRecipient" ("customerId")
    `)

    console.log('[Migration 031] Created MarketingRecipient table')
  }
}
