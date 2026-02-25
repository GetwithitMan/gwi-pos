import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { calculateTaxes, TaxCalculationInput } from '@/lib/payroll/tax-calculator'
import { withVenue } from '@/lib/with-venue'

// GET - Get payroll period details with pay stubs
export const GET = withVenue(async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params

    const period = await db.payrollPeriod.findUnique({
      where: { id },
      include: {
        payStubs: {
          include: {
            employee: {
              select: {
                id: true,
                firstName: true,
                lastName: true,
                displayName: true,
                role: { select: { name: true } },
              },
            },
          },
        },
      },
    })

    if (!period) {
      return NextResponse.json({ error: 'Payroll period not found' }, { status: 404 })
    }

    return NextResponse.json({ data: {
      period: {
        id: period.id,
        periodStart: period.periodStart.toISOString(),
        periodEnd: period.periodEnd.toISOString(),
        periodType: period.periodType,
        status: period.status,
        closedAt: period.closedAt?.toISOString() || null,
        paidAt: period.paidAt?.toISOString() || null,
        totals: {
          regularHours: Number(period.totalRegularHours || 0),
          overtimeHours: Number(period.totalOvertimeHours || 0),
          wages: Number(period.totalWages || 0),
          tips: Number(period.totalTips || 0),
          commissions: Number(period.totalCommissions || 0),
          bankedTips: Number(period.totalBankedTips || 0),
          grandTotal: Number(period.grandTotal || 0),
        },
        notes: period.notes,
      },
      payStubs: period.payStubs.map(stub => ({
        id: stub.id,
        employee: {
          id: stub.employee.id,
          name: stub.employee.displayName || `${stub.employee.firstName} ${stub.employee.lastName}`,
          role: stub.employee.role.name,
        },
        regularHours: Number(stub.regularHours),
        overtimeHours: Number(stub.overtimeHours),
        hourlyRate: Number(stub.hourlyRate),
        regularPay: Number(stub.regularPay),
        overtimePay: Number(stub.overtimePay),
        declaredTips: Number(stub.declaredTips),
        tipSharesGiven: Number(stub.tipSharesGiven),
        tipSharesReceived: Number(stub.tipSharesReceived),
        bankedTipsCollected: Number(stub.bankedTipsCollected),
        netTips: Number(stub.netTips),
        commissionTotal: Number(stub.commissionTotal),
        grossPay: Number(stub.grossPay),
        deductions: stub.deductions,
        netPay: Number(stub.netPay),
        status: stub.status,
        paymentMethod: stub.paymentMethod,
        paidAt: stub.paidAt?.toISOString() || null,
      })),
    } })
  } catch (error) {
    console.error('Failed to fetch payroll period:', error)
    return NextResponse.json({ error: 'Failed to fetch payroll period' }, { status: 500 })
  }
})

// PUT - Process/close payroll period
export const PUT = withVenue(async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const body = await request.json()
    const { action, closedBy } = body as { action: 'process' | 'close' | 'pay'; closedBy?: string }

    const period = await db.payrollPeriod.findUnique({
      where: { id },
      include: { location: true },
    })

    if (!period) {
      return NextResponse.json({ error: 'Payroll period not found' }, { status: 404 })
    }

    // Get payroll settings for tax calculation
    const payrollSettings = await db.payrollSettings.findUnique({
      where: { locationId: period.locationId },
    })

    if (action === 'process') {
      // Generate pay stubs for all employees
      const employees = await db.employee.findMany({
        where: { locationId: period.locationId, isActive: true },
        include: { role: true },
      })

      // Delete existing pay stubs for this period (to regenerate)
      await db.payStub.updateMany({ where: { payrollPeriodId: id }, data: { deletedAt: new Date() } })

      let totalRegularHours = 0
      let totalOvertimeHours = 0
      let totalWages = 0
      let totalTips = 0
      let totalCommissions = 0
      let totalBankedTips = 0
      let grandTotal = 0

      const employeeIds = employees.map(e => e.id)

      // Batch-fetch all data BEFORE the loop to avoid N+1 queries
      const [allTimeEntries, allShifts, allTipLedgerEntries, allOrders] = await Promise.all([
        db.timeClockEntry.findMany({
          where: {
            employeeId: { in: employeeIds },
            clockIn: { gte: period.periodStart, lte: period.periodEnd },
            clockOut: { not: null },
          },
        }),
        db.shift.findMany({
          where: {
            employeeId: { in: employeeIds },
            status: 'closed',
            startedAt: { gte: period.periodStart, lte: period.periodEnd },
          },
        }),
        db.tipLedgerEntry.findMany({
          where: {
            employeeId: { in: employeeIds },
            deletedAt: null,
            createdAt: { gte: period.periodStart, lte: period.periodEnd },
            OR: [
              { sourceType: 'ROLE_TIPOUT', type: 'DEBIT' },
              { sourceType: 'ROLE_TIPOUT', type: 'CREDIT' },
              { sourceType: { in: ['DIRECT_TIP', 'TIP_GROUP'] }, type: 'CREDIT' },
            ],
          },
        }),
        db.order.findMany({
          where: {
            employeeId: { in: employeeIds },
            status: { in: ['completed', 'paid'] },
            createdAt: { gte: period.periodStart, lte: period.periodEnd },
            commissionTotal: { gt: 0 },
          },
        }),
      ])

      // Build Maps for O(1) lookups by employeeId
      const timeEntriesByEmployee = new Map<string, typeof allTimeEntries>()
      for (const entry of allTimeEntries) {
        const list = timeEntriesByEmployee.get(entry.employeeId) || []
        list.push(entry)
        timeEntriesByEmployee.set(entry.employeeId, list)
      }

      const shiftsByEmployee = new Map<string, typeof allShifts>()
      for (const shift of allShifts) {
        const list = shiftsByEmployee.get(shift.employeeId) || []
        list.push(shift)
        shiftsByEmployee.set(shift.employeeId, list)
      }

      // Aggregate tip ledger entries per employee
      const tipDataByEmployee = new Map<string, { givenCents: number; receivedCents: number; creditsCents: number }>()
      for (const entry of allTipLedgerEntries) {
        let data = tipDataByEmployee.get(entry.employeeId)
        if (!data) {
          data = { givenCents: 0, receivedCents: 0, creditsCents: 0 }
          tipDataByEmployee.set(entry.employeeId, data)
        }
        const cents = Number(entry.amountCents || 0)
        if (entry.sourceType === 'ROLE_TIPOUT' && entry.type === 'DEBIT') {
          data.givenCents += cents
        } else if (entry.sourceType === 'ROLE_TIPOUT' && entry.type === 'CREDIT') {
          data.receivedCents += cents
        } else {
          // DIRECT_TIP or TIP_GROUP CREDIT
          data.creditsCents += cents
        }
      }

      const ordersByEmployee = new Map<string, typeof allOrders>()
      for (const order of allOrders) {
        if (!order.employeeId) continue
        const list = ordersByEmployee.get(order.employeeId) || []
        list.push(order)
        ordersByEmployee.set(order.employeeId, list)
      }

      for (const employee of employees) {
        // O(1) lookups from pre-fetched maps
        const timeEntries = timeEntriesByEmployee.get(employee.id) || []
        const shifts = shiftsByEmployee.get(employee.id) || []
        const tipData = tipDataByEmployee.get(employee.id) || { givenCents: 0, receivedCents: 0, creditsCents: 0 }
        const orders = ordersByEmployee.get(employee.id) || []

        // Convert cents to dollars for downstream calculations
        const tipSharesGivenTotal = Math.abs(tipData.givenCents) / 100
        const tipSharesReceivedTotal = tipData.receivedCents / 100
        const bankedTipsCollected = tipData.creditsCents / 100

        // Calculate totals
        const regularHours = timeEntries.reduce((sum, e) => sum + Number(e.regularHours || 0), 0)
        const overtimeHours = timeEntries.reduce((sum, e) => sum + Number(e.overtimeHours || 0), 0)
        const breakMinutes = timeEntries.reduce((sum, e) => sum + (e.breakMinutes || 0), 0)
        const hourlyRate = Number(employee.hourlyRate || 0)

        const regularPay = Math.round(regularHours * hourlyRate * 100) / 100
        const overtimePay = Math.round(overtimeHours * hourlyRate * 1.5 * 100) / 100
        const totalWagesEmp = regularPay + overtimePay

        const declaredTips = shifts.reduce((sum, s) => sum + Number(s.tipsDeclared || 0), 0)
        // tipSharesGivenTotal, tipSharesReceivedTotal, bankedTipsCollected already computed above from TipLedgerEntry
        const netTipsEmp = declaredTips - tipSharesGivenTotal + tipSharesReceivedTotal + bankedTipsCollected

        const commissionTotal = orders.reduce((sum, o) => sum + Number(o.commissionTotal), 0)

        const grossPay = Math.round((totalWagesEmp + netTipsEmp + commissionTotal) * 100) / 100

        // Calculate taxes if we have payroll settings
        let deductions: Record<string, number> = {}
        let netPay = grossPay

        if (grossPay > 0) {
          // Determine pay frequency
          const payFrequency = (period.periodType as TaxCalculationInput['payFrequency']) || 'biweekly'

          const taxInput: TaxCalculationInput = {
            grossPay,
            payFrequency,
            filingStatus: (employee.federalFilingStatus as 'single' | 'married' | 'head_of_household') || 'single',
            federalAllowances: employee.federalAllowances || 0,
            stateCode: payrollSettings?.stateTaxState || undefined,
            additionalWithholding: Number(employee.additionalStateWithholding || 0),
            isExemptFromFederal: employee.isExemptFromFederalTax || false,
            isExemptFromState: employee.isExemptFromStateTax || false,
            ytdGrossWages: Number(employee.ytdGrossWages || 0),
          }

          const taxes = calculateTaxes(taxInput)

          deductions = {
            federalTax: taxes.federalTax,
            stateTax: taxes.stateTax,
            localTax: taxes.localTax,
            socialSecurity: taxes.socialSecurity,
            medicare: taxes.medicare,
          }

          netPay = taxes.netPay
        }

        // Only create pay stub if there's any activity
        if (regularHours > 0 || declaredTips > 0 || commissionTotal > 0 || tipSharesReceivedTotal > 0 || bankedTipsCollected > 0) {
          await db.payStub.create({
            data: {
              locationId: period.locationId,
              payrollPeriodId: id,
              employeeId: employee.id,
              regularHours,
              overtimeHours,
              breakMinutes,
              hourlyRate,
              regularPay,
              overtimePay,
              declaredTips,
              tipSharesGiven: tipSharesGivenTotal,
              tipSharesReceived: tipSharesReceivedTotal,
              bankedTipsCollected,
              netTips: netTipsEmp,
              commissionTotal,
              grossPay,
              deductions,
              netPay,
              shiftCount: shifts.length,
              shiftIds: shifts.map(s => s.id),
              timeEntryIds: timeEntries.map(te => te.id),
              paymentMethod: employee.paymentMethod,
              status: 'pending',
            },
          })

          // Update running totals
          totalRegularHours += regularHours
          totalOvertimeHours += overtimeHours
          totalWages += totalWagesEmp
          totalTips += netTipsEmp
          totalCommissions += commissionTotal
          totalBankedTips += bankedTipsCollected
          grandTotal += grossPay
        }
      }

      // Update period totals
      await db.payrollPeriod.update({
        where: { id },
        data: {
          status: 'processing',
          totalRegularHours,
          totalOvertimeHours,
          totalWages,
          totalTips,
          totalCommissions,
          totalBankedTips,
          grandTotal,
        },
      })

      return NextResponse.json({ data: {
        message: 'Payroll processed successfully',
        totals: {
          regularHours: totalRegularHours,
          overtimeHours: totalOvertimeHours,
          wages: totalWages,
          tips: totalTips,
          commissions: totalCommissions,
          bankedTips: totalBankedTips,
          grandTotal,
        },
      } })
    }

    if (action === 'close') {
      // Close the payroll period
      await db.payrollPeriod.update({
        where: { id },
        data: {
          status: 'closed',
          closedAt: new Date(),
          closedBy,
        },
      })

      // Approve all pay stubs
      await db.payStub.updateMany({
        where: { payrollPeriodId: id },
        data: { status: 'approved' },
      })

      return NextResponse.json({ data: { message: 'Payroll period closed' } })
    }

    if (action === 'pay') {
      // Mark period as paid and update employee YTD
      const payStubs = await db.payStub.findMany({
        where: { payrollPeriodId: id },
      })

      // Batch update all pay stubs to paid status (1 query instead of N)
      const paidAt = new Date()
      await db.payStub.updateMany({
        where: { payrollPeriodId: id },
        data: { status: 'paid', paidAt },
      })

      // Aggregate YTD increments per employee, then update each
      // (employee updates use `increment` so must be per-employee, but we avoid the per-stub payStub.update)
      const ytdByEmployee = new Map<string, {
        grossPay: number; federalTax: number; stateTax: number; localTax: number;
        socialSecurity: number; medicare: number; tips: number; commission: number; netPay: number;
      }>()

      for (const stub of payStubs) {
        const deductions = (stub.deductions || {}) as Record<string, number>
        let agg = ytdByEmployee.get(stub.employeeId)
        if (!agg) {
          agg = { grossPay: 0, federalTax: 0, stateTax: 0, localTax: 0, socialSecurity: 0, medicare: 0, tips: 0, commission: 0, netPay: 0 }
          ytdByEmployee.set(stub.employeeId, agg)
        }
        agg.grossPay += Number(stub.grossPay)
        agg.federalTax += deductions.federalTax || 0
        agg.stateTax += deductions.stateTax || 0
        agg.localTax += deductions.localTax || 0
        agg.socialSecurity += deductions.socialSecurity || 0
        agg.medicare += deductions.medicare || 0
        agg.tips += Number(stub.netTips)
        agg.commission += Number(stub.commissionTotal)
        agg.netPay += Number(stub.netPay)
      }

      // One update per employee (not per stub)
      await Promise.all(
        Array.from(ytdByEmployee.entries()).map(([employeeId, agg]) =>
          db.employee.update({
            where: { id: employeeId },
            data: {
              ytdGrossWages: { increment: agg.grossPay },
              ytdFederalTax: { increment: agg.federalTax },
              ytdStateTax: { increment: agg.stateTax },
              ytdLocalTax: { increment: agg.localTax },
              ytdSocialSecurity: { increment: agg.socialSecurity },
              ytdMedicare: { increment: agg.medicare },
              ytdTips: { increment: agg.tips },
              ytdCommission: { increment: agg.commission },
              ytdNetPay: { increment: agg.netPay },
              ytdLastUpdated: paidAt,
            },
          })
        )
      )

      // Update period
      await db.payrollPeriod.update({
        where: { id },
        data: {
          status: 'paid',
          paidAt: new Date(),
        },
      })

      return NextResponse.json({ data: { message: 'Payroll marked as paid, YTD updated' } })
    }

    return NextResponse.json({ error: 'Invalid action' }, { status: 400 })
  } catch (error) {
    console.error('Failed to update payroll period:', error)
    return NextResponse.json({ error: 'Failed to update payroll period' }, { status: 500 })
  }
})

// DELETE - Delete payroll period (only if open)
export const DELETE = withVenue(async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params

    const period = await db.payrollPeriod.findUnique({ where: { id } })
    if (!period) {
      return NextResponse.json({ error: 'Payroll period not found' }, { status: 404 })
    }

    if (period.status !== 'open') {
      return NextResponse.json(
        { error: 'Can only delete open payroll periods' },
        { status: 400 }
      )
    }

    // Soft delete pay stubs first
    await db.payStub.updateMany({ where: { payrollPeriodId: id }, data: { deletedAt: new Date() } })

    // Soft delete period
    await db.payrollPeriod.update({ where: { id }, data: { deletedAt: new Date() } })

    return NextResponse.json({ data: { message: 'Payroll period deleted' } })
  } catch (error) {
    console.error('Failed to delete payroll period:', error)
    return NextResponse.json({ error: 'Failed to delete payroll period' }, { status: 500 })
  }
})
