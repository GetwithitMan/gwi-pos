#!/usr/bin/env node
/**
 * NUC Pre-Migrate Script
 *
 * Runs pre-push SQL migrations on the local NUC database before `prisma db push`.
 * Mirrors the logic in vercel-build.js but uses @prisma/client (available on NUC)
 * instead of @neondatabase/serverless.
 *
 * Usage: node scripts/nuc-pre-migrate.js
 * Requires: DATABASE_URL in environment (loaded from /opt/gwi-pos/.env by systemd)
 */
const { PrismaClient } = require('@prisma/client')

const PREFIX = '[nuc-pre-migrate]'

async function getLocationId(prisma) {
  // Prefer LOCATION_ID env var (every NUC has this set)
  if (process.env.LOCATION_ID) {
    return process.env.LOCATION_ID
  }
  // Fallback: first location in the database
  const rows = await prisma.$queryRawUnsafe(
    'SELECT id FROM "Location" LIMIT 1'
  )
  if (rows.length > 0) {
    return rows[0].id
  }
  return null
}

async function columnExists(prisma, tableName, columnName) {
  const rows = await prisma.$queryRawUnsafe(
    `SELECT column_name FROM information_schema.columns WHERE table_name = $1 AND column_name = $2`,
    tableName,
    columnName
  )
  return rows.length > 0
}

async function runPrePushMigrations() {
  // Support NEON_MIGRATE flag — when set, run migrations against Neon cloud DB
  const isNeon = process.env.NEON_MIGRATE === 'true'
  if (isNeon && !process.env.NEON_DATABASE_URL) {
    console.log(`${PREFIX} NEON_MIGRATE=true but NEON_DATABASE_URL not set — skipping`)
    return
  }

  const targetHost = isNeon
    ? (process.env.NEON_DATABASE_URL || '').split('@')[1]?.split('/')[0] || 'neon'
    : 'local PG'
  console.log(`${PREFIX} Target: ${targetHost}`)

  const prisma = isNeon
    ? new PrismaClient({ datasources: { db: { url: process.env.NEON_DATABASE_URL } } })
    : new PrismaClient()

  try {
    console.log(`${PREFIX} Running pre-push migrations...`)

    const locationId = await getLocationId(prisma)
    if (!locationId) {
      console.warn(`${PREFIX} WARNING: No locationId found (no LOCATION_ID env, no Location rows). Backfills may leave NULLs.`)
    }

    // --- Case 1: cloud_event_queue.locationId ---
    try {
      const exists = await columnExists(prisma, 'cloud_event_queue', 'locationId')
      if (!exists) {
        console.log(`${PREFIX}   Adding locationId to cloud_event_queue...`)
        await prisma.$executeRawUnsafe(
          'ALTER TABLE "cloud_event_queue" ADD COLUMN "locationId" TEXT'
        )
        await prisma.$executeRawUnsafe(
          `UPDATE "cloud_event_queue" SET "locationId" = (SELECT id FROM "Location" LIMIT 1) WHERE "locationId" IS NULL`
        )
        await prisma.$executeRawUnsafe(
          'ALTER TABLE "cloud_event_queue" ALTER COLUMN "locationId" SET NOT NULL'
        )
        console.log(`${PREFIX}   Done — cloud_event_queue.locationId backfilled`)
      }
    } catch (err) {
      console.error(`${PREFIX}   FAILED cloud_event_queue.locationId:`, err.message)
    }

    // --- Case 2: OrderOwnershipEntry.locationId ---
    try {
      const exists = await columnExists(prisma, 'OrderOwnershipEntry', 'locationId')
      if (!exists) {
        console.log(`${PREFIX}   Adding locationId to OrderOwnershipEntry...`)
        await prisma.$executeRawUnsafe(
          'ALTER TABLE "OrderOwnershipEntry" ADD COLUMN "locationId" TEXT'
        )
        // Backfill from parent OrderOwnership
        await prisma.$executeRawUnsafe(
          `UPDATE "OrderOwnershipEntry" ooe SET "locationId" = oo."locationId" FROM "OrderOwnership" oo WHERE ooe."orderOwnershipId" = oo.id AND ooe."locationId" IS NULL`
        )
        // Fallback: any remaining nulls get first location
        await prisma.$executeRawUnsafe(
          `UPDATE "OrderOwnershipEntry" SET "locationId" = (SELECT id FROM "Location" LIMIT 1) WHERE "locationId" IS NULL`
        )
        await prisma.$executeRawUnsafe(
          'ALTER TABLE "OrderOwnershipEntry" ALTER COLUMN "locationId" SET NOT NULL'
        )
        console.log(`${PREFIX}   Done — OrderOwnershipEntry.locationId backfilled`)
      }
    } catch (err) {
      console.error(`${PREFIX}   FAILED OrderOwnershipEntry.locationId:`, err.message)
    }

    // --- Case 3: OrderOwnershipEntry.deletedAt (nullable, just needs to exist) ---
    try {
      const exists = await columnExists(prisma, 'OrderOwnershipEntry', 'deletedAt')
      if (!exists) {
        console.log(`${PREFIX}   Adding deletedAt to OrderOwnershipEntry...`)
        await prisma.$executeRawUnsafe(
          'ALTER TABLE "OrderOwnershipEntry" ADD COLUMN "deletedAt" TIMESTAMPTZ'
        )
        console.log(`${PREFIX}   Done — OrderOwnershipEntry.deletedAt added`)
      }
    } catch (err) {
      console.error(`${PREFIX}   FAILED OrderOwnershipEntry.deletedAt:`, err.message)
    }

    // --- Case 4: ModifierTemplate.locationId ---
    try {
      const exists = await columnExists(prisma, 'ModifierTemplate', 'locationId')
      if (!exists) {
        console.log(`${PREFIX}   Adding locationId to ModifierTemplate...`)
        await prisma.$executeRawUnsafe(
          'ALTER TABLE "ModifierTemplate" ADD COLUMN "locationId" TEXT'
        )
        // Backfill from parent ModifierGroupTemplate
        await prisma.$executeRawUnsafe(
          `UPDATE "ModifierTemplate" mt SET "locationId" = mgt."locationId" FROM "ModifierGroupTemplate" mgt WHERE mt."templateId" = mgt.id AND mt."locationId" IS NULL`
        )
        // Fallback: any remaining nulls get first location
        await prisma.$executeRawUnsafe(
          `UPDATE "ModifierTemplate" SET "locationId" = (SELECT id FROM "Location" LIMIT 1) WHERE "locationId" IS NULL`
        )
        await prisma.$executeRawUnsafe(
          'ALTER TABLE "ModifierTemplate" ALTER COLUMN "locationId" SET NOT NULL'
        )
        console.log(`${PREFIX}   Done — ModifierTemplate.locationId backfilled`)
      }
    } catch (err) {
      console.error(`${PREFIX}   FAILED ModifierTemplate.locationId:`, err.message)
    }

    // --- Case 5: ModifierTemplate.deletedAt (nullable, just needs to exist) ---
    try {
      const exists = await columnExists(prisma, 'ModifierTemplate', 'deletedAt')
      if (!exists) {
        console.log(`${PREFIX}   Adding deletedAt to ModifierTemplate...`)
        await prisma.$executeRawUnsafe(
          'ALTER TABLE "ModifierTemplate" ADD COLUMN "deletedAt" TIMESTAMPTZ'
        )
        console.log(`${PREFIX}   Done — ModifierTemplate.deletedAt added`)
      }
    } catch (err) {
      console.error(`${PREFIX}   FAILED ModifierTemplate.deletedAt:`, err.message)
    }

    // --- Orphaned FK cleanup (null out references to non-existent rows) ---
    // Prisma db push adds FK constraints; existing data may reference deleted/missing rows.
    const orphanedFks = [
      ['Payment', 'terminalId', 'Terminal'],
      ['Payment', 'drawerId', 'Drawer'],
      ['Payment', 'shiftId', 'Shift'],
      ['Payment', 'paymentReaderId', 'PaymentReader'],
      ['Payment', 'employeeId', 'Employee'],
    ]
    for (const [table, column, refTable] of orphanedFks) {
      try {
        const hasCol = await columnExists(prisma, table, column)
        if (hasCol) {
          const [orphaned] = await prisma.$queryRawUnsafe(
            `SELECT COUNT(*) as cnt FROM "${table}" t WHERE t."${column}" IS NOT NULL AND NOT EXISTS (SELECT 1 FROM "${refTable}" r WHERE r.id = t."${column}")`
          )
          if (orphaned && Number(orphaned.cnt) > 0) {
            console.log(`${PREFIX}   Nulling ${orphaned.cnt} orphaned ${table}.${column} references...`)
            await prisma.$executeRawUnsafe(
              `UPDATE "${table}" SET "${column}" = NULL WHERE "${column}" IS NOT NULL AND NOT EXISTS (SELECT 1 FROM "${refTable}" r WHERE r.id = "${table}"."${column}")`
            )
            console.log(`${PREFIX}   Done`)
          }
        }
      } catch (err) {
        console.error(`${PREFIX}   FAILED orphan cleanup ${table}.${column}:`, err.message)
      }
    }

    // --- updatedAt backfills (add column if missing, backfill NULLs either way) ---
    const updatedAtTables = [
      'OrderOwnershipEntry', 'PaymentReaderLog', 'TipLedgerEntry',
      'TipTransaction', 'cloud_event_queue',
    ]
    for (const table of updatedAtTables) {
      try {
        const exists = await columnExists(prisma, table, 'updatedAt')
        if (!exists) {
          console.log(`${PREFIX}   Adding updatedAt to ${table}...`)
          await prisma.$executeRawUnsafe(`ALTER TABLE "${table}" ADD COLUMN "updatedAt" TIMESTAMPTZ`)
        }
        await prisma.$executeRawUnsafe(`UPDATE "${table}" SET "updatedAt" = NOW() WHERE "updatedAt" IS NULL`)
        await prisma.$executeRawUnsafe(`ALTER TABLE "${table}" ALTER COLUMN "updatedAt" SET NOT NULL`)
        if (!exists) console.log(`${PREFIX}   Done — ${table}.updatedAt backfilled`)
      } catch (err) {
        console.error(`${PREFIX}   FAILED ${table}.updatedAt:`, err.message)
      }
    }

    // --- Order deduplication + partial unique index ---
    try {
      const dupes = await prisma.$queryRawUnsafe(`
        SELECT "locationId", "orderNumber", COUNT(*) as cnt
        FROM "Order" WHERE "parentOrderId" IS NULL
        GROUP BY "locationId", "orderNumber" HAVING COUNT(*) > 1
      `)
      if (dupes.length > 0) {
        console.log(`${PREFIX}   Deduplicating ${dupes.length} duplicate orderNumber groups...`)
        const [maxRow] = await prisma.$queryRawUnsafe(`SELECT COALESCE(MAX("orderNumber"), 0) as mx FROM "Order"`)
        let nextNum = Math.max(Number(maxRow.mx), 900000) + 1000
        for (const { locationId, orderNumber } of dupes) {
          const orders = await prisma.$queryRawUnsafe(`
            SELECT id FROM "Order"
            WHERE "locationId" = $1 AND "orderNumber" = $2 AND "parentOrderId" IS NULL
            ORDER BY "createdAt" DESC
          `, locationId, Number(orderNumber))
          for (let i = 1; i < orders.length; i++) {
            nextNum++
            await prisma.$executeRawUnsafe(`UPDATE "Order" SET "orderNumber" = $1 WHERE id = $2`, nextNum, orders[i].id)
          }
        }
        console.log(`${PREFIX}   Done — duplicate orderNumbers resolved`)
      }

      const [plainIdx] = await prisma.$queryRawUnsafe(`SELECT indexname FROM pg_indexes WHERE tablename = 'Order' AND indexname = 'Order_locationId_orderNumber_key'`)
      if (plainIdx) {
        console.log(`${PREFIX}   Dropping plain unique index...`)
        await prisma.$executeRawUnsafe(`DROP INDEX "Order_locationId_orderNumber_key"`)
      }
      const [partialIdx] = await prisma.$queryRawUnsafe(`SELECT indexname FROM pg_indexes WHERE tablename = 'Order' AND indexname = 'Order_locationId_orderNumber_unique'`)
      if (!partialIdx) {
        console.log(`${PREFIX}   Creating partial unique index...`)
        await prisma.$executeRawUnsafe(`CREATE UNIQUE INDEX "Order_locationId_orderNumber_unique" ON "Order" ("locationId", "orderNumber") WHERE "parentOrderId" IS NULL`)
        console.log(`${PREFIX}   Done`)
      }
    } catch (err) {
      console.error(`${PREFIX}   FAILED order dedup/index:`, err.message)
    }

    // --- Int → Decimal(10,2) conversions (tip fields) ---
    async function isIntegerColumn(table, column) {
      const rows = await prisma.$queryRawUnsafe(
        `SELECT data_type FROM information_schema.columns WHERE table_name = $1 AND column_name = $2`,
        table, column
      )
      return rows.length > 0 && rows[0].data_type === 'integer'
    }

    const decimalConversions = [
      ['TipLedger', 'currentBalanceCents'],
      ['TipLedgerEntry', 'amountCents'],
      ['TipTransaction', 'amountCents'],
      ['TipTransaction', 'ccFeeAmountCents'],
      ['TipDebt', 'originalAmountCents'],
      ['TipDebt', 'remainingCents'],
      ['CashTipDeclaration', 'amountCents'],
    ]
    for (const [table, column] of decimalConversions) {
      try {
        if (await isIntegerColumn(table, column)) {
          console.log(`${PREFIX}   Converting ${table}.${column} INT → DECIMAL(10,2)...`)
          await prisma.$executeRawUnsafe(`ALTER TABLE "${table}" ALTER COLUMN "${column}" TYPE DECIMAL(10,2)`)
          console.log(`${PREFIX}   Done`)
        }
      } catch (err) {
        console.error(`${PREFIX}   FAILED ${table}.${column}:`, err.message)
      }
    }

    // --- String → Enum casts ---
    async function isTextColumn(table, column) {
      const rows = await prisma.$queryRawUnsafe(
        `SELECT data_type FROM information_schema.columns WHERE table_name = $1 AND column_name = $2`,
        table, column
      )
      return rows.length > 0 && (rows[0].data_type === 'text' || rows[0].data_type === 'character varying')
    }

    async function ensureEnumType(typeName, values) {
      const [existing] = await prisma.$queryRawUnsafe(`SELECT typname FROM pg_type WHERE typname = $1`, typeName)
      if (!existing) {
        const valuesStr = values.map(v => `'${v}'`).join(', ')
        await prisma.$executeRawUnsafe(`CREATE TYPE "${typeName}" AS ENUM (${valuesStr})`)
      }
    }

    const enumCasts = [
      ['Payment', 'paymentMethod', 'PaymentMethod', ['cash', 'card', 'credit', 'debit', 'gift_card', 'house_account', 'loyalty', 'loyalty_points']],
      ['TipLedgerEntry', 'type', 'TipLedgerEntryType', ['CREDIT', 'DEBIT']],
      ['TipTransaction', 'sourceType', 'TipTransactionSourceType', ['CARD', 'CASH', 'ADJUSTMENT']],
    ]
    for (const [table, column, enumName, values] of enumCasts) {
      try {
        if (await isTextColumn(table, column)) {
          console.log(`${PREFIX}   Converting ${table}.${column} TEXT → ${enumName} enum...`)
          await ensureEnumType(enumName, values)
          await prisma.$executeRawUnsafe(`ALTER TABLE "${table}" ALTER COLUMN "${column}" TYPE "${enumName}" USING ("${column}"::text::"${enumName}")`)
          console.log(`${PREFIX}   Done`)
        }
      } catch (err) {
        console.error(`${PREFIX}   FAILED ${table}.${column}:`, err.message)
      }
    }

    // --- SAF payment status fields (v1.12.0) ---
    const safFields = [
      ['safStatus',     'TEXT',        null],
      ['safUploadedAt', 'TIMESTAMPTZ', null],
      ['safError',      'TEXT',        null],
    ]
    for (const [column, type] of safFields) {
      try {
        const exists = await columnExists(prisma, 'Payment', column)
        if (!exists) {
          console.log(`${PREFIX}   Adding Payment.${column}...`)
          await prisma.$executeRawUnsafe(`ALTER TABLE "Payment" ADD COLUMN "${column}" ${type}`)
          console.log(`${PREFIX}   Done — Payment.${column} added`)
        }
      } catch (err) {
        console.error(`${PREFIX}   FAILED Payment.${column}:`, err.message)
      }
    }
    // Index on safStatus for SAF pending queue queries
    try {
      const [safIdx] = await prisma.$queryRawUnsafe(
        `SELECT indexname FROM pg_indexes WHERE tablename = 'Payment' AND indexname = 'Payment_safStatus_idx'`
      )
      if (!safIdx) {
        console.log(`${PREFIX}   Creating Payment_safStatus_idx...`)
        await prisma.$executeRawUnsafe(`CREATE INDEX "Payment_safStatus_idx" ON "Payment" ("safStatus")`)
        console.log(`${PREFIX}   Done`)
      }
    } catch (err) {
      console.error(`${PREFIX}   FAILED Payment_safStatus_idx:`, err.message)
    }

    // --- Postgres SEQUENCE for event-sourced order serverSequence ---
    try {
      await prisma.$executeRawUnsafe(
        `CREATE SEQUENCE IF NOT EXISTS order_event_server_seq START 1 INCREMENT 1`
      )
      console.log(`${PREFIX}   order_event_server_seq SEQUENCE ready`)
    } catch (err) {
      console.error(`${PREFIX}   FAILED creating order_event_server_seq:`, err.message)
    }

    // --- CFD: Add CFD_DISPLAY to TerminalCategory enum ---
    try {
      const [enumVal] = await prisma.$queryRawUnsafe(
        `SELECT 1 FROM pg_enum WHERE enumlabel = 'CFD_DISPLAY' AND enumtypid = (SELECT oid FROM pg_type WHERE typname = 'TerminalCategory') LIMIT 1`
      )
      if (!enumVal) {
        console.log(`${PREFIX}   Adding CFD_DISPLAY to TerminalCategory enum...`)
        await prisma.$executeRawUnsafe(`ALTER TYPE "TerminalCategory" ADD VALUE 'CFD_DISPLAY'`)
        console.log(`${PREFIX}   Done — TerminalCategory.CFD_DISPLAY added`)
      }
    } catch (err) {
      console.error(`${PREFIX}   FAILED TerminalCategory.CFD_DISPLAY:`, err.message)
    }

    // --- CFD: New Terminal columns for CFD pairing ---
    const cfdTerminalFields = [
      ['cfdTerminalId',     'TEXT',               null],
      ['cfdIpAddress',      'TEXT',               null],
      ['cfdConnectionMode', `TEXT DEFAULT 'usb'`, null],
    ]
    for (const [column] of cfdTerminalFields) {
      try {
        const exists = await columnExists(prisma, 'Terminal', column)
        if (!exists) {
          const colDef = cfdTerminalFields.find(([c]) => c === column)[1]
          console.log(`${PREFIX}   Adding Terminal.${column}...`)
          await prisma.$executeRawUnsafe(`ALTER TABLE "Terminal" ADD COLUMN "${column}" ${colDef}`)
          console.log(`${PREFIX}   Done — Terminal.${column} added`)
        }
      } catch (err) {
        console.error(`${PREFIX}   FAILED Terminal.${column}:`, err.message)
      }
    }

    // --- CFD: Index on Terminal.cfdTerminalId ---
    try {
      const [idx] = await prisma.$queryRawUnsafe(
        `SELECT indexname FROM pg_indexes WHERE tablename = 'Terminal' AND indexname = 'Terminal_cfdTerminalId_idx'`
      )
      if (!idx) {
        console.log(`${PREFIX}   Creating Terminal_cfdTerminalId_idx...`)
        await prisma.$executeRawUnsafe(`CREATE INDEX "Terminal_cfdTerminalId_idx" ON "Terminal" ("cfdTerminalId")`)
        console.log(`${PREFIX}   Done`)
      }
    } catch (err) {
      console.error(`${PREFIX}   FAILED Terminal_cfdTerminalId_idx:`, err.message)
    }

    // --- CFD: Create CfdSettings table ---
    try {
      const [table] = await prisma.$queryRawUnsafe(
        `SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'CfdSettings' LIMIT 1`
      )
      if (!table) {
        console.log(`${PREFIX}   Creating CfdSettings table...`)
        await prisma.$executeRawUnsafe(`
          CREATE TABLE "CfdSettings" (
            "id"                       TEXT NOT NULL,
            "locationId"               TEXT NOT NULL,
            "tipMode"                  TEXT NOT NULL DEFAULT 'pre_tap',
            "tipStyle"                 TEXT NOT NULL DEFAULT 'percent',
            "tipOptions"               TEXT NOT NULL DEFAULT '18,20,22,25',
            "tipShowNoTip"             BOOLEAN NOT NULL DEFAULT true,
            "signatureEnabled"         BOOLEAN NOT NULL DEFAULT true,
            "signatureThresholdCents"  INTEGER NOT NULL DEFAULT 2500,
            "receiptEmailEnabled"      BOOLEAN NOT NULL DEFAULT true,
            "receiptSmsEnabled"        BOOLEAN NOT NULL DEFAULT true,
            "receiptPrintEnabled"      BOOLEAN NOT NULL DEFAULT true,
            "receiptTimeoutSeconds"    INTEGER NOT NULL DEFAULT 30,
            "tabMode"                  TEXT NOT NULL DEFAULT 'token_only',
            "tabPreAuthAmountCents"    INTEGER NOT NULL DEFAULT 100,
            "idlePromoEnabled"         BOOLEAN NOT NULL DEFAULT false,
            "idleWelcomeText"          TEXT DEFAULT 'Welcome!',
            "createdAt"                TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            "updatedAt"               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            "deletedAt"                TIMESTAMPTZ,
            "syncedAt"                 TIMESTAMPTZ,
            CONSTRAINT "CfdSettings_pkey" PRIMARY KEY ("id"),
            CONSTRAINT "CfdSettings_locationId_key" UNIQUE ("locationId")
          )
        `)
        await prisma.$executeRawUnsafe(`CREATE INDEX "CfdSettings_locationId_idx" ON "CfdSettings" ("locationId")`)
        console.log(`${PREFIX}   Done — CfdSettings table created`)
      }
    } catch (err) {
      console.error(`${PREFIX}   FAILED CfdSettings table:`, err.message)
    }

    // --- Role: Add roleType and accessLevel columns + backfill from permissions ---
    try {
      const hasRoleType = await columnExists(prisma, 'Role', 'roleType')
      if (!hasRoleType) {
        console.log(`${PREFIX}   Adding roleType and accessLevel to Role...`)
        await prisma.$executeRawUnsafe(
          `ALTER TABLE "Role" ADD COLUMN "roleType" TEXT NOT NULL DEFAULT 'FOH'`
        )
        await prisma.$executeRawUnsafe(
          `ALTER TABLE "Role" ADD COLUMN "accessLevel" TEXT NOT NULL DEFAULT 'STAFF'`
        )

        // Backfill from permissions JSONB
        const roles = await prisma.$queryRawUnsafe(
          `SELECT id, permissions FROM "Role" WHERE "deletedAt" IS NULL`
        )
        for (const row of roles) {
          const perms = Array.isArray(row.permissions) ? row.permissions : []

          const hasAny = (list) => list.some(p => perms.includes(p))
          const hasWildcard = (prefix) => perms.includes(prefix + '.*') || perms.includes('*')

          // roleType
          const ADMIN_SIGNALS = [
            'settings.view', 'settings.edit', 'settings.tax', 'settings.receipts',
            'settings.payments', 'settings.dual_pricing', 'settings.venue', 'settings.menu',
            'settings.inventory', 'settings.floor', 'settings.customers', 'settings.team',
            'settings.tips', 'settings.reports', 'settings.hardware', 'settings.security',
            'settings.integrations', 'settings.automation', 'settings.monitoring',
            'admin', 'super_admin',
          ]
          const BOH_ONLY_SIGNALS = ['pos.kds']
          const FOH_SIGNALS = ['pos.access', 'pos.table_service', 'pos.quick_order']

          let roleType = 'FOH'
          if (hasAny(ADMIN_SIGNALS) || hasWildcard('settings') || perms.includes('all') || perms.includes('admin') || perms.includes('super_admin')) {
            roleType = 'ADMIN'
          } else if (hasAny(BOH_ONLY_SIGNALS) && !hasAny(FOH_SIGNALS)) {
            roleType = 'BOH'
          }

          // accessLevel
          const OWNER_ADMIN_SIGNALS = [
            'manager.void_payments', 'manager.cash_variance_override',
            'staff.manage_roles', 'staff.assign_roles',
            'tips.manage_rules', 'tips.manage_bank', 'tips.manage_settings', 'tips.process_payout',
            'payroll.manage', 'admin', 'super_admin',
          ]
          const MANAGER_SIGNALS = [
            'manager.void_items', 'manager.void_orders', 'manager.refunds', 'manager.discounts',
            'manager.edit_sent_items', 'manager.edit_time_entries', 'manager.end_breaks_early',
            'manager.force_clock_out', 'manager.pay_in_out', 'manager.close_day',
            'manager.cash_drawer_full', 'staff.edit_wages',
          ]

          let accessLevel = 'STAFF'
          if (hasAny(OWNER_ADMIN_SIGNALS) || hasWildcard('settings') || perms.includes('all')) {
            accessLevel = 'OWNER_ADMIN'
          } else if (hasAny(MANAGER_SIGNALS) || hasWildcard('manager')) {
            accessLevel = 'MANAGER'
          }

          await prisma.$executeRawUnsafe(
            `UPDATE "Role" SET "roleType" = $1, "accessLevel" = $2 WHERE id = $3`,
            roleType, accessLevel, row.id
          )
        }
        console.log(`${PREFIX}   Done — Role.roleType and Role.accessLevel backfilled`)
      }
    } catch (err) {
      console.error(`${PREFIX}   FAILED Role.roleType/accessLevel:`, err.message)
    }

    console.log(`${PREFIX} Pre-push migrations complete`)
  } finally {
    await prisma.$disconnect()
  }
}

runPrePushMigrations().catch((err) => {
  console.error(`${PREFIX} Fatal error:`, err.message)
  // Exit 0 so sync agent continues — prisma db push will report the real error
  process.exit(0)
})
