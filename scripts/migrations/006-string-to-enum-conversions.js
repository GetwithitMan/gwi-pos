/**
 * Migration 006: String -> Enum column casts
 *
 * Pre-creates Postgres enum types and casts text columns to enum types
 * so that prisma db push sees them as matching the schema.
 * Also adds SAF payment status fields, event-sourced order sequence,
 * CFD columns, Role roleType/accessLevel, terminal/printer columns,
 * TaxRule sync, 7shifts fields, PMS fields, COGS models, Berg tables,
 * and various other schema additions that came after the base enums.
 */

const { columnExists, tableExists, enumValueExists } = require('../migration-helpers')

async function isTextColumn(prisma, table, column) {
  const rows = await prisma.$queryRawUnsafe(
    `SELECT data_type FROM information_schema.columns WHERE table_name = $1 AND column_name = $2`,
    table, column
  )
  return rows.length > 0 && (rows[0].data_type === 'text' || rows[0].data_type === 'character varying')
}

async function ensureEnumType(prisma, typeName, values) {
  const [existing] = await prisma.$queryRawUnsafe(`SELECT typname FROM pg_type WHERE typname = $1`, typeName)
  if (!existing) {
    const valuesStr = values.map(v => `'${v}'`).join(', ')
    await prisma.$executeRawUnsafe(`CREATE TYPE "${typeName}" AS ENUM (${valuesStr})`)
  }
}

async function up(prisma) {
  const PREFIX = '[006-string-to-enum-conversions]'

  // --- Core enum casts ---
  const enumCasts = [
    ['Payment', 'paymentMethod', 'PaymentMethod', ['cash', 'card', 'credit', 'debit', 'gift_card', 'house_account', 'loyalty', 'loyalty_points']],
    ['TipLedgerEntry', 'type', 'TipLedgerEntryType', ['CREDIT', 'DEBIT']],
    ['TipTransaction', 'sourceType', 'TipTransactionSourceType', ['CARD', 'CASH', 'ADJUSTMENT']],
  ]
  for (const [table, column, enumName, values] of enumCasts) {
    try {
      const tblExists = await tableExists(prisma, table)
      if (!tblExists) continue
      if (await isTextColumn(prisma, table, column)) {
        console.log(`${PREFIX}   Converting ${table}.${column} TEXT -> ${enumName} enum...`)
        await ensureEnumType(prisma, enumName, values)
        await prisma.$executeRawUnsafe(`ALTER TABLE "${table}" ALTER COLUMN "${column}" TYPE "${enumName}" USING ("${column}"::text::"${enumName}")`)
        console.log(`${PREFIX}   Done`)
      }
    } catch (err) {
      console.error(`${PREFIX}   FAILED ${table}.${column}:`, err.message)
    }
  }

  // --- SAF payment status fields ---
  const safFields = [
    ['safStatus',     'TEXT'],
    ['safUploadedAt', 'TIMESTAMPTZ'],
    ['safError',      'TEXT'],
  ]
  for (const [column, type] of safFields) {
    try {
      const exists = await columnExists(prisma, 'Payment', column)
      if (!exists) {
        console.log(`${PREFIX}   Adding Payment.${column}...`)
        await prisma.$executeRawUnsafe(`ALTER TABLE "Payment" ADD COLUMN "${column}" ${type}`)
        console.log(`${PREFIX}   Done -- Payment.${column} added`)
      }
    } catch (err) {
      console.error(`${PREFIX}   FAILED Payment.${column}:`, err.message)
    }
  }
  // Index on safStatus
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
      console.log(`${PREFIX}   Done -- TerminalCategory.CFD_DISPLAY added`)
    }
  } catch (err) {
    console.error(`${PREFIX}   FAILED TerminalCategory.CFD_DISPLAY:`, err.message)
  }

  // --- CFD: New Terminal columns for CFD pairing ---
  const cfdTerminalFields = [
    ['cfdTerminalId',     'TEXT'],
    ['cfdIpAddress',      'TEXT'],
    ['cfdConnectionMode', `TEXT DEFAULT 'usb'`],
  ]
  for (const [column, colDef] of cfdTerminalFields) {
    try {
      const exists = await columnExists(prisma, 'Terminal', column)
      if (!exists) {
        console.log(`${PREFIX}   Adding Terminal.${column}...`)
        await prisma.$executeRawUnsafe(`ALTER TABLE "Terminal" ADD COLUMN "${column}" ${colDef}`)
        console.log(`${PREFIX}   Done -- Terminal.${column} added`)
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
      console.log(`${PREFIX}   Done -- CfdSettings table created`)
    }
  } catch (err) {
    console.error(`${PREFIX}   FAILED CfdSettings table:`, err.message)
  }

  // --- Role: Add roleType and accessLevel columns + backfill from permissions ---
  try {
    const hasRoleType = await columnExists(prisma, 'Role', 'roleType')

    // --- Order.isTaxExempt ---
    try {
      const [hasTaxExempt] = await prisma.$queryRawUnsafe(
        `SELECT column_name FROM information_schema.columns WHERE table_name = 'Order' AND column_name = 'isTaxExempt'`
      )
      if (!hasTaxExempt) {
        console.log(`${PREFIX}   Adding isTaxExempt to Order...`)
        await prisma.$executeRawUnsafe(
          `ALTER TABLE "Order" ADD COLUMN "isTaxExempt" BOOLEAN NOT NULL DEFAULT false`
        )
        console.log(`${PREFIX}   Done -- Order.isTaxExempt added`)
      }
    } catch (err) {
      console.error(`${PREFIX}   FAILED Order.isTaxExempt:`, err.message)
    }

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
      console.log(`${PREFIX}   Done -- Role.roleType and Role.accessLevel backfilled`)
    }
  } catch (err) {
    console.error(`${PREFIX}   FAILED Role.roleType/accessLevel:`, err.message)
  }

  // --- Handheld: Terminal.defaultMode ---
  try {
    const hasDefaultMode = await columnExists(prisma, 'Terminal', 'defaultMode')
    if (!hasDefaultMode) {
      console.log(`${PREFIX}   Adding defaultMode to Terminal...`)
      await prisma.$executeRawUnsafe(`ALTER TABLE "Terminal" ADD COLUMN "defaultMode" TEXT`)
      console.log(`${PREFIX}   Done -- Terminal.defaultMode added`)
    }
  } catch (err) {
    console.error(`${PREFIX}   FAILED Terminal.defaultMode:`, err.message)
  }

  // --- Sync TaxRule rates -> Location.settings.tax.defaultRate ---
  try {
    const locations = await prisma.location.findMany({ select: { id: true } })
    let synced = 0
    for (const loc of locations) {
      const rules = await prisma.taxRule.findMany({
        where: { locationId: loc.id, deletedAt: null, isActive: true },
        select: { rate: true },
      })
      if (rules.length > 0) {
        const effectiveRate = rules.reduce((sum, r) => sum + Number(r.rate), 0)
        const ratePercent = Math.round(effectiveRate * 100 * 10000) / 10000
        const location = await prisma.location.findUnique({
          where: { id: loc.id },
          select: { settings: true },
        })
        const currentSettings = location?.settings || {}
        const updatedSettings = {
          ...currentSettings,
          tax: { ...(currentSettings.tax || {}), defaultRate: ratePercent },
        }
        await prisma.location.update({
          where: { id: loc.id },
          data: { settings: updatedSettings },
        })
        synced++
        console.log(`${PREFIX}   Synced tax rate ${ratePercent}% to location ${loc.id}`)
      }
    }
    if (synced === 0) {
      console.log(`${PREFIX}   No active TaxRule records found -- settings.tax.defaultRate not modified`)
    }
  } catch (err) {
    console.warn(`${PREFIX} WARNING: Failed to sync TaxRule rates to Location settings:`, err.message)
  }

  // --- Per-terminal printer assignment (kitchenPrinterId, barPrinterId) ---
  try {
    const hasKitchenPrinter = await columnExists(prisma, 'Terminal', 'kitchenPrinterId')
    if (!hasKitchenPrinter) {
      console.log(`${PREFIX}   Adding kitchenPrinterId to Terminal...`)
      await prisma.$executeRawUnsafe(`ALTER TABLE "Terminal" ADD COLUMN IF NOT EXISTS "kitchenPrinterId" TEXT`)
      console.log(`${PREFIX}   Done -- Terminal.kitchenPrinterId added`)
    }
    const hasBarPrinter = await columnExists(prisma, 'Terminal', 'barPrinterId')
    if (!hasBarPrinter) {
      console.log(`${PREFIX}   Adding barPrinterId to Terminal...`)
      await prisma.$executeRawUnsafe(`ALTER TABLE "Terminal" ADD COLUMN IF NOT EXISTS "barPrinterId" TEXT`)
      console.log(`${PREFIX}   Done -- Terminal.barPrinterId added`)
    }
  } catch (err) {
    console.error(`${PREFIX}   FAILED Terminal printer columns:`, err.message)
  }

  // --- QuickBar tables ---
  try {
    const [qbpTable] = await prisma.$queryRawUnsafe(
      `SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'QuickBarPreference' LIMIT 1`
    )
    if (!qbpTable) {
      console.log(`${PREFIX}   Creating QuickBarPreference table...`)
      await prisma.$executeRawUnsafe(`
        CREATE TABLE IF NOT EXISTS "QuickBarPreference" (
          "id" TEXT NOT NULL PRIMARY KEY,
          "locationId" TEXT NOT NULL,
          "employeeId" TEXT NOT NULL UNIQUE,
          "itemIds" TEXT NOT NULL,
          "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
        )
      `)
      await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "QuickBarPreference_locationId_idx" ON "QuickBarPreference"("locationId")`)
      console.log(`${PREFIX}   Done -- QuickBarPreference table created`)
    }
  } catch (err) {
    console.error(`${PREFIX}   FAILED QuickBarPreference table:`, err.message)
  }

  try {
    const [qbdTable] = await prisma.$queryRawUnsafe(
      `SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'QuickBarDefault' LIMIT 1`
    )
    if (!qbdTable) {
      console.log(`${PREFIX}   Creating QuickBarDefault table...`)
      await prisma.$executeRawUnsafe(`
        CREATE TABLE IF NOT EXISTS "QuickBarDefault" (
          "id" TEXT NOT NULL PRIMARY KEY,
          "locationId" TEXT NOT NULL UNIQUE,
          "itemIds" TEXT NOT NULL,
          "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
        )
      `)
      console.log(`${PREFIX}   Done -- QuickBarDefault table created`)
    }
  } catch (err) {
    console.error(`${PREFIX}   FAILED QuickBarDefault table:`, err.message)
  }

  // --- 7shifts integration fields ---
  try {
    const sevenShiftsEmployeeCols = [
      { col: 'sevenShiftsUserId',       type: 'TEXT' },
      { col: 'sevenShiftsRoleId',       type: 'TEXT' },
      { col: 'sevenShiftsDepartmentId', type: 'TEXT' },
      { col: 'sevenShiftsLocationId',   type: 'TEXT' },
    ]
    for (const { col, type } of sevenShiftsEmployeeCols) {
      const hasCol = await columnExists(prisma, 'Employee', col)
      if (!hasCol) {
        console.log(`${PREFIX}   Adding Employee.${col}...`)
        await prisma.$executeRawUnsafe(`ALTER TABLE "Employee" ADD COLUMN IF NOT EXISTS "${col}" ${type}`)
        console.log(`${PREFIX}   Done -- Employee.${col} added`)
      }
    }
  } catch (err) {
    console.error(`${PREFIX}   FAILED 7shifts Employee columns:`, err.message)
  }

  try {
    const sevenShiftsTimePunchCols = [
      { col: 'sevenShiftsTimePunchId', type: 'TEXT' },
      { col: 'sevenShiftsPushedAt',    type: 'TIMESTAMP(3)' },
      { col: 'sevenShiftsPushError',   type: 'TEXT' },
    ]
    for (const { col, type } of sevenShiftsTimePunchCols) {
      const hasCol = await columnExists(prisma, 'TimeClockEntry', col)
      if (!hasCol) {
        console.log(`${PREFIX}   Adding TimeClockEntry.${col}...`)
        await prisma.$executeRawUnsafe(`ALTER TABLE "TimeClockEntry" ADD COLUMN IF NOT EXISTS "${col}" ${type}`)
        console.log(`${PREFIX}   Done -- TimeClockEntry.${col} added`)
      }
    }
  } catch (err) {
    console.error(`${PREFIX}   FAILED 7shifts TimeClockEntry columns:`, err.message)
  }

  try {
    const hasSevenShiftsShiftId = await columnExists(prisma, 'ScheduledShift', 'sevenShiftsShiftId')
    if (!hasSevenShiftsShiftId) {
      console.log(`${PREFIX}   Adding ScheduledShift.sevenShiftsShiftId...`)
      await prisma.$executeRawUnsafe(`ALTER TABLE "ScheduledShift" ADD COLUMN IF NOT EXISTS "sevenShiftsShiftId" TEXT`)
      await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "ScheduledShift_sevenShiftsShiftId_idx" ON "ScheduledShift"("sevenShiftsShiftId")`)
      console.log(`${PREFIX}   Done -- ScheduledShift.sevenShiftsShiftId added`)
    }
  } catch (err) {
    console.error(`${PREFIX}   FAILED 7shifts ScheduledShift column:`, err.message)
  }

  try {
    const [ssTable] = await prisma.$queryRawUnsafe(
      `SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'SevenShiftsDailySalesPush' LIMIT 1`
    )
    if (!ssTable) {
      console.log(`${PREFIX}   Creating SevenShiftsDailySalesPush table...`)
      await prisma.$executeRawUnsafe(`
        CREATE TABLE IF NOT EXISTS "SevenShiftsDailySalesPush" (
          "id"                   TEXT NOT NULL PRIMARY KEY,
          "locationId"           TEXT NOT NULL,
          "businessDate"         TEXT NOT NULL,
          "revenueType"          TEXT NOT NULL,
          "sevenShiftsReceiptId" TEXT,
          "netTotalCents"        INTEGER NOT NULL,
          "tipsAmountCents"      INTEGER NOT NULL DEFAULT 0,
          "status"               TEXT NOT NULL DEFAULT 'pending',
          "errorMessage"         TEXT,
          "pushedAt"             TIMESTAMP(3),
          "createdAt"            TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
          "updatedAt"            TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
          CONSTRAINT "SevenShiftsDailySalesPush_locationId_fkey"
            FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
          CONSTRAINT "SevenShiftsDailySalesPush_locationId_businessDate_revenueType_key"
            UNIQUE ("locationId", "businessDate", "revenueType")
        )
      `)
      await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "SevenShiftsDailySalesPush_locationId_idx" ON "SevenShiftsDailySalesPush"("locationId")`)
      await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "SevenShiftsDailySalesPush_businessDate_idx" ON "SevenShiftsDailySalesPush"("businessDate")`)
      await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "SevenShiftsDailySalesPush_status_idx" ON "SevenShiftsDailySalesPush"("status")`)
      console.log(`${PREFIX}   Done -- SevenShiftsDailySalesPush table created`)
    }
  } catch (err) {
    console.error(`${PREFIX}   FAILED SevenShiftsDailySalesPush table:`, err.message)
  }

  // --- Hotel PMS / room_charge Payment fields ---
  try {
    const pmsCols = [
      { col: 'roomNumber', type: 'TEXT' },
      { col: 'guestName', type: 'TEXT' },
      { col: 'pmsReservationId', type: 'TEXT' },
      { col: 'pmsTransactionId', type: 'TEXT' },
    ]
    for (const { col, type } of pmsCols) {
      const hasCol = await columnExists(prisma, 'Payment', col)
      if (!hasCol) {
        console.log(`${PREFIX}   Adding Payment.${col}...`)
        await prisma.$executeRawUnsafe(`ALTER TABLE "Payment" ADD COLUMN IF NOT EXISTS "${col}" ${type}`)
        console.log(`${PREFIX}   Done -- Payment.${col} added`)
      }
    }
    // Add room_charge to PaymentMethod enum (Postgres ALTER TYPE)
    await prisma.$executeRawUnsafe(
      `DO $$ BEGIN ALTER TYPE "PaymentMethod" ADD VALUE IF NOT EXISTS 'room_charge'; EXCEPTION WHEN duplicate_object THEN NULL; END $$`
    )
  } catch (err) {
    console.error(`${PREFIX}   FAILED Hotel PMS Payment columns:`, err.message)
  }

  // --- PmsChargeAttempt table ---
  try {
    await prisma.$executeRawUnsafe(
      `DO $$ BEGIN CREATE TYPE "PmsAttemptStatus" AS ENUM ('PENDING', 'COMPLETED', 'FAILED'); EXCEPTION WHEN duplicate_object THEN NULL; END $$`
    )
    await prisma.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS "PmsChargeAttempt" (
        "id" TEXT NOT NULL,
        "idempotencyKey" TEXT NOT NULL,
        "locationId" TEXT NOT NULL,
        "orderId" TEXT NOT NULL,
        "reservationId" TEXT NOT NULL,
        "amountCents" INTEGER NOT NULL,
        "chargeCode" TEXT NOT NULL,
        "status" "PmsAttemptStatus" NOT NULL DEFAULT 'PENDING',
        "operaTransactionId" TEXT,
        "providerRequestId" TEXT,
        "employeeId" TEXT,
        "lastErrorMessage" TEXT,
        "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT "PmsChargeAttempt_pkey" PRIMARY KEY ("id")
      )
    `)
    await prisma.$executeRawUnsafe(
      `CREATE UNIQUE INDEX IF NOT EXISTS "PmsChargeAttempt_idempotencyKey_key" ON "PmsChargeAttempt"("idempotencyKey")`
    )
    await prisma.$executeRawUnsafe(
      `CREATE INDEX IF NOT EXISTS "PmsChargeAttempt_orderId_idx" ON "PmsChargeAttempt"("orderId")`
    )
    await prisma.$executeRawUnsafe(
      `CREATE INDEX IF NOT EXISTS "PmsChargeAttempt_reservationId_idx" ON "PmsChargeAttempt"("reservationId")`
    )
    await prisma.$executeRawUnsafe(
      `CREATE INDEX IF NOT EXISTS "PmsChargeAttempt_locationId_createdAt_idx" ON "PmsChargeAttempt"("locationId", "createdAt")`
    )
    console.log(`${PREFIX}   PmsChargeAttempt table ready`)
  } catch (err) {
    console.error(`${PREFIX}   FAILED PmsChargeAttempt:`, err.message)
  }

  // ====================================================================
  // COGS / MarginEdge / Invoice Extensions
  // ====================================================================

  // --- New enum types ---
  try {
    await prisma.$executeRawUnsafe(
      `DO $$ BEGIN CREATE TYPE "InvoiceSource" AS ENUM ('manual', 'marginedge', 'api'); EXCEPTION WHEN duplicate_object THEN NULL; END $$`
    )
    await prisma.$executeRawUnsafe(
      `DO $$ BEGIN CREATE TYPE "VendorOrderStatus" AS ENUM ('draft', 'sent', 'confirmed', 'received', 'cancelled'); EXCEPTION WHEN duplicate_object THEN NULL; END $$`
    )
    await prisma.$executeRawUnsafe(
      `DO $$ BEGIN CREATE TYPE "WasteReason" AS ENUM ('spoilage', 'over_pour', 'spill', 'breakage', 'expired', 'void_comped', 'other'); EXCEPTION WHEN duplicate_object THEN NULL; END $$`
    )
    await prisma.$executeRawUnsafe(`DO $$ BEGIN ALTER TYPE "VendorOrderStatus" ADD VALUE IF NOT EXISTS 'partially_received'; EXCEPTION WHEN duplicate_object THEN NULL; END $$`)
    await prisma.$executeRawUnsafe(`DO $$ BEGIN ALTER TYPE "InvoiceStatus" ADD VALUE IF NOT EXISTS 'draft'; EXCEPTION WHEN duplicate_object THEN NULL; END $$`)
    await prisma.$executeRawUnsafe(`DO $$ BEGIN ALTER TYPE "InvoiceStatus" ADD VALUE IF NOT EXISTS 'approved'; EXCEPTION WHEN duplicate_object THEN NULL; END $$`)
    await prisma.$executeRawUnsafe(`DO $$ BEGIN ALTER TYPE "InvoiceStatus" ADD VALUE IF NOT EXISTS 'posted'; EXCEPTION WHEN duplicate_object THEN NULL; END $$`)
    await prisma.$executeRawUnsafe(`DO $$ BEGIN ALTER TYPE "InvoiceStatus" ADD VALUE IF NOT EXISTS 'voided'; EXCEPTION WHEN duplicate_object THEN NULL; END $$`)
    await prisma.$executeRawUnsafe(`DO $$ BEGIN ALTER TYPE "InventoryCountStatus" ADD VALUE IF NOT EXISTS 'voided'; EXCEPTION WHEN duplicate_object THEN NULL; END $$`)
    console.log(`${PREFIX}   COGS enum types ready`)
  } catch (err) {
    console.error(`${PREFIX}   FAILED COGS enum types:`, err.message)
  }

  // --- Invoice: new columns ---
  try {
    const invoiceCols = [
      { col: 'deliveryDate', type: 'TIMESTAMP(3)' },
      { col: 'source', type: `TEXT NOT NULL DEFAULT 'manual'` },
      { col: 'marginEdgeInvoiceId', type: 'TEXT' },
      { col: 'createdById', type: 'TEXT' },
      { col: 'approvedById', type: 'TEXT' },
      { col: 'approvedAt', type: 'TIMESTAMP(3)' },
    ]
    for (const { col, type } of invoiceCols) {
      const hasCol = await columnExists(prisma, 'Invoice', col)
      if (!hasCol) {
        console.log(`${PREFIX}   Adding Invoice.${col}...`)
        await prisma.$executeRawUnsafe(`ALTER TABLE "Invoice" ADD COLUMN IF NOT EXISTS "${col}" ${type}`)
        console.log(`${PREFIX}   Done -- Invoice.${col} added`)
      }
    }
    await prisma.$executeRawUnsafe(`DROP INDEX IF EXISTS "Invoice_marginEdgeInvoiceId_key"`)
    await prisma.$executeRawUnsafe(`DROP INDEX IF EXISTS "Invoice_locationId_marginEdgeInvoiceId_key"`)
  } catch (err) {
    console.error(`${PREFIX}   FAILED Invoice COGS columns:`, err.message)
  }

  // --- InvoiceLineItem: new column ---
  try {
    const hasCol = await columnExists(prisma, 'InvoiceLineItem', 'marginEdgeProductId')
    if (!hasCol) {
      console.log(`${PREFIX}   Adding InvoiceLineItem.marginEdgeProductId...`)
      await prisma.$executeRawUnsafe(`ALTER TABLE "InvoiceLineItem" ADD COLUMN IF NOT EXISTS "marginEdgeProductId" TEXT`)
      console.log(`${PREFIX}   Done -- InvoiceLineItem.marginEdgeProductId added`)
    }
  } catch (err) {
    console.error(`${PREFIX}   FAILED InvoiceLineItem.marginEdgeProductId:`, err.message)
  }

  // --- InventoryTransaction: new columns ---
  try {
    const invTxnCols = [
      { col: 'businessDate', type: 'TIMESTAMP(3)' },
      { col: 'source', type: 'TEXT' },
      { col: 'wasteLogId', type: 'TEXT' },
      { col: 'invoiceId', type: 'TEXT' },
    ]
    for (const { col, type } of invTxnCols) {
      const hasCol = await columnExists(prisma, 'InventoryTransaction', col)
      if (!hasCol) {
        console.log(`${PREFIX}   Adding InventoryTransaction.${col}...`)
        await prisma.$executeRawUnsafe(`ALTER TABLE "InventoryTransaction" ADD COLUMN IF NOT EXISTS "${col}" ${type}`)
        console.log(`${PREFIX}   Done -- InventoryTransaction.${col} added`)
      }
    }
  } catch (err) {
    console.error(`${PREFIX}   FAILED InventoryTransaction COGS columns:`, err.message)
  }

  // --- InventoryItem: new columns ---
  try {
    const invItemCols = [
      { col: 'lastInvoiceCost', type: 'DECIMAL(10,4)' },
      { col: 'lastInvoiceDate', type: 'TIMESTAMP(3)' },
      { col: 'marginEdgeProductId', type: 'TEXT' },
      { col: 'averageCost', type: 'DECIMAL(10,4)' },
    ]
    for (const { col, type } of invItemCols) {
      const hasCol = await columnExists(prisma, 'InventoryItem', col)
      if (!hasCol) {
        console.log(`${PREFIX}   Adding InventoryItem.${col}...`)
        await prisma.$executeRawUnsafe(`ALTER TABLE "InventoryItem" ADD COLUMN IF NOT EXISTS "${col}" ${type}`)
        console.log(`${PREFIX}   Done -- InventoryItem.${col} added`)
      }
    }
  } catch (err) {
    console.error(`${PREFIX}   FAILED InventoryItem COGS columns:`, err.message)
  }

  // --- InventoryCount: new columns ---
  try {
    const invCountCols = [
      { col: 'categoryFilter', type: 'TEXT' },
      { col: 'totalVarianceCost', type: 'DECIMAL(10,2)' },
    ]
    for (const { col, type } of invCountCols) {
      const hasCol = await columnExists(prisma, 'InventoryCount', col)
      if (!hasCol) {
        console.log(`${PREFIX}   Adding InventoryCount.${col}...`)
        await prisma.$executeRawUnsafe(`ALTER TABLE "InventoryCount" ADD COLUMN IF NOT EXISTS "${col}" ${type}`)
        console.log(`${PREFIX}   Done -- InventoryCount.${col} added`)
      }
    }
  } catch (err) {
    console.error(`${PREFIX}   FAILED InventoryCount COGS columns:`, err.message)
  }

  // --- COGS tables: IngredientCostHistory, VendorOrder, VendorOrderLineItem, etc. ---
  try {
    await prisma.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS "IngredientCostHistory" (
        "id" TEXT NOT NULL,
        "locationId" TEXT NOT NULL,
        "inventoryItemId" TEXT NOT NULL,
        "oldCostPerUnit" DECIMAL(10,4) NOT NULL,
        "newCostPerUnit" DECIMAL(10,4) NOT NULL,
        "changePercent" DECIMAL(6,2) NOT NULL,
        "source" TEXT NOT NULL,
        "invoiceId" TEXT,
        "invoiceNumber" TEXT,
        "vendorName" TEXT,
        "recordedById" TEXT,
        "effectiveDate" TIMESTAMP(3) NOT NULL,
        "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT "IngredientCostHistory_pkey" PRIMARY KEY ("id")
      )
    `)
    await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "IngredientCostHistory_locationId_inventoryItemId_effectiveDate_idx" ON "IngredientCostHistory"("locationId", "inventoryItemId", "effectiveDate")`)
    await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "IngredientCostHistory_locationId_effectiveDate_idx" ON "IngredientCostHistory"("locationId", "effectiveDate")`)
    console.log(`${PREFIX}   IngredientCostHistory table ready`)
  } catch (err) {
    console.error(`${PREFIX}   FAILED IngredientCostHistory:`, err.message)
  }

  try {
    await prisma.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS "VendorOrder" (
        "id" TEXT NOT NULL,
        "locationId" TEXT NOT NULL,
        "vendorId" TEXT NOT NULL,
        "orderNumber" TEXT,
        "status" "VendorOrderStatus" NOT NULL DEFAULT 'draft',
        "orderDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "expectedDelivery" TIMESTAMP(3),
        "receivedAt" TIMESTAMP(3),
        "totalEstimated" DECIMAL(10,2),
        "totalActual" DECIMAL(10,2),
        "notes" TEXT,
        "createdById" TEXT,
        "receivedById" TEXT,
        "linkedInvoiceId" TEXT,
        "deletedAt" TIMESTAMP(3),
        "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT "VendorOrder_pkey" PRIMARY KEY ("id")
      )
    `)
    await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "VendorOrder_locationId_status_idx" ON "VendorOrder"("locationId", "status")`)
    await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "VendorOrder_locationId_orderDate_idx" ON "VendorOrder"("locationId", "orderDate")`)
    console.log(`${PREFIX}   VendorOrder table ready`)
  } catch (err) {
    console.error(`${PREFIX}   FAILED VendorOrder:`, err.message)
  }

  try {
    await prisma.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS "VendorOrderLineItem" (
        "id" TEXT NOT NULL,
        "locationId" TEXT NOT NULL,
        "vendorOrderId" TEXT NOT NULL,
        "inventoryItemId" TEXT NOT NULL,
        "quantity" DECIMAL(10,4) NOT NULL,
        "unit" TEXT NOT NULL,
        "estimatedCost" DECIMAL(10,4),
        "actualCost" DECIMAL(10,4),
        "receivedQty" DECIMAL(10,4),
        "notes" TEXT,
        "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "deletedAt" TIMESTAMP(3),
        CONSTRAINT "VendorOrderLineItem_pkey" PRIMARY KEY ("id")
      )
    `)
    if (!(await columnExists(prisma, 'VendorOrderLineItem', 'locationId'))) {
      await prisma.$executeRawUnsafe(`ALTER TABLE "VendorOrderLineItem" ADD COLUMN IF NOT EXISTS "locationId" TEXT NOT NULL DEFAULT ''`)
      await prisma.$executeRawUnsafe(`UPDATE "VendorOrderLineItem" vol SET "locationId" = vo."locationId" FROM "VendorOrder" vo WHERE vol."vendorOrderId" = vo.id AND vol."locationId" = ''`)
    }
    if (!(await columnExists(prisma, 'VendorOrderLineItem', 'deletedAt'))) {
      await prisma.$executeRawUnsafe(`ALTER TABLE "VendorOrderLineItem" ADD COLUMN IF NOT EXISTS "deletedAt" TIMESTAMP(3)`)
    }
    await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "VendorOrderLineItem_locationId_idx" ON "VendorOrderLineItem"("locationId")`)
    await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "VendorOrderLineItem_locationId_vendorOrderId_idx" ON "VendorOrderLineItem"("locationId","vendorOrderId")`)
    await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "VendorOrderLineItem_locationId_deletedAt_idx" ON "VendorOrderLineItem"("locationId","deletedAt")`)
    await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "VendorOrderLineItem_vendorOrderId_idx" ON "VendorOrderLineItem"("vendorOrderId")`)
    await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "VendorOrderLineItem_inventoryItemId_idx" ON "VendorOrderLineItem"("inventoryItemId")`)
    console.log(`${PREFIX}   VendorOrderLineItem table ready`)
  } catch (err) {
    console.error(`${PREFIX}   FAILED VendorOrderLineItem:`, err.message)
  }

  try {
    await prisma.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS "InventoryCountEntry" (
        "id" TEXT NOT NULL,
        "locationId" TEXT NOT NULL,
        "inventoryCountId" TEXT NOT NULL,
        "inventoryItemId" TEXT NOT NULL,
        "expectedQty" DECIMAL(10,4),
        "countedQty" DECIMAL(10,4) NOT NULL,
        "unit" TEXT NOT NULL,
        "variance" DECIMAL(10,4),
        "unitCost" DECIMAL(10,4) NOT NULL,
        "varianceCost" DECIMAL(10,2),
        "notes" TEXT,
        "countedById" TEXT,
        "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT "InventoryCountEntry_pkey" PRIMARY KEY ("id"),
        CONSTRAINT "InventoryCountEntry_inventoryCountId_inventoryItemId_key" UNIQUE ("inventoryCountId", "inventoryItemId")
      )
    `)
    await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "InventoryCountEntry_inventoryCountId_idx" ON "InventoryCountEntry"("inventoryCountId")`)
    await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "InventoryCountEntry_inventoryItemId_idx" ON "InventoryCountEntry"("inventoryItemId")`)
    console.log(`${PREFIX}   InventoryCountEntry table ready`)
  } catch (err) {
    console.error(`${PREFIX}   FAILED InventoryCountEntry:`, err.message)
  }

  try {
    await prisma.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS "WasteLog" (
        "id" TEXT NOT NULL,
        "locationId" TEXT NOT NULL,
        "inventoryItemId" TEXT,
        "bottleProductId" TEXT,
        "quantity" DECIMAL(10,4) NOT NULL,
        "unit" TEXT NOT NULL,
        "cost" DECIMAL(10,2) NOT NULL,
        "reason" "WasteReason" NOT NULL,
        "notes" TEXT,
        "recordedById" TEXT NOT NULL,
        "businessDate" TIMESTAMP(3) NOT NULL,
        "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT "WasteLog_pkey" PRIMARY KEY ("id")
      )
    `)
    await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "WasteLog_locationId_businessDate_idx" ON "WasteLog"("locationId", "businessDate")`)
    await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "WasteLog_locationId_reason_idx" ON "WasteLog"("locationId", "reason")`)
    console.log(`${PREFIX}   WasteLog table ready`)
  } catch (err) {
    console.error(`${PREFIX}   FAILED WasteLog:`, err.message)
  }

  try {
    await prisma.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS "MarginEdgeProductMapping" (
        "id" TEXT NOT NULL,
        "locationId" TEXT NOT NULL,
        "marginEdgeProductId" TEXT NOT NULL,
        "marginEdgeProductName" TEXT NOT NULL,
        "inventoryItemId" TEXT NOT NULL,
        "marginEdgeVendorId" TEXT,
        "marginEdgeVendorName" TEXT,
        "marginEdgeUnit" TEXT,
        "lastSyncAt" TIMESTAMP(3),
        "isActive" BOOLEAN NOT NULL DEFAULT true,
        "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT "MarginEdgeProductMapping_pkey" PRIMARY KEY ("id"),
        CONSTRAINT "MarginEdgeProductMapping_locationId_marginEdgeProductId_key" UNIQUE ("locationId", "marginEdgeProductId")
      )
    `)
    await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "MarginEdgeProductMapping_locationId_inventoryItemId_idx" ON "MarginEdgeProductMapping"("locationId", "inventoryItemId")`)
    console.log(`${PREFIX}   MarginEdgeProductMapping table ready`)
  } catch (err) {
    console.error(`${PREFIX}   FAILED MarginEdgeProductMapping:`, err.message)
  }

  try {
    await prisma.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS "MenuItemDailyMetrics" (
        "id" TEXT NOT NULL,
        "locationId" TEXT NOT NULL,
        "menuItemId" TEXT NOT NULL,
        "businessDate" TIMESTAMP(3) NOT NULL,
        "quantitySold" INTEGER NOT NULL DEFAULT 0,
        "totalRevenue" DECIMAL(10,2) NOT NULL DEFAULT 0,
        "totalCost" DECIMAL(10,2) NOT NULL DEFAULT 0,
        "foodCostPct" DECIMAL(6,2),
        "contributionMargin" DECIMAL(10,2),
        "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT "MenuItemDailyMetrics_pkey" PRIMARY KEY ("id"),
        CONSTRAINT "MenuItemDailyMetrics_locationId_menuItemId_businessDate_key" UNIQUE ("locationId", "menuItemId", "businessDate")
      )
    `)
    await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "MenuItemDailyMetrics_locationId_businessDate_idx" ON "MenuItemDailyMetrics"("locationId", "businessDate")`)
    await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "MenuItemDailyMetrics_locationId_menuItemId_idx" ON "MenuItemDailyMetrics"("locationId", "menuItemId")`)
    console.log(`${PREFIX}   MenuItemDailyMetrics table ready`)
  } catch (err) {
    console.error(`${PREFIX}   FAILED MenuItemDailyMetrics:`, err.message)
  }

  // --- Deduction tables ---
  try {
    await prisma.$executeRawUnsafe(`DO $$ BEGIN CREATE TYPE "DeductionStatus" AS ENUM ('pending', 'processing', 'succeeded', 'failed', 'dead'); EXCEPTION WHEN duplicate_object THEN NULL; END $$`)
    await prisma.$executeRawUnsafe(`DO $$ BEGIN CREATE TYPE "DeductionType" AS ENUM ('order_deduction', 'liquor_only', 'food_only'); EXCEPTION WHEN duplicate_object THEN NULL; END $$`)
    console.log(`${PREFIX}   DeductionStatus + DeductionType enums ready`)
  } catch (err) {
    console.error(`${PREFIX}   FAILED Deduction enums:`, err.message)
  }

  try {
    await prisma.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS "PendingDeduction" (
        "id" TEXT NOT NULL,
        "locationId" TEXT NOT NULL,
        "orderId" TEXT NOT NULL,
        "paymentId" TEXT,
        "deductionType" "DeductionType" NOT NULL DEFAULT 'order_deduction',
        "status" "DeductionStatus" NOT NULL DEFAULT 'pending',
        "attempts" INTEGER NOT NULL DEFAULT 0,
        "maxAttempts" INTEGER NOT NULL DEFAULT 5,
        "availableAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "lastError" TEXT,
        "lastAttemptAt" TIMESTAMP(3),
        "succeededAt" TIMESTAMP(3),
        "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT "PendingDeduction_pkey" PRIMARY KEY ("id"),
        CONSTRAINT "PendingDeduction_orderId_key" UNIQUE ("orderId")
      )
    `)
    await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "PendingDeduction_locationId_status_availableAt_idx" ON "PendingDeduction"("locationId", "status", "availableAt")`)
    await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "PendingDeduction_status_availableAt_idx" ON "PendingDeduction"("status", "availableAt")`)
    console.log(`${PREFIX}   PendingDeduction table ready`)
  } catch (err) {
    console.error(`${PREFIX}   FAILED PendingDeduction:`, err.message)
  }

  try {
    await prisma.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS "DeductionRun" (
        "id" TEXT NOT NULL,
        "pendingDeductionId" TEXT NOT NULL,
        "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "finishedAt" TIMESTAMP(3),
        "success" BOOLEAN,
        "resultSummary" JSONB,
        "error" TEXT,
        "durationMs" INTEGER,
        CONSTRAINT "DeductionRun_pkey" PRIMARY KEY ("id"),
        CONSTRAINT "DeductionRun_pendingDeductionId_fkey" FOREIGN KEY ("pendingDeductionId") REFERENCES "PendingDeduction"("id") ON DELETE CASCADE
      )
    `)
    await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "DeductionRun_pendingDeductionId_idx" ON "DeductionRun"("pendingDeductionId")`)
    console.log(`${PREFIX}   DeductionRun table ready`)
  } catch (err) {
    console.error(`${PREFIX}   FAILED DeductionRun:`, err.message)
  }

  // --- InventoryItemTransaction: add deductionJobId column ---
  try {
    if (!(await columnExists(prisma, 'InventoryItemTransaction', 'deductionJobId'))) {
      await prisma.$executeRawUnsafe(`ALTER TABLE "InventoryItemTransaction" ADD COLUMN "deductionJobId" TEXT`)
      console.log(`${PREFIX}   InventoryItemTransaction.deductionJobId added`)
    }
    await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "InventoryItemTransaction_locationId_deductionJobId_idx" ON "InventoryItemTransaction"("locationId", "deductionJobId")`)
    console.log(`${PREFIX}   InventoryItemTransaction.deductionJobId index ready`)
  } catch (err) {
    console.error(`${PREFIX}   FAILED InventoryItemTransaction.deductionJobId:`, err.message)
  }

  // --- Fix Beer/Wine categories ---
  try {
    await prisma.$executeRawUnsafe(`
      UPDATE "Category"
      SET "categoryType" = 'liquor'
      WHERE "id" IN ('cat-beer', 'cat-wine')
        AND "categoryType" = 'drinks'
    `)
    console.log(`${PREFIX}   Beer/Wine category type fix applied`)
  } catch (err) {
    console.error(`${PREFIX}   FAILED Beer/Wine category fix:`, err.message)
  }

  // --- Berg tables and enums ---
  // (BergPluMapping, BergDevice, BergDispenseEvent, Berg enum types)
  try {
    await prisma.$executeRawUnsafe(`
      DO $$ BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'BergDeviceModel') THEN
          CREATE TYPE "BergDeviceModel" AS ENUM ('MODEL_1504_704','LASER','ALL_BOTTLE_ABID','TAP2','FLOW_MONITOR');
        END IF;
        IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'BergInterfaceMethod') THEN
          CREATE TYPE "BergInterfaceMethod" AS ENUM ('DIRECT_RING_UP','PRE_CHECK','FILE_POSTING','RING_AND_SLING');
        END IF;
        IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'BergPourReleaseMode') THEN
          CREATE TYPE "BergPourReleaseMode" AS ENUM ('BEST_EFFORT','REQUIRES_OPEN_ORDER');
        END IF;
        IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'BergTimeoutPolicy') THEN
          CREATE TYPE "BergTimeoutPolicy" AS ENUM ('ACK_ON_TIMEOUT','NAK_ON_TIMEOUT');
        END IF;
        IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'BergAutoRingMode') THEN
          CREATE TYPE "BergAutoRingMode" AS ENUM ('OFF','AUTO_RING');
        END IF;
        IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'BergDispenseStatus') THEN
          CREATE TYPE "BergDispenseStatus" AS ENUM ('ACK','NAK','ACK_TIMEOUT','NAK_TIMEOUT','ACK_BEST_EFFORT');
        END IF;
        IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'BergParseStatus') THEN
          CREATE TYPE "BergParseStatus" AS ENUM ('OK','BAD_LRC','BAD_PACKET','NO_STX','OVERFLOW','UNMAPPED_PLU');
        END IF;
        IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'BergResolutionStatus') THEN
          CREATE TYPE "BergResolutionStatus" AS ENUM ('NONE','PARTIAL','FULL');
        END IF;
        IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'BergPostProcessStatus') THEN
          CREATE TYPE "BergPostProcessStatus" AS ENUM ('PENDING','DONE','FAILED');
        END IF;
      END $$
    `)
    console.log(`${PREFIX}   Berg enum types ready`)
  } catch (err) {
    console.error(`${PREFIX}   FAILED Berg enum types:`, err.message)
  }

  // --- BergDevice table ---
  try {
    await prisma.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS "BergDevice" (
        "id" TEXT NOT NULL,
        "locationId" TEXT NOT NULL,
        "terminalId" TEXT,
        "name" TEXT NOT NULL,
        "model" TEXT NOT NULL DEFAULT 'MODEL_1504_704',
        "portName" TEXT NOT NULL,
        "baudRate" INTEGER NOT NULL DEFAULT 9600,
        "isPluBased" BOOLEAN NOT NULL DEFAULT true,
        "isActive" BOOLEAN NOT NULL DEFAULT true,
        "interfaceMethod" TEXT NOT NULL DEFAULT 'DIRECT_RING_UP',
        "pourReleaseMode" TEXT NOT NULL DEFAULT 'BEST_EFFORT',
        "timeoutPolicy" TEXT NOT NULL DEFAULT 'ACK_ON_TIMEOUT',
        "autoRingMode" TEXT NOT NULL DEFAULT 'AUTO_RING',
        "ackTimeoutMs" INTEGER NOT NULL DEFAULT 3000,
        "deductInventoryWhenNoOrder" BOOLEAN NOT NULL DEFAULT false,
        "lastSeenAt" TIMESTAMP(3),
        "lastError" TEXT,
        "bridgeSecretHash" TEXT,
        "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updatedAt" TIMESTAMP(3) NOT NULL,
        CONSTRAINT "BergDevice_pkey" PRIMARY KEY ("id"),
        CONSTRAINT "BergDevice_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE RESTRICT ON UPDATE CASCADE
      )
    `)
    await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "BergDevice_locationId_idx" ON "BergDevice"("locationId")`)
    await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "BergDevice_locationId_isActive_idx" ON "BergDevice"("locationId", "isActive")`)
    // Alter TEXT enum columns to native PG enum types
    await prisma.$executeRawUnsafe(`
      DO $$ BEGIN
        IF (SELECT data_type FROM information_schema.columns WHERE table_name='BergDevice' AND column_name='model') = 'text' THEN
          ALTER TABLE "BergDevice" ALTER COLUMN "model" DROP DEFAULT;
          ALTER TABLE "BergDevice" ALTER COLUMN "interfaceMethod" DROP DEFAULT;
          ALTER TABLE "BergDevice" ALTER COLUMN "pourReleaseMode" DROP DEFAULT;
          ALTER TABLE "BergDevice" ALTER COLUMN "timeoutPolicy" DROP DEFAULT;
          ALTER TABLE "BergDevice" ALTER COLUMN "autoRingMode" DROP DEFAULT;
          ALTER TABLE "BergDevice" ALTER COLUMN "model" TYPE "BergDeviceModel" USING "model"::"BergDeviceModel";
          ALTER TABLE "BergDevice" ALTER COLUMN "interfaceMethod" TYPE "BergInterfaceMethod" USING "interfaceMethod"::"BergInterfaceMethod";
          ALTER TABLE "BergDevice" ALTER COLUMN "pourReleaseMode" TYPE "BergPourReleaseMode" USING "pourReleaseMode"::"BergPourReleaseMode";
          ALTER TABLE "BergDevice" ALTER COLUMN "timeoutPolicy" TYPE "BergTimeoutPolicy" USING "timeoutPolicy"::"BergTimeoutPolicy";
          ALTER TABLE "BergDevice" ALTER COLUMN "autoRingMode" TYPE "BergAutoRingMode" USING "autoRingMode"::"BergAutoRingMode";
          ALTER TABLE "BergDevice" ALTER COLUMN "model" SET DEFAULT 'MODEL_1504_704'::"BergDeviceModel";
          ALTER TABLE "BergDevice" ALTER COLUMN "interfaceMethod" SET DEFAULT 'DIRECT_RING_UP'::"BergInterfaceMethod";
          ALTER TABLE "BergDevice" ALTER COLUMN "pourReleaseMode" SET DEFAULT 'BEST_EFFORT'::"BergPourReleaseMode";
          ALTER TABLE "BergDevice" ALTER COLUMN "timeoutPolicy" SET DEFAULT 'ACK_ON_TIMEOUT'::"BergTimeoutPolicy";
          ALTER TABLE "BergDevice" ALTER COLUMN "autoRingMode" SET DEFAULT 'AUTO_RING'::"BergAutoRingMode";
        END IF;
      END $$
    `)
    await prisma.$executeRawUnsafe(`ALTER TABLE "BergDevice" ADD COLUMN IF NOT EXISTS "bridgeSecretEncrypted" TEXT`)
    await prisma.$executeRawUnsafe(`ALTER TABLE "BergDevice" ADD COLUMN IF NOT EXISTS "bridgeSecretKeyVersion" INTEGER NOT NULL DEFAULT 1`)
    await prisma.$executeRawUnsafe(`ALTER TABLE "BergDevice" ADD COLUMN IF NOT EXISTS "autoRingOnlyWhenSingleOpenOrder" BOOLEAN NOT NULL DEFAULT false`)
    console.log(`${PREFIX}   BergDevice table ready`)
  } catch (err) {
    console.error(`${PREFIX}   FAILED BergDevice:`, err.message)
  }

  // --- BergPluMapping table ---
  try {
    await prisma.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS "BergPluMapping" (
        "id" TEXT NOT NULL,
        "locationId" TEXT NOT NULL,
        "deviceId" TEXT,
        "mappingScopeKey" TEXT NOT NULL,
        "pluNumber" INTEGER NOT NULL,
        "bottleProductId" TEXT,
        "inventoryItemId" TEXT,
        "menuItemId" TEXT,
        "description" TEXT,
        "pourSizeOzOverride" DECIMAL(6,3),
        "modifierRule" JSONB,
        "trailerRule" JSONB,
        "isActive" BOOLEAN NOT NULL DEFAULT true,
        "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT "BergPluMapping_pkey" PRIMARY KEY ("id"),
        CONSTRAINT "BergPluMapping_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
        CONSTRAINT "BergPluMapping_deviceId_fkey" FOREIGN KEY ("deviceId") REFERENCES "BergDevice"("id") ON DELETE SET NULL ON UPDATE CASCADE
      )
    `)
    await prisma.$executeRawUnsafe(`CREATE UNIQUE INDEX IF NOT EXISTS "BergPluMapping_mappingScopeKey_pluNumber_key" ON "BergPluMapping"("mappingScopeKey", "pluNumber")`)
    await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "BergPluMapping_locationId_idx" ON "BergPluMapping"("locationId")`)
    await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "BergPluMapping_locationId_isActive_idx" ON "BergPluMapping"("locationId", "isActive")`)
    await prisma.$executeRawUnsafe(`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM pg_constraint WHERE conname = 'check_mapping_scope_key'
        ) THEN
          ALTER TABLE "BergPluMapping" ADD CONSTRAINT "check_mapping_scope_key"
            CHECK ("mappingScopeKey" ~ '^(device|location):[a-zA-Z0-9_-]+$');
        END IF;
      END $$;
    `)
    console.log(`${PREFIX}   BergPluMapping table ready`)
  } catch (err) {
    console.error(`${PREFIX}   FAILED BergPluMapping:`, err.message)
  }

  // --- BergDispenseEvent table ---
  try {
    await prisma.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS "BergDispenseEvent" (
        "id" TEXT NOT NULL,
        "locationId" TEXT NOT NULL,
        "deviceId" TEXT NOT NULL,
        "pluMappingId" TEXT,
        "pluNumber" INTEGER NOT NULL,
        "rawPacket" TEXT NOT NULL,
        "modifierBytes" TEXT,
        "trailerBytes" TEXT,
        "parseStatus" TEXT NOT NULL,
        "lrcReceived" TEXT NOT NULL,
        "lrcCalculated" TEXT NOT NULL,
        "lrcValid" BOOLEAN NOT NULL,
        "status" TEXT NOT NULL,
        "unmatchedType" TEXT,
        "pourSizeOz" DECIMAL(6,3),
        "pourCost" DECIMAL(10,2),
        "orderId" TEXT,
        "orderItemId" TEXT,
        "employeeId" TEXT,
        "terminalId" TEXT,
        "ackLatencyMs" INTEGER,
        "ackTimeoutMs" INTEGER NOT NULL,
        "errorReason" TEXT,
        "businessDate" TIMESTAMP(3),
        "idempotencyKey" TEXT NOT NULL,
        "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "acknowledgedAt" TIMESTAMP(3),
        CONSTRAINT "BergDispenseEvent_pkey" PRIMARY KEY ("id"),
        CONSTRAINT "BergDispenseEvent_idempotencyKey_key" UNIQUE ("idempotencyKey"),
        CONSTRAINT "BergDispenseEvent_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
        CONSTRAINT "BergDispenseEvent_deviceId_fkey" FOREIGN KEY ("deviceId") REFERENCES "BergDevice"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
        CONSTRAINT "BergDispenseEvent_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE SET NULL ON UPDATE CASCADE,
        CONSTRAINT "BergDispenseEvent_orderItemId_fkey" FOREIGN KEY ("orderItemId") REFERENCES "OrderItem"("id") ON DELETE SET NULL ON UPDATE CASCADE
      )
    `)
    await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "BergDispenseEvent_locationId_receivedAt_idx" ON "BergDispenseEvent"("locationId", "receivedAt")`)
    await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "BergDispenseEvent_locationId_status_idx" ON "BergDispenseEvent"("locationId", "status")`)
    await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "BergDispenseEvent_locationId_lrcValid_idx" ON "BergDispenseEvent"("locationId", "lrcValid")`)
    await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "BergDispenseEvent_locationId_unmatchedType_idx" ON "BergDispenseEvent"("locationId", "unmatchedType")`)
    await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "BergDispenseEvent_pluMappingId_receivedAt_idx" ON "BergDispenseEvent"("pluMappingId", "receivedAt")`)
    await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "BergDispenseEvent_orderId_idx" ON "BergDispenseEvent"("orderId")`)
    await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "BergDispenseEvent_deviceId_receivedAt_idx" ON "BergDispenseEvent"("deviceId", "receivedAt")`)
    await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "BergDispenseEvent_deviceId_businessDate_idx" ON "BergDispenseEvent"("deviceId", "businessDate")`)
    // Alter TEXT enum columns to native PG enum types
    await prisma.$executeRawUnsafe(`
      DO $$ BEGIN
        IF (SELECT data_type FROM information_schema.columns WHERE table_name='BergDispenseEvent' AND column_name='parseStatus') = 'text' THEN
          ALTER TABLE "BergDispenseEvent" ALTER COLUMN "parseStatus" TYPE "BergParseStatus" USING "parseStatus"::"BergParseStatus";
          ALTER TABLE "BergDispenseEvent" ALTER COLUMN "status" TYPE "BergDispenseStatus" USING "status"::"BergDispenseStatus";
        END IF;
      END $$
    `)
    await prisma.$executeRawUnsafe(`ALTER TABLE "BergDispenseEvent" ADD COLUMN IF NOT EXISTS "variantKey" TEXT`)
    await prisma.$executeRawUnsafe(`ALTER TABLE "BergDispenseEvent" ADD COLUMN IF NOT EXISTS "variantLabel" TEXT`)
    await prisma.$executeRawUnsafe(`ALTER TABLE "BergDispenseEvent" ADD COLUMN IF NOT EXISTS "resolutionStatus" "BergResolutionStatus" NOT NULL DEFAULT 'NONE'`)
    await prisma.$executeRawUnsafe(`ALTER TABLE "BergDispenseEvent" ADD COLUMN IF NOT EXISTS "postProcessStatus" "BergPostProcessStatus" NOT NULL DEFAULT 'PENDING'`)
    await prisma.$executeRawUnsafe(`ALTER TABLE "BergDispenseEvent" ADD COLUMN IF NOT EXISTS "postProcessError" TEXT`)
    console.log(`${PREFIX}   BergDispenseEvent table ready`)
  } catch (err) {
    console.error(`${PREFIX}   FAILED BergDispenseEvent:`, err.message)
  }

  // --- Order.incrementAuthFailed ---
  try {
    const [hasIncrementAuthFailed] = await prisma.$queryRawUnsafe(
      `SELECT column_name FROM information_schema.columns WHERE table_name = 'Order' AND column_name = 'incrementAuthFailed'`
    )
    if (!hasIncrementAuthFailed) {
      console.log(`${PREFIX}   Adding incrementAuthFailed to Order...`)
      await prisma.$executeRawUnsafe(
        `ALTER TABLE "Order" ADD COLUMN "incrementAuthFailed" BOOLEAN NOT NULL DEFAULT false`
      )
      console.log(`${PREFIX}   Done -- Order.incrementAuthFailed added`)
    }
  } catch (err) {
    console.error(`${PREFIX}   FAILED Order.incrementAuthFailed:`, err.message)
  }

  // --- Cloud identity fields on Location ---
  const cloudIdFields = [
    ['cloudLocationId',     'TEXT'],
    ['cloudOrganizationId', 'TEXT'],
    ['cloudEnterpriseId',   'TEXT'],
  ]
  for (const [column, type] of cloudIdFields) {
    try {
      const exists = await columnExists(prisma, 'Location', column)
      if (!exists) {
        console.log(`${PREFIX}   Adding ${column} to Location...`)
        await prisma.$executeRawUnsafe(
          `ALTER TABLE "Location" ADD COLUMN "${column}" ${type}`
        )
        console.log(`${PREFIX}   Done -- Location.${column} added`)
      }
    } catch (err) {
      console.error(`${PREFIX}   FAILED Location.${column}:`, err.message)
    }
  }

  // --- CompReason table ---
  try {
    await prisma.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS "CompReason" (
        "id" TEXT NOT NULL,
        "locationId" TEXT NOT NULL,
        "name" TEXT NOT NULL,
        "description" TEXT,
        "deductInventory" BOOLEAN NOT NULL DEFAULT false,
        "requiresManager" BOOLEAN NOT NULL DEFAULT false,
        "isActive" BOOLEAN NOT NULL DEFAULT true,
        "sortOrder" INTEGER NOT NULL DEFAULT 0,
        "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updatedAt" TIMESTAMP(3) NOT NULL,
        "deletedAt" TIMESTAMP(3),
        "syncedAt" TIMESTAMP(3),
        CONSTRAINT "CompReason_pkey" PRIMARY KEY ("id")
      )
    `)
    await prisma.$executeRawUnsafe(`CREATE UNIQUE INDEX IF NOT EXISTS "CompReason_locationId_name_key" ON "CompReason"("locationId", "name")`)
    await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "CompReason_locationId_idx" ON "CompReason"("locationId")`)
    console.log(`${PREFIX}   CompReason table ensured`)
  } catch (err) {
    console.error(`${PREFIX}   FAILED CompReason:`, err.message)
  }

  // --- ReasonAccess table ---
  try {
    await prisma.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS "ReasonAccess" (
        "id" TEXT NOT NULL,
        "locationId" TEXT NOT NULL,
        "subjectType" TEXT NOT NULL,
        "subjectId" TEXT NOT NULL,
        "reasonType" TEXT NOT NULL,
        "reasonId" TEXT NOT NULL,
        "accessType" TEXT NOT NULL DEFAULT 'allow',
        "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT "ReasonAccess_pkey" PRIMARY KEY ("id")
      )
    `)
    await prisma.$executeRawUnsafe(`CREATE UNIQUE INDEX IF NOT EXISTS "ReasonAccess_locationId_subjectType_subjectId_reasonType_reasonId_key" ON "ReasonAccess"("locationId", "subjectType", "subjectId", "reasonType", "reasonId")`)
    await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "ReasonAccess_locationId_idx" ON "ReasonAccess"("locationId")`)
    await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "ReasonAccess_locationId_subjectType_subjectId_idx" ON "ReasonAccess"("locationId", "subjectType", "subjectId")`)
    console.log(`${PREFIX}   ReasonAccess table ensured`)
  } catch (err) {
    console.error(`${PREFIX}   FAILED ReasonAccess:`, err.message)
  }

  // --- ItemBarcode table ---
  try {
    await prisma.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS "ItemBarcode" (
        "id" TEXT NOT NULL,
        "barcode" TEXT NOT NULL,
        "label" TEXT,
        "packSize" INTEGER NOT NULL DEFAULT 1,
        "price" DECIMAL(65,30),
        "menuItemId" TEXT,
        "inventoryItemId" TEXT,
        "locationId" TEXT NOT NULL,
        "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "deletedAt" TIMESTAMP(3),
        "syncedAt" TIMESTAMP(3),
        CONSTRAINT "ItemBarcode_pkey" PRIMARY KEY ("id")
      )
    `)
    await prisma.$executeRawUnsafe(`CREATE UNIQUE INDEX IF NOT EXISTS "ItemBarcode_locationId_barcode_key" ON "ItemBarcode"("locationId", "barcode")`)
    await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "ItemBarcode_barcode_idx" ON "ItemBarcode"("barcode")`)
    await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "ItemBarcode_menuItemId_idx" ON "ItemBarcode"("menuItemId")`)
    await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "ItemBarcode_inventoryItemId_idx" ON "ItemBarcode"("inventoryItemId")`)
    await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "ItemBarcode_locationId_idx" ON "ItemBarcode"("locationId")`)
    console.log(`${PREFIX}   ItemBarcode table ensured`)
  } catch (err) {
    console.error(`${PREFIX}   FAILED ItemBarcode:`, err.message)
  }
}

module.exports = { up }
