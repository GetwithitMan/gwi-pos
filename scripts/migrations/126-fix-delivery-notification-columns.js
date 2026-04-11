/**
 * Migration 126 — Fix DeliveryNotification + DeliveryNotificationAttempt missing columns
 *
 * Migration 066 created the tables but omitted columns that the application code
 * writes to / reads from, causing "column n.messageBody does not exist" errors
 * on every retry sweep.
 *
 * DeliveryNotification — adds:
 *   messageBody  TEXT          — the notification content (SMS body / push message)
 *   sentAt       TIMESTAMP(3) — set when notification is successfully delivered
 *
 * DeliveryNotificationAttempt — adds:
 *   sentAt            TIMESTAMP(3) — set when an attempt succeeds
 *   providerMessageId TEXT         — Twilio SID / push message ID
 *   createdAt         TIMESTAMP(3) — code inserts this; table only had attemptedAt
 *
 * Also widens the DeliveryNotification status CHECK to include 'pending_retry'
 * (the retry sweep and notifications.ts both set this status).
 */

const { columnExists, tableExists } = require('../migration-helpers')

const PREFIX = '[migration-126]'

module.exports = { up }

async function up(prisma) {
  // ─── DeliveryNotification fixes ──────────────────────────────────────────

  if (await tableExists(prisma, 'DeliveryNotification')) {
    // 1. messageBody — the SMS/push message content
    if (!(await columnExists(prisma, 'DeliveryNotification', 'messageBody'))) {
      await prisma.$executeRawUnsafe(`
        ALTER TABLE "DeliveryNotification"
        ADD COLUMN "messageBody" TEXT NOT NULL DEFAULT ''
      `)
      console.log(`${PREFIX} Added DeliveryNotification.messageBody`)
    }

    // 2. sentAt — timestamp of successful delivery
    if (!(await columnExists(prisma, 'DeliveryNotification', 'sentAt'))) {
      await prisma.$executeRawUnsafe(`
        ALTER TABLE "DeliveryNotification"
        ADD COLUMN "sentAt" TIMESTAMP(3)
      `)
      console.log(`${PREFIX} Added DeliveryNotification.sentAt`)
    }

    // 3. Widen status CHECK to include 'pending_retry'
    //    Drop the old constraint (named after the column by PG convention) and recreate.
    //    Use a DO block so it doesn't fail if the constraint name differs.
    await prisma.$executeRawUnsafe(`
      DO $$
      DECLARE
        con_name TEXT;
      BEGIN
        SELECT conname INTO con_name
          FROM pg_constraint
         WHERE conrelid = '"DeliveryNotification"'::regclass
           AND contype = 'c'
           AND pg_get_constraintdef(oid) ILIKE '%status%'
         LIMIT 1;

        IF con_name IS NOT NULL THEN
          EXECUTE format('ALTER TABLE "DeliveryNotification" DROP CONSTRAINT %I', con_name);
          ALTER TABLE "DeliveryNotification"
            ADD CONSTRAINT "DeliveryNotification_status_check"
            CHECK ("status" IN ('pending', 'sent', 'delivered', 'failed', 'pending_retry'));
          RAISE NOTICE 'Replaced status CHECK constraint on DeliveryNotification';
        ELSE
          -- No existing constraint — just add one
          BEGIN
            ALTER TABLE "DeliveryNotification"
              ADD CONSTRAINT "DeliveryNotification_status_check"
              CHECK ("status" IN ('pending', 'sent', 'delivered', 'failed', 'pending_retry'));
          EXCEPTION WHEN duplicate_object THEN
            NULL; -- already exists
          END;
        END IF;
      END
      $$
    `)
    console.log(`${PREFIX} Ensured DeliveryNotification status CHECK includes 'pending_retry'`)
  } else {
    console.log(`${PREFIX} DeliveryNotification table does not exist — skipping`)
  }

  // ─── DeliveryNotificationAttempt fixes ───────────────────────────────────

  if (await tableExists(prisma, 'DeliveryNotificationAttempt')) {
    // 1. sentAt — timestamp of successful send
    if (!(await columnExists(prisma, 'DeliveryNotificationAttempt', 'sentAt'))) {
      await prisma.$executeRawUnsafe(`
        ALTER TABLE "DeliveryNotificationAttempt"
        ADD COLUMN "sentAt" TIMESTAMP(3)
      `)
      console.log(`${PREFIX} Added DeliveryNotificationAttempt.sentAt`)
    }

    // 2. providerMessageId — Twilio SID / push ID
    if (!(await columnExists(prisma, 'DeliveryNotificationAttempt', 'providerMessageId'))) {
      await prisma.$executeRawUnsafe(`
        ALTER TABLE "DeliveryNotificationAttempt"
        ADD COLUMN "providerMessageId" TEXT
      `)
      console.log(`${PREFIX} Added DeliveryNotificationAttempt.providerMessageId`)
    }

    // 3. createdAt — code uses INSERT ... "createdAt", but table only had "attemptedAt"
    if (!(await columnExists(prisma, 'DeliveryNotificationAttempt', 'createdAt'))) {
      await prisma.$executeRawUnsafe(`
        ALTER TABLE "DeliveryNotificationAttempt"
        ADD COLUMN "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
      `)
      console.log(`${PREFIX} Added DeliveryNotificationAttempt.createdAt`)
    }
  } else {
    console.log(`${PREFIX} DeliveryNotificationAttempt table does not exist — skipping`)
  }

  console.log(`${PREFIX} Done — delivery notification column fixes applied`)
}
