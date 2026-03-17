/**
 * Migration 070 — Cake Ordering Foundation
 *
 * Creates: CakeOrder, CakeQuote, CakePayment, CakeOrderChange
 * Alters: Customer (phoneNormalized, emailNormalized), Location (nextCakeOrderNumber)
 * Seeds: cake_deposit_settlement + cake_balance_settlement OrderTypes per Location
 * Adds: Financial recalculation trigger on CakePayment
 * Adds: CHECK constraints, indexes, partial unique indexes
 */

const { tableExists, columnExists, indexExists } = require('../migration-helpers')

module.exports.up = async function up(prisma) {
  const PREFIX = '[migration-070]'

  // ─── 1. CakeOrder table ───────────────────────────────────────────────────────
  if (!(await tableExists(prisma, 'CakeOrder'))) {
    await prisma.$executeRawUnsafe(`
      CREATE TABLE "CakeOrder" (
        "id" TEXT NOT NULL PRIMARY KEY,
        "locationId" TEXT NOT NULL REFERENCES "Location"("id"),
        "orderNumber" INTEGER,
        "customerId" TEXT REFERENCES "Customer"("id"),
        "eventDate" DATE,
        "eventTimeStart" TEXT,
        "eventTimeEnd" TEXT,
        "eventType" TEXT,
        "guestCount" INTEGER,
        "deliveryType" TEXT,
        "deliveryAddress" TEXT,
        "deliveryMiles" DECIMAL,
        "deliveryFee" DECIMAL(10,2) NOT NULL DEFAULT 0,
        "cakeConfig" JSONB,
        "designConfig" JSONB,
        "dietaryConfig" JSONB,
        "pricingInputs" JSONB,
        "subtotal" DECIMAL(10,2) NOT NULL DEFAULT 0,
        "rushFee" DECIMAL(10,2) NOT NULL DEFAULT 0,
        "setupFee" DECIMAL(10,2) NOT NULL DEFAULT 0,
        "dietarySurcharge" DECIMAL(10,2) NOT NULL DEFAULT 0,
        "discountAmount" DECIMAL(10,2) NOT NULL DEFAULT 0,
        "discountReason" TEXT,
        "taxTotal" DECIMAL(10,2) NOT NULL DEFAULT 0,
        "total" DECIMAL(10,2) NOT NULL DEFAULT 0,
        "depositRequired" DECIMAL(10,2) NOT NULL DEFAULT 0,
        "depositPaid" DECIMAL(10,2) NOT NULL DEFAULT 0,
        "balanceDue" DECIMAL(10,2) NOT NULL DEFAULT 0,
        "customerOriginal" JSONB,
        "adminCurrent" JSONB,
        "status" TEXT NOT NULL DEFAULT 'submitted',
        "submissionToken" TEXT,
        "createdBy" TEXT REFERENCES "Employee"("id"),
        "assignedTo" TEXT REFERENCES "Employee"("id"),
        "source" TEXT NOT NULL DEFAULT 'public_form',
        "posSettlementOrderIds" JSONB NOT NULL DEFAULT '[]',
        "capacityWeightSnapshot" INTEGER NOT NULL DEFAULT 1,
        "notes" TEXT,
        "internalNotes" TEXT,
        "submittedAt" TIMESTAMP(3),
        "quotedAt" TIMESTAMP(3),
        "approvedAt" TIMESTAMP(3),
        "depositPaidAt" TIMESTAMP(3),
        "productionStartedAt" TIMESTAMP(3),
        "readyAt" TIMESTAMP(3),
        "deliveredAt" TIMESTAMP(3),
        "completedAt" TIMESTAMP(3),
        "cancelledAt" TIMESTAMP(3),
        "cancelReason" TEXT,
        "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "deletedAt" TIMESTAMP(3),
        "syncedAt" TIMESTAMP(3)
      )
    `)
    console.log(`${PREFIX} Created CakeOrder table`)
  } else {
    console.log(`${PREFIX} CakeOrder table already exists`)
  }

  // ─── 2. CakeQuote table ───────────────────────────────────────────────────────
  if (!(await tableExists(prisma, 'CakeQuote'))) {
    await prisma.$executeRawUnsafe(`
      CREATE TABLE "CakeQuote" (
        "id" TEXT NOT NULL PRIMARY KEY,
        "cakeOrderId" TEXT NOT NULL REFERENCES "CakeOrder"("id") ON DELETE CASCADE,
        "version" INTEGER NOT NULL,
        "status" TEXT NOT NULL DEFAULT 'draft',
        "lineItems" JSONB,
        "pricingInputsSnapshot" JSONB,
        "subtotal" DECIMAL(10,2) NOT NULL DEFAULT 0,
        "discountAmount" DECIMAL(10,2) NOT NULL DEFAULT 0,
        "discountReason" TEXT,
        "taxTotal" DECIMAL(10,2) NOT NULL DEFAULT 0,
        "total" DECIMAL(10,2) NOT NULL DEFAULT 0,
        "depositAmount" DECIMAL(10,2) NOT NULL DEFAULT 0,
        "validUntilDate" DATE,
        "sentAt" TIMESTAMP(3),
        "approvedAt" TIMESTAMP(3),
        "voidedAt" TIMESTAMP(3),
        "voidReason" TEXT,
        "createdBy" TEXT REFERENCES "Employee"("id"),
        "forfeitDaysBeforeSnapshot" INTEGER,
        "depositForfeitPercentSnapshot" INTEGER,
        "lateCancelPolicyTextSnapshot" TEXT,
        "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
      )
    `)
    console.log(`${PREFIX} Created CakeQuote table`)
  } else {
    console.log(`${PREFIX} CakeQuote table already exists`)
  }

  // ─── 3. CakePayment table ────────────────────────────────────────────────────
  if (!(await tableExists(prisma, 'CakePayment'))) {
    await prisma.$executeRawUnsafe(`
      CREATE TABLE "CakePayment" (
        "id" TEXT NOT NULL PRIMARY KEY,
        "cakeOrderId" TEXT NOT NULL REFERENCES "CakeOrder"("id"),
        "type" TEXT NOT NULL,
        "appliedTo" TEXT NOT NULL,
        "paymentSource" TEXT NOT NULL,
        "amount" DECIMAL(10,2) NOT NULL,
        "method" TEXT NOT NULL,
        "posPaymentId" TEXT REFERENCES "Payment"("id"),
        "posOrderId" TEXT REFERENCES "Order"("id"),
        "reversesCakePaymentId" TEXT REFERENCES "CakePayment"("id"),
        "reference" TEXT,
        "notes" TEXT,
        "processedBy" TEXT REFERENCES "Employee"("id"),
        "processedAt" TIMESTAMP(3),
        "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
      )
    `)
    console.log(`${PREFIX} Created CakePayment table`)
  } else {
    console.log(`${PREFIX} CakePayment table already exists`)
  }

  // ─── 4. CakeOrderChange table ────────────────────────────────────────────────
  if (!(await tableExists(prisma, 'CakeOrderChange'))) {
    await prisma.$executeRawUnsafe(`
      CREATE TABLE "CakeOrderChange" (
        "id" TEXT NOT NULL PRIMARY KEY DEFAULT gen_random_uuid()::text,
        "cakeOrderId" TEXT NOT NULL REFERENCES "CakeOrder"("id") ON DELETE CASCADE,
        "employeeId" TEXT REFERENCES "Employee"("id"),
        "changeType" TEXT NOT NULL,
        "section" TEXT,
        "previousValue" JSONB,
        "newValue" JSONB,
        "reason" TEXT,
        "source" TEXT NOT NULL DEFAULT 'admin',
        "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
      )
    `)
    console.log(`${PREFIX} Created CakeOrderChange table`)
  } else {
    console.log(`${PREFIX} CakeOrderChange table already exists`)
  }

  // ─── 5. ALTER Customer — phoneNormalized + emailNormalized ────────────────────
  if (!(await columnExists(prisma, 'Customer', 'phoneNormalized'))) {
    await prisma.$executeRawUnsafe(`ALTER TABLE "Customer" ADD COLUMN "phoneNormalized" TEXT`)
    console.log(`${PREFIX} Added Customer.phoneNormalized`)
  } else {
    console.log(`${PREFIX} Customer.phoneNormalized already exists`)
  }

  if (!(await columnExists(prisma, 'Customer', 'emailNormalized'))) {
    await prisma.$executeRawUnsafe(`ALTER TABLE "Customer" ADD COLUMN "emailNormalized" TEXT`)
    console.log(`${PREFIX} Added Customer.emailNormalized`)
  } else {
    console.log(`${PREFIX} Customer.emailNormalized already exists`)
  }

  // Backfill phoneNormalized from phone
  await prisma.$executeRawUnsafe(`
    UPDATE "Customer" SET "phoneNormalized" = regexp_replace("phone", '[^0-9]', '', 'g')
    WHERE "phone" IS NOT NULL AND "phoneNormalized" IS NULL
  `)
  console.log(`${PREFIX} Backfilled Customer.phoneNormalized from phone`)

  // Backfill emailNormalized from email
  await prisma.$executeRawUnsafe(`
    UPDATE "Customer" SET "emailNormalized" = LOWER(TRIM("email"))
    WHERE "email" IS NOT NULL AND "emailNormalized" IS NULL
  `)
  console.log(`${PREFIX} Backfilled Customer.emailNormalized from email`)

  // Customer partial unique indexes
  if (!(await indexExists(prisma, 'Customer_locationId_phoneNormalized_active_key'))) {
    await prisma.$executeRawUnsafe(`
      CREATE UNIQUE INDEX "Customer_locationId_phoneNormalized_active_key"
      ON "Customer" ("locationId", "phoneNormalized")
      WHERE "phoneNormalized" IS NOT NULL AND "deletedAt" IS NULL AND "isActive" = true
    `)
    console.log(`${PREFIX} Created Customer_locationId_phoneNormalized_active_key unique index`)
  } else {
    console.log(`${PREFIX} Customer_locationId_phoneNormalized_active_key already exists`)
  }

  if (!(await indexExists(prisma, 'Customer_locationId_emailNormalized_active_key'))) {
    await prisma.$executeRawUnsafe(`
      CREATE UNIQUE INDEX "Customer_locationId_emailNormalized_active_key"
      ON "Customer" ("locationId", "emailNormalized")
      WHERE "emailNormalized" IS NOT NULL AND "deletedAt" IS NULL AND "isActive" = true
    `)
    console.log(`${PREFIX} Created Customer_locationId_emailNormalized_active_key unique index`)
  } else {
    console.log(`${PREFIX} Customer_locationId_emailNormalized_active_key already exists`)
  }

  // ─── 6. ALTER Location — nextCakeOrderNumber ─────────────────────────────────
  if (!(await columnExists(prisma, 'Location', 'nextCakeOrderNumber'))) {
    await prisma.$executeRawUnsafe(`ALTER TABLE "Location" ADD COLUMN "nextCakeOrderNumber" INTEGER NOT NULL DEFAULT 0`)
    console.log(`${PREFIX} Added Location.nextCakeOrderNumber`)
  } else {
    console.log(`${PREFIX} Location.nextCakeOrderNumber already exists`)
  }

  // ─── 7. CakeOrder indexes ────────────────────────────────────────────────────
  if (!(await indexExists(prisma, 'CakeOrder_locationId_idx'))) {
    await prisma.$executeRawUnsafe(`CREATE INDEX "CakeOrder_locationId_idx" ON "CakeOrder" ("locationId")`)
    console.log(`${PREFIX} Created CakeOrder_locationId_idx`)
  }

  if (!(await indexExists(prisma, 'CakeOrder_customerId_idx'))) {
    await prisma.$executeRawUnsafe(`CREATE INDEX "CakeOrder_customerId_idx" ON "CakeOrder" ("customerId")`)
    console.log(`${PREFIX} Created CakeOrder_customerId_idx`)
  }

  if (!(await indexExists(prisma, 'CakeOrder_assignedTo_idx'))) {
    await prisma.$executeRawUnsafe(`CREATE INDEX "CakeOrder_assignedTo_idx" ON "CakeOrder" ("assignedTo")`)
    console.log(`${PREFIX} Created CakeOrder_assignedTo_idx`)
  }

  if (!(await indexExists(prisma, 'CakeOrder_locationId_eventDate_status_idx'))) {
    await prisma.$executeRawUnsafe(`
      CREATE INDEX "CakeOrder_locationId_eventDate_status_idx"
      ON "CakeOrder" ("locationId", "eventDate", "status")
    `)
    console.log(`${PREFIX} Created CakeOrder_locationId_eventDate_status_idx`)
  }

  if (!(await indexExists(prisma, 'CakeOrder_customerId_createdAt_idx'))) {
    await prisma.$executeRawUnsafe(`
      CREATE INDEX "CakeOrder_customerId_createdAt_idx"
      ON "CakeOrder" ("customerId", "createdAt")
    `)
    console.log(`${PREFIX} Created CakeOrder_customerId_createdAt_idx`)
  }

  if (!(await indexExists(prisma, 'CakeOrder_locationId_balanceDue_idx'))) {
    await prisma.$executeRawUnsafe(`
      CREATE INDEX "CakeOrder_locationId_balanceDue_idx"
      ON "CakeOrder" ("locationId", "balanceDue")
      WHERE "deletedAt" IS NULL AND "balanceDue" > 0
    `)
    console.log(`${PREFIX} Created CakeOrder_locationId_balanceDue_idx`)
  }

  // Unique index: orderNumber per location
  if (!(await indexExists(prisma, 'CakeOrder_locationId_orderNumber_key'))) {
    await prisma.$executeRawUnsafe(`
      CREATE UNIQUE INDEX "CakeOrder_locationId_orderNumber_key"
      ON "CakeOrder" ("locationId", "orderNumber")
    `)
    console.log(`${PREFIX} Created CakeOrder_locationId_orderNumber_key unique index`)
  }

  // Unique index: submissionToken per location (idempotency)
  if (!(await indexExists(prisma, 'CakeOrder_submissionToken_key'))) {
    await prisma.$executeRawUnsafe(`
      CREATE UNIQUE INDEX "CakeOrder_submissionToken_key"
      ON "CakeOrder" ("locationId", "submissionToken")
      WHERE "submissionToken" IS NOT NULL
    `)
    console.log(`${PREFIX} Created CakeOrder_submissionToken_key unique index`)
  }

  // Capacity enforcement index (active non-draft, non-cancelled orders by location+eventDate)
  if (!(await indexExists(prisma, 'CakeOrder_location_event_active_idx'))) {
    await prisma.$executeRawUnsafe(`
      CREATE INDEX "CakeOrder_location_event_active_idx"
      ON "CakeOrder" ("locationId", "eventDate")
      WHERE "deletedAt" IS NULL AND "status" NOT IN ('cancelled', 'draft')
    `)
    console.log(`${PREFIX} Created CakeOrder_location_event_active_idx`)
  }

  // Date-range deposit dashboard index
  if (!(await indexExists(prisma, 'CakeOrder_location_eventDate_balanceDue_idx'))) {
    await prisma.$executeRawUnsafe(`
      CREATE INDEX "CakeOrder_location_eventDate_balanceDue_idx"
      ON "CakeOrder" ("locationId", "eventDate", "balanceDue")
      WHERE "deletedAt" IS NULL AND "status" NOT IN ('cancelled', 'completed', 'draft')
    `)
    console.log(`${PREFIX} Created CakeOrder_location_eventDate_balanceDue_idx`)
  }

  // Covering index: deposit dashboard avoids heap lookup
  if (!(await indexExists(prisma, 'CakeOrder_location_balanceDue_cover'))) {
    await prisma.$executeRawUnsafe(`
      CREATE INDEX "CakeOrder_location_balanceDue_cover"
      ON "CakeOrder" ("locationId", "balanceDue")
      INCLUDE ("eventDate", "customerId", "status")
      WHERE "deletedAt" IS NULL AND "status" NOT IN ('cancelled', 'completed', 'draft')
    `)
    console.log(`${PREFIX} Created CakeOrder_location_balanceDue_cover covering index`)
  }

  // ─── 8. CakeQuote indexes ────────────────────────────────────────────────────
  if (!(await indexExists(prisma, 'CakeQuote_cakeOrderId_idx'))) {
    await prisma.$executeRawUnsafe(`CREATE INDEX "CakeQuote_cakeOrderId_idx" ON "CakeQuote" ("cakeOrderId")`)
    console.log(`${PREFIX} Created CakeQuote_cakeOrderId_idx`)
  }

  if (!(await indexExists(prisma, 'CakeQuote_cakeOrderId_version_idx'))) {
    await prisma.$executeRawUnsafe(`CREATE INDEX "CakeQuote_cakeOrderId_version_idx" ON "CakeQuote" ("cakeOrderId", "version")`)
    console.log(`${PREFIX} Created CakeQuote_cakeOrderId_version_idx`)
  }

  // ─── 9. CakePayment indexes ──────────────────────────────────────────────────
  if (!(await indexExists(prisma, 'CakePayment_cakeOrderId_idx'))) {
    await prisma.$executeRawUnsafe(`CREATE INDEX "CakePayment_cakeOrderId_idx" ON "CakePayment" ("cakeOrderId")`)
    console.log(`${PREFIX} Created CakePayment_cakeOrderId_idx`)
  }

  if (!(await indexExists(prisma, 'CakePayment_posOrderId_idx'))) {
    await prisma.$executeRawUnsafe(`CREATE INDEX "CakePayment_posOrderId_idx" ON "CakePayment" ("posOrderId") WHERE "posOrderId" IS NOT NULL`)
    console.log(`${PREFIX} Created CakePayment_posOrderId_idx`)
  }

  // Unique index: prevent duplicate POS payment linkage
  if (!(await indexExists(prisma, 'CakePayment_cakeOrderId_posPaymentId_key'))) {
    await prisma.$executeRawUnsafe(`
      CREATE UNIQUE INDEX "CakePayment_cakeOrderId_posPaymentId_key"
      ON "CakePayment" ("cakeOrderId", "posPaymentId")
      WHERE "posPaymentId" IS NOT NULL
    `)
    console.log(`${PREFIX} Created CakePayment_cakeOrderId_posPaymentId_key unique index`)
  }

  // ─── 10. CakeOrderChange indexes ─────────────────────────────────────────────
  if (!(await indexExists(prisma, 'CakeOrderChange_cakeOrderId_idx'))) {
    await prisma.$executeRawUnsafe(`CREATE INDEX "CakeOrderChange_cakeOrderId_idx" ON "CakeOrderChange" ("cakeOrderId")`)
    console.log(`${PREFIX} Created CakeOrderChange_cakeOrderId_idx`)
  }

  if (!(await indexExists(prisma, 'CakeOrderChange_createdAt_idx'))) {
    await prisma.$executeRawUnsafe(`CREATE INDEX "CakeOrderChange_createdAt_idx" ON "CakeOrderChange" ("createdAt")`)
    console.log(`${PREFIX} Created CakeOrderChange_createdAt_idx`)
  }

  // ─── 11. CHECK constraints — CakeOrder ────────────────────────────────────────
  try {
    await prisma.$executeRawUnsafe(`
      ALTER TABLE "CakeOrder" ADD CONSTRAINT "CakeOrder_status_check"
      CHECK ("status" IN ('draft','submitted','under_review','quoted','approved','deposit_paid','in_production','ready','delivered','completed','cancelled'))
    `)
    console.log(`${PREFIX} Added CakeOrder_status_check`)
  } catch {
    console.log(`${PREFIX} CakeOrder_status_check already exists`)
  }

  try {
    await prisma.$executeRawUnsafe(`
      ALTER TABLE "CakeOrder" ADD CONSTRAINT "CakeOrder_nonneg_financials"
      CHECK ("subtotal" >= 0 AND "total" >= 0 AND "depositRequired" >= 0 AND "depositPaid" >= 0 AND "balanceDue" >= 0)
    `)
    console.log(`${PREFIX} Added CakeOrder_nonneg_financials`)
  } catch {
    console.log(`${PREFIX} CakeOrder_nonneg_financials already exists`)
  }

  try {
    await prisma.$executeRawUnsafe(`
      ALTER TABLE "CakeOrder" ADD CONSTRAINT "CakeOrder_customer_required_on_submit"
      CHECK ("status" = 'draft' OR "customerId" IS NOT NULL)
    `)
    console.log(`${PREFIX} Added CakeOrder_customer_required_on_submit`)
  } catch {
    console.log(`${PREFIX} CakeOrder_customer_required_on_submit already exists`)
  }

  try {
    await prisma.$executeRawUnsafe(`
      ALTER TABLE "CakeOrder" ADD CONSTRAINT "CakeOrder_nonneg_guest_delivery"
      CHECK ("guestCount" >= 0 AND ("deliveryMiles" IS NULL OR "deliveryMiles" >= 0)
        AND ("discountAmount" IS NULL OR "discountAmount" >= 0) AND "deliveryFee" >= 0)
    `)
    console.log(`${PREFIX} Added CakeOrder_nonneg_guest_delivery`)
  } catch {
    console.log(`${PREFIX} CakeOrder_nonneg_guest_delivery already exists`)
  }

  try {
    await prisma.$executeRawUnsafe(`
      ALTER TABLE "CakeOrder" ADD CONSTRAINT "CakeOrder_deliveryType_check"
      CHECK ("deliveryType" IS NULL OR "deliveryType" IN ('pickup','delivery','setup'))
    `)
    console.log(`${PREFIX} Added CakeOrder_deliveryType_check`)
  } catch {
    console.log(`${PREFIX} CakeOrder_deliveryType_check already exists`)
  }

  // ─── 12. CHECK constraints — CakeQuote ────────────────────────────────────────
  try {
    await prisma.$executeRawUnsafe(`
      ALTER TABLE "CakeQuote" ADD CONSTRAINT "CakeQuote_status_check"
      CHECK ("status" IN ('draft','sent','approved','voided','expired'))
    `)
    console.log(`${PREFIX} Added CakeQuote_status_check`)
  } catch {
    console.log(`${PREFIX} CakeQuote_status_check already exists`)
  }

  // ─── 13. CHECK constraints — CakePayment ─────────────────────────────────────
  try {
    await prisma.$executeRawUnsafe(`
      ALTER TABLE "CakePayment" ADD CONSTRAINT "CakePayment_type_check"
      CHECK ("type" IN ('payment','refund','forfeit'))
    `)
    console.log(`${PREFIX} Added CakePayment_type_check`)
  } catch {
    console.log(`${PREFIX} CakePayment_type_check already exists`)
  }

  try {
    await prisma.$executeRawUnsafe(`
      ALTER TABLE "CakePayment" ADD CONSTRAINT "CakePayment_source_check"
      CHECK ("paymentSource" IN ('pos','external'))
    `)
    console.log(`${PREFIX} Added CakePayment_source_check`)
  } catch {
    console.log(`${PREFIX} CakePayment_source_check already exists`)
  }

  try {
    await prisma.$executeRawUnsafe(`
      ALTER TABLE "CakePayment" ADD CONSTRAINT "CakePayment_appliedTo_check"
      CHECK ("appliedTo" IN ('deposit','balance'))
    `)
    console.log(`${PREFIX} Added CakePayment_appliedTo_check`)
  } catch {
    console.log(`${PREFIX} CakePayment_appliedTo_check already exists`)
  }

  try {
    await prisma.$executeRawUnsafe(`
      ALTER TABLE "CakePayment" ADD CONSTRAINT "CakePayment_nonneg_amount"
      CHECK ("amount" >= 0)
    `)
    console.log(`${PREFIX} Added CakePayment_nonneg_amount`)
  } catch {
    console.log(`${PREFIX} CakePayment_nonneg_amount already exists`)
  }

  // Payment-source invariants: POS payments require posPaymentId + posOrderId
  try {
    await prisma.$executeRawUnsafe(`
      ALTER TABLE "CakePayment" ADD CONSTRAINT "CakePayment_pos_requires_ids"
      CHECK ("paymentSource" != 'pos' OR ("posPaymentId" IS NOT NULL AND "posOrderId" IS NOT NULL))
    `)
    console.log(`${PREFIX} Added CakePayment_pos_requires_ids`)
  } catch {
    console.log(`${PREFIX} CakePayment_pos_requires_ids already exists`)
  }

  // Payment-source invariants: external payments must NOT have POS ids
  try {
    await prisma.$executeRawUnsafe(`
      ALTER TABLE "CakePayment" ADD CONSTRAINT "CakePayment_external_no_ids"
      CHECK ("paymentSource" != 'external' OR ("posPaymentId" IS NULL AND "posOrderId" IS NULL))
    `)
    console.log(`${PREFIX} Added CakePayment_external_no_ids`)
  } catch {
    console.log(`${PREFIX} CakePayment_external_no_ids already exists`)
  }

  // Refund must reference original payment
  try {
    await prisma.$executeRawUnsafe(`
      ALTER TABLE "CakePayment" ADD CONSTRAINT "CakePayment_refund_requires_original"
      CHECK ("type" != 'refund' OR "reversesCakePaymentId" IS NOT NULL)
    `)
    console.log(`${PREFIX} Added CakePayment_refund_requires_original`)
  } catch {
    console.log(`${PREFIX} CakePayment_refund_requires_original already exists`)
  }

  // ─── 14. CHECK constraints — CakeOrderChange ─────────────────────────────────
  try {
    await prisma.$executeRawUnsafe(`
      ALTER TABLE "CakeOrderChange" ADD CONSTRAINT "CakeOrderChange_changeType_check"
      CHECK ("changeType" IN ('status_change','quote_created','quote_voided','quote_approved',
        'payment_recorded','payment_refunded','config_edited','assignment_changed','note_added'))
    `)
    console.log(`${PREFIX} Added CakeOrderChange_changeType_check`)
  } catch {
    console.log(`${PREFIX} CakeOrderChange_changeType_check already exists`)
  }

  // ─── 15. Seed system OrderTypes per Location ──────────────────────────────────
  // cake_deposit_settlement: isSystem=true, no tips, immutable, skip KDS/print
  const depositSeeded = await prisma.$queryRawUnsafe(`
    SELECT 1 FROM "OrderType" WHERE "slug" = 'cake_deposit_settlement' LIMIT 1
  `)
  if (depositSeeded.length === 0) {
    await prisma.$executeRawUnsafe(`
      INSERT INTO "OrderType" ("id", "locationId", "name", "slug", "description", "isActive", "isSystem", "allowTips", "sortOrder", "workflowRules", "createdAt", "updatedAt")
      SELECT
        gen_random_uuid()::text,
        "id",
        'Cake Deposit Settlement',
        'cake_deposit_settlement',
        'System order type for cake deposit payments. Immutable, non-taxable, skips KDS/print.',
        true,
        true,
        false,
        990,
        '{"immutable": true, "skipKds": true, "skipPrint": true}'::jsonb,
        NOW(),
        NOW()
      FROM "Location"
    `)
    console.log(`${PREFIX} Seeded cake_deposit_settlement OrderType for all locations`)
  } else {
    console.log(`${PREFIX} cake_deposit_settlement OrderType already exists`)
  }

  // cake_balance_settlement: isSystem=true, tips allowed, immutable, skip KDS/print
  const balanceSeeded = await prisma.$queryRawUnsafe(`
    SELECT 1 FROM "OrderType" WHERE "slug" = 'cake_balance_settlement' LIMIT 1
  `)
  if (balanceSeeded.length === 0) {
    await prisma.$executeRawUnsafe(`
      INSERT INTO "OrderType" ("id", "locationId", "name", "slug", "description", "isActive", "isSystem", "sortOrder", "workflowRules", "createdAt", "updatedAt")
      SELECT
        gen_random_uuid()::text,
        "id",
        'Cake Balance Settlement',
        'cake_balance_settlement',
        'System order type for cake balance payments. Immutable, non-taxable, skips KDS/print. Tips allowed.',
        true,
        true,
        991,
        '{"immutable": true, "skipKds": true, "skipPrint": true}'::jsonb,
        NOW(),
        NOW()
      FROM "Location"
    `)
    console.log(`${PREFIX} Seeded cake_balance_settlement OrderType for all locations`)
  } else {
    console.log(`${PREFIX} cake_balance_settlement OrderType already exists`)
  }

  // ─── 16. Financial recalculation trigger ──────────────────────────────────────
  // Trigger on CakePayment INSERT/UPDATE/DELETE that recalculates
  // CakeOrder.depositPaid and CakeOrder.balanceDue from the payment ledger.
  // This is the ONLY writer of depositPaid/balanceDue — no app code may write directly.
  try {
    await prisma.$executeRawUnsafe(`
      CREATE OR REPLACE FUNCTION recalculate_cake_order_financials_fn()
      RETURNS TRIGGER AS $$
      DECLARE
        total_deposit_paid DECIMAL(10,2);
        total_balance_paid DECIMAL(10,2);
        order_total DECIMAL(10,2);
      BEGIN
        SELECT
          COALESCE(SUM(CASE WHEN "appliedTo" = 'deposit' AND "type" = 'payment' THEN amount ELSE 0 END), 0)
            - COALESCE(SUM(CASE WHEN "appliedTo" = 'deposit' AND "type" = 'refund' THEN amount ELSE 0 END), 0),
          COALESCE(SUM(CASE WHEN "appliedTo" = 'balance' AND "type" = 'payment' THEN amount ELSE 0 END), 0)
            - COALESCE(SUM(CASE WHEN "appliedTo" = 'balance' AND "type" = 'refund' THEN amount ELSE 0 END), 0)
        INTO total_deposit_paid, total_balance_paid
        FROM "CakePayment"
        WHERE "cakeOrderId" = COALESCE(NEW."cakeOrderId", OLD."cakeOrderId");

        SELECT "total" INTO order_total FROM "CakeOrder"
        WHERE "id" = COALESCE(NEW."cakeOrderId", OLD."cakeOrderId");

        UPDATE "CakeOrder" SET
          "depositPaid" = total_deposit_paid,
          "balanceDue" = GREATEST(0, COALESCE(order_total, 0) - total_deposit_paid - total_balance_paid),
          "updatedAt" = NOW()
        WHERE "id" = COALESCE(NEW."cakeOrderId", OLD."cakeOrderId");

        RETURN COALESCE(NEW, OLD);
      END;
      $$ LANGUAGE plpgsql
    `)
    console.log(`${PREFIX} Created recalculate_cake_order_financials_fn function`)
  } catch (err) {
    console.log(`${PREFIX} recalculate_cake_order_financials_fn function already exists or error: ${err.message}`)
  }

  try {
    await prisma.$executeRawUnsafe(`
      CREATE TRIGGER recalculate_cake_financials
      AFTER INSERT OR UPDATE OR DELETE ON "CakePayment"
      FOR EACH ROW EXECUTE FUNCTION recalculate_cake_order_financials_fn()
    `)
    console.log(`${PREFIX} Created recalculate_cake_financials trigger`)
  } catch (err) {
    console.log(`${PREFIX} recalculate_cake_financials trigger already exists or error: ${err.message}`)
  }

  console.log(`${PREFIX} Migration 070 complete`)
}
