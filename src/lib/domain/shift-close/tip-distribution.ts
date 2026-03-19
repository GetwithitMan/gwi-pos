/**
 * Shift Tip Distribution
 *
 * Processes role-based and custom tip-outs via the tip ledger.
 * All functions take TxClient — they run inside the shift close transaction.
 */

import { db } from '@/lib/db'
import { createChildLogger } from '@/lib/logger'
import { postToTipLedger, dollarsToCents } from '@/lib/domain/tips'
import type { TxClient, TipDistributionInput, TipDistributionSummary, SalesData } from './types'

const log = createChildLogger('shift-close')

// Process explicit tip distribution from the client
// Returns the actual total tip-out amount (server-computed, BUG #417/#421 fix)
export async function processTipDistribution(
  tx: TxClient,
  locationId: string,
  fromEmployeeId: string,
  shiftId: string,
  tipDistribution: TipDistributionInput,
  salesData?: SalesData
): Promise<number> {
  let actualTipOutTotal = 0

  // Get all currently clocked-in employees to determine if recipients are on shift
  const activeShifts = await tx.shift.findMany({
    where: {
      locationId,
      status: 'open',
    },
    select: {
      employeeId: true,
      employee: {
        select: {
          id: true,
          roleId: true,
        },
      },
    },
  })

  const activeEmployeeIds = new Set(activeShifts.map(s => s.employeeId))

  // Map roleId to ALL active employees with that role, excluding sender (BUG #408 fix)
  const activeEmployeesByRole = new Map<string, string[]>()
  activeShifts.forEach(s => {
    if (s.employee.roleId && s.employee.id !== fromEmployeeId) {
      const existing = activeEmployeesByRole.get(s.employee.roleId) || []
      existing.push(s.employee.id)
      activeEmployeesByRole.set(s.employee.roleId, existing)
    }
  })

  // Hard-block: validate that explicit role tip-out rules don't exceed 100% of gross tips
  if (tipDistribution.grossTips > 0) {
    const explicitTipOutTotal = tipDistribution.roleTipOuts.reduce((sum, t) => sum + t.amount, 0)
    if (explicitTipOutTotal > tipDistribution.grossTips) {
      log.error({ explicitTipOutTotal, grossTips: tipDistribution.grossTips, fromEmployeeId, locationId }, 'Tip-out total exceeds gross tips — blocking allocation')
      throw new Error('Tip-out configuration error: total tip-out amount exceeds gross tips')
    }
  }

  // Process role-based tip-outs
  for (const tipOut of tipDistribution.roleTipOuts) {
    if (tipOut.amount <= 0) continue

    // Server-side recalculation for sales-based tip-out rules
    let effectiveAmount = tipOut.amount
    if (tipOut.ruleId && salesData) {
      const rule = await tx.tipOutRule.findUnique({
        where: { id: tipOut.ruleId },
        select: { basisType: true, percentage: true, maxPercentage: true },
      })

      if (rule && rule.basisType !== 'tips_earned') {
        // Determine the basis amount based on the rule's basisType
        let basisAmount: number
        switch (rule.basisType) {
          case 'food_sales':
            basisAmount = salesData.foodSales
            break
          case 'bar_sales':
            basisAmount = salesData.barSales
            break
          case 'total_sales':
            basisAmount = salesData.totalSales
            break
          case 'net_sales':
            basisAmount = salesData.netSales
            break
          default:
            basisAmount = tipDistribution.grossTips
        }

        // Recalculate: basisAmount * (percentage / 100)
        const percentage = Number(rule.percentage)
        effectiveAmount = Math.round(basisAmount * (percentage / 100) * 100) / 100

        // Apply maxPercentage compliance cap if set
        if (rule.maxPercentage) {
          const maxPct = Number(rule.maxPercentage)
          const maxAmount = Math.round(tipDistribution.grossTips * (maxPct / 100) * 100) / 100
          if (effectiveAmount > maxAmount) {
            effectiveAmount = maxAmount
          }
        }

        // Don't allow negative tip-outs
        if (effectiveAmount < 0) effectiveAmount = 0
      }
    }

    if (effectiveAmount <= 0) continue

    // Find ALL active employees with this role (BUG #408 fix)
    let recipients = activeEmployeesByRole.get(tipOut.toRoleId) || []
    let bankStatus: 'pending' | 'banked' = 'pending'

    if (recipients.length === 0) {
      // No active employees with this role — find ALL employees with this role for banking
      const employeesWithRole = await tx.employee.findMany({
        where: {
          locationId,
          roleId: tipOut.toRoleId,
          isActive: true,
          id: { not: fromEmployeeId },
        },
        select: { id: true },
      })

      if (employeesWithRole.length === 0) {
        log.warn({ roleId: tipOut.toRoleId, locationId }, 'No employees found with role for tip-out')
        continue
      }

      recipients = employeesWithRole.map(e => e.id)
      bankStatus = 'banked'
    }

    // Split amount evenly among all recipients, handle rounding (BUG #408 fix)
    const totalCents = dollarsToCents(effectiveAmount)
    const perPersonCents = Math.floor(totalCents / recipients.length)
    const remainderCents = totalCents - (perPersonCents * recipients.length)

    for (let i = 0; i < recipients.length; i++) {
      // Distribute remainder pennies round-robin (1 cent each) instead of all to first
      const recipientCents = perPersonCents + (i < remainderCents ? 1 : 0)
      if (recipientCents <= 0) continue
      const recipientDollars = recipientCents / 100

      // Create TipShare record per recipient
      const tipShare = await tx.tipShare.create({
        data: {
          locationId,
          shiftId,
          fromEmployeeId,
          toEmployeeId: recipients[i],
          amount: recipientDollars,
          shareType: 'role_tipout',
          ruleId: tipOut.ruleId,
          status: bankStatus,
        },
      })

      // Post paired ledger entries INSIDE the transaction (Skill 284)
      await postToTipLedger({
        locationId,
        employeeId: fromEmployeeId,
        amountCents: recipientCents,
        type: 'DEBIT',
        sourceType: 'ROLE_TIPOUT',
        sourceId: tipShare.id,
        shiftId,
        memo: `Role tip-out to ${tipOut.toRoleId}`,
      }, tx)

      await postToTipLedger({
        locationId,
        employeeId: recipients[i],
        amountCents: recipientCents,
        type: 'CREDIT',
        sourceType: 'ROLE_TIPOUT',
        sourceId: tipShare.id,
        shiftId,
        memo: `Role tip-out from shift close`,
      }, tx)
    }

    actualTipOutTotal += effectiveAmount
  }

  // Process custom shares
  for (const share of tipDistribution.customShares) {
    if (share.amount <= 0) continue

    const isOnShift = activeEmployeeIds.has(share.toEmployeeId)
    const status = isOnShift ? 'pending' : 'banked'

    // Create TipShare record
    const tipShare = await tx.tipShare.create({
      data: {
        locationId,
        shiftId,
        fromEmployeeId,
        toEmployeeId: share.toEmployeeId,
        amount: share.amount,
        shareType: 'custom',
        status,
      },
    })

    // Post paired ledger entries INSIDE the transaction (Skill 284)
    const shareAmountCents = dollarsToCents(share.amount)
    await postToTipLedger({
      locationId,
      employeeId: fromEmployeeId,
      amountCents: shareAmountCents,
      type: 'DEBIT',
      sourceType: 'MANUAL_TRANSFER',
      sourceId: tipShare.id,
      shiftId,
      memo: `Custom tip share`,
    }, tx)

    await postToTipLedger({
      locationId,
      employeeId: share.toEmployeeId,
      amountCents: shareAmountCents,
      type: 'CREDIT',
      sourceType: 'MANUAL_TRANSFER',
      sourceId: tipShare.id,
      shiftId,
      memo: `Custom tip share received`,
    }, tx)

    actualTipOutTotal += share.amount
  }

  return Math.round(actualTipOutTotal * 100) / 100
}

// Auto-process tip distribution when client doesn't send explicit tipDistribution
// but autoTipOutEnabled is true. Loads TipOutRules for the employee's role and
// calculates tip-outs server-side.
export async function autoProcessTipDistribution(
  tx: TxClient,
  locationId: string,
  fromEmployeeId: string,
  workingRoleId: string | null,
  shiftId: string,
  grossTips: number,
  salesData: SalesData,
  summary: { cashSales: number; cardSales: number; totalTips: number }
): Promise<{ totalTipOut: number; distributed: boolean }> {
  // Determine the employee's effective role (workingRoleId on shift, or default roleId)
  let effectiveRoleId = workingRoleId
  if (!effectiveRoleId) {
    const employee = await tx.employee.findUnique({
      where: { id: fromEmployeeId },
      select: { roleId: true },
    })
    effectiveRoleId = employee?.roleId || null
  }

  if (!effectiveRoleId) {
    return { totalTipOut: 0, distributed: false }
  }

  // Load active TipOutRules where this employee's role is the "from" role
  const now = new Date()
  const rules = await tx.tipOutRule.findMany({
    where: {
      locationId,
      fromRoleId: effectiveRoleId,
      isActive: true,
      deletedAt: null,
      OR: [
        { effectiveDate: null },
        { effectiveDate: { lte: now } },
      ],
      AND: [
        {
          OR: [
            { expiresAt: null },
            { expiresAt: { gte: now } },
          ],
        },
      ],
    },
    select: {
      id: true,
      toRoleId: true,
      percentage: true,
      basisType: true,
      maxPercentage: true,
    },
  })

  if (rules.length === 0) {
    return { totalTipOut: 0, distributed: false }
  }

  // Hard-block: total tip-out percentages must not exceed 100%
  const totalTipOutPercent = rules.reduce((sum, rule) => sum + Number(rule.percentage || 0), 0)
  if (totalTipOutPercent > 100) {
    log.error({ totalTipOutPercent, rules, fromEmployeeId, locationId }, 'Tip-out percentages exceed 100% — blocking allocation')
    throw new Error('Tip-out configuration error: total tip-out percentages exceed 100%')
  }

  // Build roleTipOuts from rules (server-side calculation)
  const roleTipOuts: { ruleId: string; toRoleId: string; amount: number }[] = []

  for (const rule of rules) {
    const percentage = Number(rule.percentage)
    if (percentage <= 0) continue

    // Determine basis amount based on rule's basisType
    let basisAmount: number
    switch (rule.basisType) {
      case 'food_sales':
        basisAmount = salesData.foodSales
        break
      case 'bar_sales':
        basisAmount = salesData.barSales
        break
      case 'total_sales':
        basisAmount = salesData.totalSales
        break
      case 'net_sales':
        basisAmount = salesData.netSales
        break
      case 'total_tips':
        basisAmount = grossTips
        break
      case 'cash_tips':
        // Estimate cash tips: proportion of total tips that came from cash payments
        basisAmount = summary.totalTips > 0 && salesData.totalSales > 0
          ? grossTips * (summary.cashSales / salesData.totalSales)
          : 0
        break
      case 'cc_tips':
        // Estimate CC tips: proportion of total tips that came from card payments
        basisAmount = summary.totalTips > 0 && salesData.totalSales > 0
          ? grossTips * (summary.cardSales / salesData.totalSales)
          : 0
        break
      case 'tips_earned':
      default:
        basisAmount = grossTips
        break
    }

    let amount = Math.round(basisAmount * (percentage / 100) * 100) / 100

    // Apply maxPercentage compliance cap if set
    if (rule.maxPercentage) {
      const maxPct = Number(rule.maxPercentage)
      const maxAmount = Math.round(grossTips * (maxPct / 100) * 100) / 100
      if (amount > maxAmount) {
        amount = maxAmount
      }
    }

    if (amount <= 0) continue

    roleTipOuts.push({
      ruleId: rule.id,
      toRoleId: rule.toRoleId,
      amount,
    })
  }

  if (roleTipOuts.length === 0) {
    return { totalTipOut: 0, distributed: false }
  }

  // Delegate to the existing processTipDistribution with the auto-computed distribution
  const tipDistribution: TipDistributionInput = {
    grossTips,
    tipOutTotal: roleTipOuts.reduce((sum, t) => sum + t.amount, 0),
    netTips: grossTips - roleTipOuts.reduce((sum, t) => sum + t.amount, 0),
    roleTipOuts,
    customShares: [],
  }

  const totalTipOut = await processTipDistribution(
    tx,
    locationId,
    fromEmployeeId,
    shiftId,
    tipDistribution,
    salesData
  )

  return { totalTipOut, distributed: true }
}

// Get tip distribution summary for a shift (used in both GET and POST responses)
export async function getShiftTipDistributionSummary(
  shiftId: string,
  locationId: string
): Promise<TipDistributionSummary | null> {
  // Get the shift's tip fields
  const shift = await db.shift.findUnique({
    where: { id: shiftId },
    select: {
      grossTips: true,
      tipOutTotal: true,
      netTips: true,
    },
  })

  if (!shift || shift.grossTips === null) {
    return null
  }

  // Get all TipShares for this shift
  const tipShares = await db.tipShare.findMany({
    where: {
      shiftId,
      locationId,
      deletedAt: null,
    },
    include: {
      toEmployee: {
        select: {
          id: true,
          firstName: true,
          lastName: true,
          displayName: true,
        },
      },
      rule: {
        select: {
          id: true,
          toRole: {
            select: { name: true },
          },
          basisType: true,
          percentage: true,
        },
      },
    },
    orderBy: { createdAt: 'asc' },
  })

  return {
    grossTips: Number(shift.grossTips),
    tipOutTotal: Number(shift.tipOutTotal || 0),
    netTips: Number(shift.netTips || 0),
    entries: tipShares.map(ts => ({
      id: ts.id,
      toEmployeeId: ts.toEmployee.id,
      toEmployeeName: ts.toEmployee.displayName || `${ts.toEmployee.firstName} ${ts.toEmployee.lastName}`,
      amount: Number(ts.amount),
      shareType: ts.shareType,
      ruleName: ts.rule
        ? `${Number(ts.rule.percentage)}% of ${ts.rule.basisType.replace(/_/g, ' ')} → ${ts.rule.toRole.name}`
        : null,
      status: ts.status,
    })),
  }
}
