/**
 * Migration 096 — Narrow Decimal columns from Prisma default (65,30) to explicit precision
 *
 * The Prisma schema now specifies explicit @db.Decimal(p,s) annotations on all money,
 * rate, and quantity fields. Without this migration, `prisma db push` sees the type
 * difference (65,30 → 10,2 etc.) and refuses unless --accept-data-loss is passed.
 *
 * This migration uses explicit USING casts so Postgres safely narrows the values.
 * After this runs, `prisma db push` sees no diff and is a no-op.
 *
 * Grouped by table for readability. Each ALTER is guarded by table+column existence checks.
 */

async function up(prisma) {
  const PREFIX = '[096]'

  // All columns that need precision narrowing, grouped by table
  const alterations = [
    // BergDispenseEvent
    { table: 'BergDispenseEvent', column: 'pourSizeOz', precision: 6, scale: 3 },
    { table: 'BergDispenseEvent', column: 'pourCost', precision: 10, scale: 2 },

    // BergPluMapping
    { table: 'BergPluMapping', column: 'pourSizeOzOverride', precision: 6, scale: 3 },

    // BottleServiceTier
    { table: 'BottleServiceTier', column: 'depositAmount', precision: 10, scale: 2 },
    { table: 'BottleServiceTier', column: 'minimumSpend', precision: 10, scale: 2 },
    { table: 'BottleServiceTier', column: 'autoGratuityPercent', precision: 6, scale: 4 },

    // CardProfile
    { table: 'CardProfile', column: 'totalSpend', precision: 10, scale: 2 },

    // CashTipDeclaration
    { table: 'CashTipDeclaration', column: 'amountCents', precision: 10, scale: 2 },

    // ComboComponent
    { table: 'ComboComponent', column: 'itemPriceOverride', precision: 10, scale: 2 },
    { table: 'ComboComponent', column: 'priceOverride', precision: 10, scale: 2 },

    // ComboComponentOption
    { table: 'ComboComponentOption', column: 'upcharge', precision: 10, scale: 2 },

    // ComboTemplate
    { table: 'ComboTemplate', column: 'basePrice', precision: 10, scale: 2 },
    { table: 'ComboTemplate', column: 'comparePrice', precision: 10, scale: 2 },

    // Coupon
    { table: 'Coupon', column: 'discountValue', precision: 10, scale: 2 },
    { table: 'Coupon', column: 'minimumOrder', precision: 10, scale: 2 },
    { table: 'Coupon', column: 'maximumDiscount', precision: 10, scale: 2 },

    // CouponRedemption
    { table: 'CouponRedemption', column: 'discountAmount', precision: 10, scale: 2 },

    // Customer
    { table: 'Customer', column: 'totalSpent', precision: 10, scale: 2 },
    { table: 'Customer', column: 'averageTicket', precision: 10, scale: 2 },

    // Employee
    { table: 'Employee', column: 'hourlyRate', precision: 10, scale: 2 },
    { table: 'Employee', column: 'additionalFederalWithholding', precision: 10, scale: 2 },
    { table: 'Employee', column: 'additionalStateWithholding', precision: 10, scale: 2 },
    { table: 'Employee', column: 'ytdGrossEarnings', precision: 10, scale: 2 },
    { table: 'Employee', column: 'ytdGrossWages', precision: 10, scale: 2 },
    { table: 'Employee', column: 'ytdTips', precision: 10, scale: 2 },
    { table: 'Employee', column: 'ytdCommission', precision: 10, scale: 2 },
    { table: 'Employee', column: 'ytdTaxesWithheld', precision: 10, scale: 2 },
    { table: 'Employee', column: 'ytdFederalTax', precision: 10, scale: 2 },
    { table: 'Employee', column: 'ytdStateTax', precision: 10, scale: 2 },
    { table: 'Employee', column: 'ytdLocalTax', precision: 10, scale: 2 },
    { table: 'Employee', column: 'ytdSocialSecurity', precision: 10, scale: 2 },
    { table: 'Employee', column: 'ytdMedicare', precision: 10, scale: 2 },
    { table: 'Employee', column: 'ytdNetPay', precision: 10, scale: 2 },

    // EntertainmentWaitlist
    { table: 'EntertainmentWaitlist', column: 'depositAmount', precision: 10, scale: 2 },

    // EventPricingTier
    { table: 'EventPricingTier', column: 'price', precision: 10, scale: 2 },
    { table: 'EventPricingTier', column: 'serviceFee', precision: 10, scale: 2 },

    // GiftCard
    { table: 'GiftCard', column: 'initialBalance', precision: 10, scale: 2 },
    { table: 'GiftCard', column: 'currentBalance', precision: 10, scale: 2 },

    // GiftCardTransaction
    { table: 'GiftCardTransaction', column: 'amount', precision: 10, scale: 2 },
    { table: 'GiftCardTransaction', column: 'balanceBefore', precision: 10, scale: 2 },
    { table: 'GiftCardTransaction', column: 'balanceAfter', precision: 10, scale: 2 },

    // HouseAccount
    { table: 'HouseAccount', column: 'creditLimit', precision: 10, scale: 2 },
    { table: 'HouseAccount', column: 'currentBalance', precision: 10, scale: 2 },

    // HouseAccountTransaction
    { table: 'HouseAccountTransaction', column: 'amount', precision: 10, scale: 2 },
    { table: 'HouseAccountTransaction', column: 'balanceBefore', precision: 10, scale: 2 },
    { table: 'HouseAccountTransaction', column: 'balanceAfter', precision: 10, scale: 2 },

    // IngredientCostHistory
    { table: 'IngredientCostHistory', column: 'oldCostPerUnit', precision: 10, scale: 4 },
    { table: 'IngredientCostHistory', column: 'newCostPerUnit', precision: 10, scale: 4 },
    { table: 'IngredientCostHistory', column: 'changePercent', precision: 6, scale: 2 },

    // InventoryCount
    { table: 'InventoryCount', column: 'totalVarianceCost', precision: 10, scale: 2 },

    // InventoryCountEntry
    { table: 'InventoryCountEntry', column: 'expectedQty', precision: 10, scale: 4 },
    { table: 'InventoryCountEntry', column: 'countedQty', precision: 10, scale: 4 },
    { table: 'InventoryCountEntry', column: 'variance', precision: 10, scale: 4 },
    { table: 'InventoryCountEntry', column: 'unitCost', precision: 10, scale: 4 },
    { table: 'InventoryCountEntry', column: 'varianceCost', precision: 10, scale: 2 },

    // InventoryItem
    { table: 'InventoryItem', column: 'lastInvoiceCost', precision: 10, scale: 4 },
    { table: 'InventoryItem', column: 'averageCost', precision: 10, scale: 4 },

    // MenuItem
    { table: 'MenuItem', column: 'price', precision: 10, scale: 2 },
    { table: 'MenuItem', column: 'priceCC', precision: 10, scale: 2 },
    { table: 'MenuItem', column: 'cost', precision: 10, scale: 2 },
    { table: 'MenuItem', column: 'onlinePrice', precision: 10, scale: 2 },
    { table: 'MenuItem', column: 'taxRate', precision: 6, scale: 4 },
    { table: 'MenuItem', column: 'ratePerMinute', precision: 10, scale: 2 },
    { table: 'MenuItem', column: 'minimumCharge', precision: 10, scale: 2 },
    { table: 'MenuItem', column: 'overtimeMultiplier', precision: 6, scale: 4 },
    { table: 'MenuItem', column: 'overtimePerMinuteRate', precision: 10, scale: 2 },
    { table: 'MenuItem', column: 'overtimeFlatFee', precision: 10, scale: 2 },
    { table: 'MenuItem', column: 'commissionValue', precision: 10, scale: 2 },
    { table: 'MenuItem', column: 'pricePerWeightUnit', precision: 10, scale: 2 },

    // Modifier
    { table: 'Modifier', column: 'price', precision: 10, scale: 2 },
    { table: 'Modifier', column: 'upsellPrice', precision: 10, scale: 2 },
    { table: 'Modifier', column: 'cost', precision: 10, scale: 2 },
    { table: 'Modifier', column: 'extraPrice', precision: 10, scale: 2 },
    { table: 'Modifier', column: 'liteMultiplier', precision: 6, scale: 4 },
    { table: 'Modifier', column: 'extraMultiplier', precision: 6, scale: 4 },
    { table: 'Modifier', column: 'extraUpsellPrice', precision: 10, scale: 2 },
    { table: 'Modifier', column: 'commissionValue', precision: 10, scale: 2 },

    // Order
    { table: 'Order', column: 'subtotal', precision: 10, scale: 2 },
    { table: 'Order', column: 'discountTotal', precision: 10, scale: 2 },
    { table: 'Order', column: 'taxTotal', precision: 10, scale: 2 },
    { table: 'Order', column: 'taxFromInclusive', precision: 10, scale: 2 },
    { table: 'Order', column: 'taxFromExclusive', precision: 10, scale: 2 },
    { table: 'Order', column: 'inclusiveTaxRate', precision: 6, scale: 4 },
    { table: 'Order', column: 'tipTotal', precision: 10, scale: 2 },
    { table: 'Order', column: 'total', precision: 10, scale: 2 },
    { table: 'Order', column: 'commissionTotal', precision: 10, scale: 2 },
    { table: 'Order', column: 'preAuthAmount', precision: 10, scale: 2 },
    { table: 'Order', column: 'bottleServiceDeposit', precision: 10, scale: 2 },
    { table: 'Order', column: 'bottleServiceMinSpend', precision: 10, scale: 2 },
    { table: 'Order', column: 'bottleServiceCurrentSpend', precision: 10, scale: 2 },

    // OrderCard
    { table: 'OrderCard', column: 'authAmount', precision: 10, scale: 2 },
    { table: 'OrderCard', column: 'capturedAmount', precision: 10, scale: 2 },
    { table: 'OrderCard', column: 'tipAmount', precision: 10, scale: 2 },

    // OrderDiscount
    { table: 'OrderDiscount', column: 'amount', precision: 10, scale: 2 },
    { table: 'OrderDiscount', column: 'percent', precision: 8, scale: 4 },

    // OrderItem
    { table: 'OrderItem', column: 'price', precision: 10, scale: 2 },
    { table: 'OrderItem', column: 'pourMultiplier', precision: 6, scale: 4 },
    { table: 'OrderItem', column: 'cardPrice', precision: 10, scale: 2 },
    { table: 'OrderItem', column: 'weight', precision: 10, scale: 4 },
    { table: 'OrderItem', column: 'unitPrice', precision: 10, scale: 2 },
    { table: 'OrderItem', column: 'grossWeight', precision: 10, scale: 4 },
    { table: 'OrderItem', column: 'tareWeight', precision: 10, scale: 4 },
    { table: 'OrderItem', column: 'modifierTotal', precision: 10, scale: 2 },
    { table: 'OrderItem', column: 'itemTotal', precision: 10, scale: 2 },
    { table: 'OrderItem', column: 'commissionAmount', precision: 10, scale: 2 },
    { table: 'OrderItem', column: 'costAtSale', precision: 10, scale: 2 },

    // OrderItemDiscount
    { table: 'OrderItemDiscount', column: 'amount', precision: 10, scale: 2 },
    { table: 'OrderItemDiscount', column: 'percent', precision: 8, scale: 4 },

    // OrderItemModifier
    { table: 'OrderItemModifier', column: 'price', precision: 10, scale: 2 },
    { table: 'OrderItemModifier', column: 'commissionAmount', precision: 10, scale: 2 },
    { table: 'OrderItemModifier', column: 'linkedMenuItemPrice', precision: 10, scale: 2 },
    { table: 'OrderItemModifier', column: 'customEntryPrice', precision: 10, scale: 2 },
    { table: 'OrderItemModifier', column: 'swapEffectivePrice', precision: 10, scale: 2 },

    // OrderOwnershipEntry
    { table: 'OrderOwnershipEntry', column: 'sharePercent', precision: 6, scale: 2 },

    // PaidInOut
    { table: 'PaidInOut', column: 'amount', precision: 10, scale: 2 },

    // PayStub
    { table: 'PayStub', column: 'hourlyRate', precision: 10, scale: 2 },
    { table: 'PayStub', column: 'regularPay', precision: 10, scale: 2 },
    { table: 'PayStub', column: 'overtimePay', precision: 10, scale: 2 },
    { table: 'PayStub', column: 'declaredTips', precision: 10, scale: 2 },
    { table: 'PayStub', column: 'tipSharesGiven', precision: 10, scale: 2 },
    { table: 'PayStub', column: 'tipSharesReceived', precision: 10, scale: 2 },
    { table: 'PayStub', column: 'bankedTipsCollected', precision: 10, scale: 2 },
    { table: 'PayStub', column: 'netTips', precision: 10, scale: 2 },
    { table: 'PayStub', column: 'commissionTotal', precision: 10, scale: 2 },
    { table: 'PayStub', column: 'grossPay', precision: 10, scale: 2 },
    { table: 'PayStub', column: 'federalTax', precision: 10, scale: 2 },
    { table: 'PayStub', column: 'stateTax', precision: 10, scale: 2 },
    { table: 'PayStub', column: 'socialSecurityTax', precision: 10, scale: 2 },
    { table: 'PayStub', column: 'medicareTax', precision: 10, scale: 2 },
    { table: 'PayStub', column: 'localTax', precision: 10, scale: 2 },
    { table: 'PayStub', column: 'totalDeductions', precision: 10, scale: 2 },
    { table: 'PayStub', column: 'netPay', precision: 10, scale: 2 },

    // Payment
    { table: 'Payment', column: 'amount', precision: 10, scale: 2 },
    { table: 'Payment', column: 'tipAmount', precision: 10, scale: 2 },
    { table: 'Payment', column: 'totalAmount', precision: 10, scale: 2 },
    { table: 'Payment', column: 'amountTendered', precision: 10, scale: 2 },
    { table: 'Payment', column: 'changeGiven', precision: 10, scale: 2 },
    { table: 'Payment', column: 'roundingAdjustment', precision: 10, scale: 2 },
    { table: 'Payment', column: 'amountRequested', precision: 10, scale: 2 },
    { table: 'Payment', column: 'amountAuthorized', precision: 10, scale: 2 },
    { table: 'Payment', column: 'refundedAmount', precision: 10, scale: 2 },
    { table: 'Payment', column: 'cashDiscountAmount', precision: 10, scale: 2 },
    { table: 'Payment', column: 'priceBeforeDiscount', precision: 10, scale: 2 },

    // PayrollPeriod
    { table: 'PayrollPeriod', column: 'totalRegularHours', precision: 10, scale: 2 },
    { table: 'PayrollPeriod', column: 'totalOvertimeHours', precision: 10, scale: 2 },
    { table: 'PayrollPeriod', column: 'totalWages', precision: 10, scale: 2 },
    { table: 'PayrollPeriod', column: 'totalTips', precision: 10, scale: 2 },
    { table: 'PayrollPeriod', column: 'totalCommissions', precision: 10, scale: 2 },
    { table: 'PayrollPeriod', column: 'totalBankedTips', precision: 10, scale: 2 },
    { table: 'PayrollPeriod', column: 'grandTotal', precision: 10, scale: 2 },

    // PayrollSettings
    { table: 'PayrollSettings', column: 'overtimeThresholdDaily', precision: 6, scale: 4 },
    { table: 'PayrollSettings', column: 'overtimeThresholdWeekly', precision: 6, scale: 4 },
    { table: 'PayrollSettings', column: 'overtimeMultiplier', precision: 6, scale: 4 },
    { table: 'PayrollSettings', column: 'doubleTimeThreshold', precision: 6, scale: 4 },
    { table: 'PayrollSettings', column: 'doubleTimeMultiplier', precision: 6, scale: 4 },
    { table: 'PayrollSettings', column: 'stateTaxRate', precision: 6, scale: 4 },
    { table: 'PayrollSettings', column: 'localTaxRate', precision: 6, scale: 4 },
    { table: 'PayrollSettings', column: 'socialSecurityRate', precision: 6, scale: 4 },
    { table: 'PayrollSettings', column: 'medicareRate', precision: 6, scale: 4 },
    { table: 'PayrollSettings', column: 'socialSecurityWageBase', precision: 10, scale: 2 },
    { table: 'PayrollSettings', column: 'minimumWage', precision: 10, scale: 2 },
    { table: 'PayrollSettings', column: 'tippedMinimumWage', precision: 10, scale: 2 },

    // PricingOption
    { table: 'PricingOption', column: 'price', precision: 10, scale: 2 },
    { table: 'PricingOption', column: 'priceCC', precision: 10, scale: 2 },

    // RefundLog
    { table: 'RefundLog', column: 'refundAmount', precision: 10, scale: 2 },
    { table: 'RefundLog', column: 'originalAmount', precision: 10, scale: 2 },

    // Reservation
    { table: 'Reservation', column: 'depositAmount', precision: 10, scale: 2 },

    // ReservationDeposit
    { table: 'ReservationDeposit', column: 'amount', precision: 10, scale: 2 },
    { table: 'ReservationDeposit', column: 'refundedAmount', precision: 10, scale: 2 },

    // Role
    { table: 'Role', column: 'tipWeight', precision: 6, scale: 4 },

    // Shift
    { table: 'Shift', column: 'startingCash', precision: 10, scale: 2 },
    { table: 'Shift', column: 'expectedCash', precision: 10, scale: 2 },
    { table: 'Shift', column: 'actualCash', precision: 10, scale: 2 },
    { table: 'Shift', column: 'variance', precision: 10, scale: 2 },
    { table: 'Shift', column: 'totalSales', precision: 10, scale: 2 },
    { table: 'Shift', column: 'cashSales', precision: 10, scale: 2 },
    { table: 'Shift', column: 'cardSales', precision: 10, scale: 2 },
    { table: 'Shift', column: 'tipsDeclared', precision: 10, scale: 2 },
    { table: 'Shift', column: 'grossTips', precision: 10, scale: 2 },
    { table: 'Shift', column: 'tipOutTotal', precision: 10, scale: 2 },
    { table: 'Shift', column: 'netTips', precision: 10, scale: 2 },

    // SyncAuditEntry
    { table: 'SyncAuditEntry', column: 'amount', precision: 10, scale: 2 },

    // TaxRule
    { table: 'TaxRule', column: 'rate', precision: 6, scale: 4 },

    // Ticket
    { table: 'Ticket', column: 'basePrice', precision: 10, scale: 2 },
    { table: 'Ticket', column: 'serviceFee', precision: 10, scale: 2 },
    { table: 'Ticket', column: 'taxAmount', precision: 10, scale: 2 },
    { table: 'Ticket', column: 'totalPrice', precision: 10, scale: 2 },
    { table: 'Ticket', column: 'refundAmount', precision: 10, scale: 2 },

    // TipDebt
    { table: 'TipDebt', column: 'originalAmountCents', precision: 10, scale: 2 },
    { table: 'TipDebt', column: 'remainingCents', precision: 10, scale: 2 },

    // TipLedger
    { table: 'TipLedger', column: 'currentBalanceCents', precision: 10, scale: 2 },

    // TipLedgerEntry
    { table: 'TipLedgerEntry', column: 'amountCents', precision: 10, scale: 2 },

    // TipOutRule
    { table: 'TipOutRule', column: 'percentage', precision: 6, scale: 4 },
    { table: 'TipOutRule', column: 'maxPercentage', precision: 6, scale: 4 },

    // TipShare
    { table: 'TipShare', column: 'amount', precision: 10, scale: 2 },

    // TipTransaction
    { table: 'TipTransaction', column: 'amountCents', precision: 10, scale: 2 },
    { table: 'TipTransaction', column: 'ccFeeAmountCents', precision: 10, scale: 2 },

    // VendorOrder
    { table: 'VendorOrder', column: 'totalEstimated', precision: 10, scale: 2 },
    { table: 'VendorOrder', column: 'totalActual', precision: 10, scale: 2 },

    // VendorOrderLineItem
    { table: 'VendorOrderLineItem', column: 'quantity', precision: 10, scale: 4 },
    { table: 'VendorOrderLineItem', column: 'estimatedCost', precision: 10, scale: 4 },
    { table: 'VendorOrderLineItem', column: 'actualCost', precision: 10, scale: 4 },
    { table: 'VendorOrderLineItem', column: 'receivedQty', precision: 10, scale: 4 },

    // WalkoutRetry
    { table: 'WalkoutRetry', column: 'amount', precision: 10, scale: 2 },

    // WasteLog
    { table: 'WasteLog', column: 'quantity', precision: 10, scale: 4 },
    { table: 'WasteLog', column: 'cost', precision: 10, scale: 2 },
  ]

  let altered = 0
  let skipped = 0
  let missingTable = 0
  let missingCol = 0

  for (const { table, column, precision, scale } of alterations) {
    // Guard: check table exists
    const [tableCheck] = await prisma.$queryRawUnsafe(`
      SELECT EXISTS (
        SELECT 1 FROM information_schema.tables
        WHERE table_schema = 'public' AND table_name = $1
      ) AS exists
    `, table)
    if (!tableCheck.exists) {
      missingTable++
      continue
    }

    // Guard: check column exists
    const [colCheck] = await prisma.$queryRawUnsafe(`
      SELECT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = $1 AND column_name = $2
      ) AS exists
    `, table, column)
    if (!colCheck.exists) {
      missingCol++
      continue
    }

    // Check if column already has the target precision (idempotency)
    const [typeInfo] = await prisma.$queryRawUnsafe(`
      SELECT numeric_precision, numeric_scale
      FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = $1 AND column_name = $2
    `, table, column)
    if (typeInfo &&
        Number(typeInfo.numeric_precision) === precision &&
        Number(typeInfo.numeric_scale) === scale) {
      skipped++
      continue
    }

    // Perform the ALTER with explicit USING cast for safety
    await prisma.$executeRawUnsafe(
      `ALTER TABLE "${table}" ALTER COLUMN "${column}" TYPE DECIMAL(${precision},${scale}) USING "${column}"::numeric(${precision},${scale})`
    )
    altered++
  }

  console.log(`${PREFIX} Decimal precision migration complete: ${altered} altered, ${skipped} already correct, ${missingTable} missing tables, ${missingCol} missing columns`)
}

module.exports = { up }
