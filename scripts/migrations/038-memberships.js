/**
 * Migration 038: Membership Plans + Subscriptions
 *
 * Creates:
 * - MembershipPlan — recurring billing plan templates per location
 * - Membership — customer subscription to a plan (state machine + billing)
 * - MembershipCharge — immutable ledger of all charge attempts
 * - MembershipEvent — append-only audit log per membership
 *
 * Alters:
 * - SavedCard — adds recurringData + tokenType for recurring billing
 */

async function columnExists(prisma, table, column) {
  const rows = await prisma.$queryRawUnsafe(`
    SELECT 1 FROM information_schema.columns
    WHERE table_name = $1 AND column_name = $2
    LIMIT 1
  `, table, column)
  return rows.length > 0
}

async function tableExists(prisma, table) {
  const rows = await prisma.$queryRawUnsafe(`
    SELECT 1 FROM information_schema.tables
    WHERE table_name = $1
    LIMIT 1
  `, table)
  return rows.length > 0
}

module.exports.up = async function up(prisma) {
  // ── MembershipPlan table ──────────────────────────────────────────────────
  if (!(await tableExists(prisma, 'MembershipPlan'))) {
    await prisma.$executeRawUnsafe(`
      CREATE TABLE "MembershipPlan" (
        "id"                TEXT NOT NULL DEFAULT gen_random_uuid()::text,
        "locationId"        TEXT NOT NULL,
        "name"              TEXT NOT NULL,
        "description"       TEXT,
        "price"             DECIMAL(10,2) NOT NULL,
        "billingCycle"      TEXT NOT NULL DEFAULT 'monthly',
        "billingDayOfMonth" INT,
        "billingDayOfWeek"  INT,
        "trialDays"         INT NOT NULL DEFAULT 0,
        "setupFee"          DECIMAL(10,2) NOT NULL DEFAULT 0,
        "benefits"          JSONB,
        "maxMembers"        INT,
        "isActive"          BOOLEAN NOT NULL DEFAULT true,
        "sortOrder"         INT NOT NULL DEFAULT 0,
        "currency"          TEXT NOT NULL DEFAULT 'USD',

        "createdAt"         TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updatedAt"         TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "deletedAt"         TIMESTAMP(3),
        "syncedAt"          TIMESTAMP(3),

        CONSTRAINT "MembershipPlan_pkey" PRIMARY KEY ("id"),
        CONSTRAINT "MembershipPlan_locationId_fkey"
          FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE RESTRICT
      )
    `)
    await prisma.$executeRawUnsafe(`CREATE INDEX "MembershipPlan_locationId_idx" ON "MembershipPlan" ("locationId")`)
    console.log('[038] Created MembershipPlan table')
  }

  // ── Membership table ──────────────────────────────────────────────────────
  if (!(await tableExists(prisma, 'Membership'))) {
    await prisma.$executeRawUnsafe(`
      CREATE TABLE "Membership" (
        "id"                    TEXT NOT NULL DEFAULT gen_random_uuid()::text,
        "locationId"            TEXT NOT NULL,
        "customerId"            TEXT NOT NULL,
        "planId"                TEXT NOT NULL,
        "savedCardId"           TEXT,

        -- Status
        "status"                TEXT NOT NULL DEFAULT 'trial',
        "billingStatus"         TEXT NOT NULL DEFAULT 'current',
        "statusReason"          TEXT,

        -- Billing period
        "currentPeriodStart"    TIMESTAMP(3),
        "currentPeriodEnd"      TIMESTAMP(3),
        "nextBillingDate"       TIMESTAMP(3),
        "trialEndsAt"           TIMESTAMP(3),

        -- Pricing snapshot
        "priceAtSignup"         DECIMAL(10,2),
        "billingCycle"          TEXT,
        "currency"              TEXT NOT NULL DEFAULT 'USD',
        "billingTimezone"       TEXT,

        -- Datacap recurring
        "recurringData"         TEXT,
        "lastToken"             TEXT,

        -- Optimistic locking
        "version"               INT NOT NULL DEFAULT 1,

        -- Lifecycle timestamps
        "startedAt"             TIMESTAMP(3),
        "endedAt"               TIMESTAMP(3),
        "lastChargedAt"         TIMESTAMP(3),
        "lastChargeId"          TEXT,

        -- Retry / dunning
        "failedAttempts"        INT NOT NULL DEFAULT 0,
        "lastFailedAt"          TIMESTAMP(3),
        "lastFailReason"        TEXT,
        "nextRetryAt"           TIMESTAMP(3),

        -- Pause
        "pausedAt"              TIMESTAMP(3),
        "pauseResumeDate"       TIMESTAMP(3),

        -- Cancellation
        "cancelledAt"           TIMESTAMP(3),
        "cancellationReason"    TEXT,
        "cancelAtPeriodEnd"     BOOLEAN NOT NULL DEFAULT false,
        "cancelEffectiveAt"     TIMESTAMP(3),

        -- Billing lock (prevents concurrent charge)
        "billingLockedAt"       TIMESTAMP(3),
        "billingLockId"         TEXT,
        "billingLockExpiresAt"  TIMESTAMP(3),

        -- Attribution
        "enrolledByEmployeeId"  TEXT,

        "createdAt"             TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updatedAt"             TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "deletedAt"             TIMESTAMP(3),
        "syncedAt"              TIMESTAMP(3),

        CONSTRAINT "Membership_pkey" PRIMARY KEY ("id"),
        CONSTRAINT "Membership_locationId_fkey"
          FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE RESTRICT,
        CONSTRAINT "Membership_customerId_fkey"
          FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE RESTRICT,
        CONSTRAINT "Membership_planId_fkey"
          FOREIGN KEY ("planId") REFERENCES "MembershipPlan"("id") ON DELETE RESTRICT,
        CONSTRAINT "Membership_savedCardId_fkey"
          FOREIGN KEY ("savedCardId") REFERENCES "SavedCard"("id") ON DELETE SET NULL
      )
    `)
    // Partial unique: one active membership per customer+plan (soft-delete aware)
    await prisma.$executeRawUnsafe(`
      CREATE UNIQUE INDEX "Membership_loc_cust_plan_active_idx"
      ON "Membership" ("locationId", "customerId", "planId")
      WHERE "deletedAt" IS NULL
    `)
    await prisma.$executeRawUnsafe(`CREATE INDEX "Membership_locationId_nextBillingDate_idx" ON "Membership" ("locationId", "nextBillingDate")`)
    await prisma.$executeRawUnsafe(`CREATE INDEX "Membership_locationId_status_idx" ON "Membership" ("locationId", "status")`)
    console.log('[038] Created Membership table')
  }

  // ── MembershipCharge table (ledger — no deletedAt) ────────────────────────
  if (!(await tableExists(prisma, 'MembershipCharge'))) {
    await prisma.$executeRawUnsafe(`
      CREATE TABLE "MembershipCharge" (
        "id"                        TEXT NOT NULL DEFAULT gen_random_uuid()::text,
        "locationId"                TEXT NOT NULL,
        "membershipId"              TEXT NOT NULL,

        -- Amounts
        "subtotalAmount"            DECIMAL(10,2),
        "taxAmount"                 DECIMAL(10,2),
        "totalAmount"               DECIMAL(10,2),

        -- Status
        "status"                    TEXT NOT NULL DEFAULT 'pending',
        "chargeType"                TEXT NOT NULL,
        "failureType"               TEXT,
        "attemptNumber"             INT NOT NULL DEFAULT 1,
        "retryNumber"               INT NOT NULL DEFAULT 0,

        -- Period
        "periodStart"               TIMESTAMP(3),
        "periodEnd"                 TIMESTAMP(3),

        -- Proration
        "isProrated"                BOOLEAN NOT NULL DEFAULT false,
        "proratedFromAmount"        DECIMAL(10,2),

        -- Datacap response
        "datacapRefNo"              TEXT,
        "datacapAuthCode"           TEXT,
        "datacapToken"              TEXT,
        "recurringDataSent"         TEXT,
        "recurringDataReceived"     TEXT,
        "invoiceNo"                 TEXT,

        -- Decline / error details
        "declineReason"             TEXT,
        "returnCode"                TEXT,
        "processorResponseMessage"  TEXT,

        -- Idempotency
        "idempotencyKey"            TEXT,

        -- Timing
        "requestStartedAt"          TIMESTAMP(3),
        "responseReceivedAt"        TIMESTAMP(3),
        "processedAt"               TIMESTAMP(3),

        "createdAt"                 TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updatedAt"                 TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

        CONSTRAINT "MembershipCharge_pkey" PRIMARY KEY ("id"),
        CONSTRAINT "MembershipCharge_locationId_fkey"
          FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE RESTRICT,
        CONSTRAINT "MembershipCharge_membershipId_fkey"
          FOREIGN KEY ("membershipId") REFERENCES "Membership"("id") ON DELETE RESTRICT
      )
    `)
    await prisma.$executeRawUnsafe(`CREATE UNIQUE INDEX "MembershipCharge_idempotencyKey_idx" ON "MembershipCharge" ("idempotencyKey") WHERE "idempotencyKey" IS NOT NULL`)
    await prisma.$executeRawUnsafe(`CREATE INDEX "MembershipCharge_locationId_idx" ON "MembershipCharge" ("locationId")`)
    await prisma.$executeRawUnsafe(`CREATE INDEX "MembershipCharge_membershipId_idx" ON "MembershipCharge" ("membershipId")`)
    console.log('[038] Created MembershipCharge table')
  }

  // ── MembershipEvent table (append-only audit log) ─────────────────────────
  if (!(await tableExists(prisma, 'MembershipEvent'))) {
    await prisma.$executeRawUnsafe(`
      CREATE TABLE "MembershipEvent" (
        "id"              TEXT NOT NULL DEFAULT gen_random_uuid()::text,
        "locationId"      TEXT NOT NULL,
        "membershipId"    TEXT NOT NULL,
        "eventType"       TEXT NOT NULL,
        "details"         JSONB,
        "employeeId"      TEXT,

        "createdAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

        CONSTRAINT "MembershipEvent_pkey" PRIMARY KEY ("id"),
        CONSTRAINT "MembershipEvent_locationId_fkey"
          FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE RESTRICT,
        CONSTRAINT "MembershipEvent_membershipId_fkey"
          FOREIGN KEY ("membershipId") REFERENCES "Membership"("id") ON DELETE RESTRICT
      )
    `)
    await prisma.$executeRawUnsafe(`CREATE INDEX "MembershipEvent_membershipId_createdAt_idx" ON "MembershipEvent" ("membershipId", "createdAt")`)
    console.log('[038] Created MembershipEvent table')
  }

  // ── Add recurring billing columns to SavedCard ────────────────────────────
  if (!(await columnExists(prisma, 'SavedCard', 'recurringData'))) {
    await prisma.$executeRawUnsafe(`ALTER TABLE "SavedCard" ADD COLUMN "recurringData" TEXT`)
    console.log('[038] Added SavedCard.recurringData')
  }
  if (!(await columnExists(prisma, 'SavedCard', 'tokenType'))) {
    await prisma.$executeRawUnsafe(`ALTER TABLE "SavedCard" ADD COLUMN "tokenType" TEXT DEFAULT 'DC4'`)
    console.log('[038] Added SavedCard.tokenType')
  }
}
